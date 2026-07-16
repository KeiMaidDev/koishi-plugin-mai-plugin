import type { Config } from '../config'
import type { DebugTracer } from '../utils/debug'
import type { MaimaiDataStore } from '../data/sync-service'
import type { MaiRepositories } from '../database/repositories'
import { ComboStatus, MusicGenre, Rate, SyncStatus } from '../domain/enums'
import { RecordEntry, type MusicInfo } from '../domain/music'
import type { DivingFishRatingResponse, DivingFishRecord } from '../domain/payloads'
import { toInternalAchievement } from '../domain/payloads'
import { PlayerInfo, RatingResponse, RecordsResponse } from '../domain/player'
import { Rating } from '../domain/rating'
import {
  ProviderBindingRequiredError,
  ProviderMalformedPayloadError,
  ProviderNoDataError,
  providerResponseError,
} from './errors'
import {
  ProviderHttpClient,
  type MaimaiProvider,
  type ProviderLogger,
  type ProviderOptions,
  type UserQuery,
} from './types'

const DIVING_FISH_BASE = 'https://www.diving-fish.com/api/maimaidxprober'

export const DIVING_FISH_ENDPOINTS = {
  queryPlayer: `${DIVING_FISH_BASE}/query/player`,
  developerRecords: `${DIVING_FISH_BASE}/dev/player/record`,
  musicData: `${DIVING_FISH_BASE}/music_data`,
  chartStats: `${DIVING_FISH_BASE}/chart_stats`,
  updateRecords: `${DIVING_FISH_BASE}/player/update_records`,
} as const

export interface DivingFishMusicData {
  id: string
  title: string
  type: string
  ds: number[]
  level: string[]
  cids: string[]
  charts: Array<{ notes: number[]; charter: string }>
  basic_info: {
    title: string
    artist: string
    genre: string
    bpm: number
    release_date: string
    from: string
    is_new: boolean
  }
}

export interface DivingFishChartStats {
  charts: Record<string, Array<{
    cnt?: number | null
    diff?: string | null
    fit_diff?: number | null
    avg?: number | null
    avg_dx?: number | null
    std_dev?: number | null
    dist?: number[] | null
    fc_dist?: number[] | null
  }>>
  diff_data: Record<string, {
    achievements: number
    dist: number[]
    fc_dist: number[]
  }>
}

export interface DivingFishUpdateResponse {
  creates: number
  message: string
  updates: number
}

export interface DivingFishRecordSimple {
  title: string
  achievements: number
  dxScore: number
  fc: '' | 'fc' | 'fcp' | 'ap' | 'app'
  fs: '' | 'sync' | 'fs' | 'fsp' | 'fsd' | 'fsdp'
  level_index: number
  type: 'SD' | 'DX'
}

export type DivingFishImportRecord = DivingFishRecordSimple

export interface DivingFishProviderOptions extends ProviderOptions {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value)
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isFiniteNumber)
}

function isSafeIntegerArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isSafeInteger)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(entry => typeof entry === 'string')
}

function isDivingFishRecord(value: unknown): value is DivingFishRecord {
  if (!isObject(value)) return false
  return isFiniteNumber(value.achievements)
    && isFiniteNumber(value.ds)
    && isSafeInteger(value.dxScore)
    && typeof value.fc === 'string'
    && typeof value.fs === 'string'
    && typeof value.level === 'string'
    && isSafeInteger(value.level_index)
    && typeof value.level_label === 'string'
    && isSafeInteger(value.ra)
    && typeof value.rate === 'string'
    && isSafeInteger(value.song_id)
    && typeof value.title === 'string'
    && typeof value.type === 'string'
}

function parseRatingPayload(value: unknown): DivingFishRatingResponse {
  if (!isObject(value)
    || typeof value.username !== 'string'
    || !isSafeInteger(value.rating)
    || !isSafeInteger(value.additional_rating)
    || typeof value.nickname !== 'string'
    || (value.plate !== undefined && value.plate !== null && typeof value.plate !== 'string')
    || !isObject(value.charts)
    || !Array.isArray(value.charts.sd)
    || !value.charts.sd.every(isDivingFishRecord)
    || !Array.isArray(value.charts.dx)
    || !value.charts.dx.every(isDivingFishRecord)) {
    throw new ProviderMalformedPayloadError('diving-fish')
  }
  return value as unknown as DivingFishRatingResponse
}

function parseDeveloperRecords(value: unknown) {
  if (!isObject(value)) throw new ProviderMalformedPayloadError('diving-fish')
  const values = Object.values(value)
  if (!values.every(records => Array.isArray(records) && records.every(isDivingFishRecord))) {
    throw new ProviderMalformedPayloadError('diving-fish')
  }
  return values.flat() as DivingFishRecord[]
}

function parseMusicData(value: unknown): DivingFishMusicData[] {
  if (!Array.isArray(value) || !value.every((entry) => {
    if (!isObject(entry) || !isObject(entry.basic_info)) return false
    return typeof entry.id === 'string'
      && typeof entry.title === 'string'
      && typeof entry.type === 'string'
      && isNumberArray(entry.ds)
      && isStringArray(entry.level)
      && isStringArray(entry.cids)
      && Array.isArray(entry.charts)
      && entry.charts.every(chart => isObject(chart) && isSafeIntegerArray(chart.notes) && typeof chart.charter === 'string')
      && typeof entry.basic_info.title === 'string'
      && typeof entry.basic_info.artist === 'string'
      && typeof entry.basic_info.genre === 'string'
      && isSafeInteger(entry.basic_info.bpm)
      && typeof entry.basic_info.release_date === 'string'
      && typeof entry.basic_info.from === 'string'
      && typeof entry.basic_info.is_new === 'boolean'
  })) {
    throw new ProviderMalformedPayloadError('diving-fish')
  }
  return value as DivingFishMusicData[]
}

function optionalNumber(value: unknown) {
  return value === undefined || value === null || isFiniteNumber(value)
}

function optionalString(value: unknown) {
  return value === undefined || value === null || typeof value === 'string'
}

function optionalNumberArray(value: unknown) {
  return value === undefined || value === null || isNumberArray(value)
}

function parseChartStats(value: unknown): DivingFishChartStats {
  if (!isObject(value) || !isObject(value.charts) || !isObject(value.diff_data)) {
    throw new ProviderMalformedPayloadError('diving-fish')
  }
  const chartsValid = Object.values(value.charts).every(entries => Array.isArray(entries) && entries.every(entry => (
    isObject(entry)
    && optionalNumber(entry.cnt)
    && optionalString(entry.diff)
    && optionalNumber(entry.fit_diff)
    && optionalNumber(entry.avg)
    && optionalNumber(entry.avg_dx)
    && optionalNumber(entry.std_dev)
    && optionalNumberArray(entry.dist)
    && optionalNumberArray(entry.fc_dist)
  )))
  const diffDataValid = Object.values(value.diff_data).every(entry => (
    isObject(entry)
    && isFiniteNumber(entry.achievements)
    && isNumberArray(entry.dist)
    && isNumberArray(entry.fc_dist)
  ))
  if (!chartsValid || !diffDataValid) throw new ProviderMalformedPayloadError('diving-fish')
  return value as unknown as DivingFishChartStats
}

function parseUpdateResponse(value: unknown): DivingFishUpdateResponse {
  if (!isObject(value)
    || !isSafeInteger(value.creates)
    || typeof value.message !== 'string'
    || !isSafeInteger(value.updates)) {
    throw new ProviderMalformedPayloadError('diving-fish')
  }
  return value as unknown as DivingFishUpdateResponse
}

function validImportRecord(value: unknown): value is DivingFishImportRecord {
  if (!isObject(value)) return false
  return typeof value.title === 'string'
    && value.title.length > 0
    && isFiniteNumber(value.achievements)
    && value.achievements >= 0
    && value.achievements <= 101
    && isSafeInteger(value.dxScore)
    && value.dxScore >= 0
    && typeof value.fc === 'string'
    && ['', 'fc', 'fcp', 'ap', 'app'].includes(value.fc)
    && typeof value.fs === 'string'
    && ['', 'sync', 'fs', 'fsp', 'fsd', 'fsdp'].includes(value.fs)
    && isSafeInteger(value.level_index)
    && value.level_index >= 0
    && value.level_index <= 4
    && (value.type === 'SD' || value.type === 'DX')
}

export class DivingFishProvider implements MaimaiProvider {
  readonly id = 'diving-fish' as const
  readonly name = 'Diving Fish'
  private readonly http: ProviderHttpClient
  private readonly config: Config
  private readonly data: MaimaiDataStore
  private readonly repositories: MaiRepositories
  private readonly debug?: DebugTracer

  constructor(options: DivingFishProviderOptions) {
    this.config = options.config
    this.data = options.data
    this.repositories = options.repositories
    this.debug = options.debug
    this.http = new ProviderHttpClient(this.id, options.ctx, options.logger, options)
  }

  private queryBody(user: UserQuery, additional: Record<string, unknown> = {}) {
    const target = user.type === 'qq'
      ? (() => {
          const qq = typeof user.qq === 'number' ? user.qq : Number(user.qq)
          if (!Number.isSafeInteger(qq) || qq <= 0) {
            throw new ProviderMalformedPayloadError(this.id, 'QQ queries require a positive integer.')
          }
          return { qq }
        })()
      : { username: user.username }
    return {
      b50: true,
      ...target,
      ...additional,
    }
  }

  private assertSuccess(status: number, body: unknown) {
    if (status >= 200 && status < 300) return
    throw providerResponseError(this.id, status, body)
  }

  private toRecord(record: DivingFishRecord) {
    const music = this.data.musics.get(record.song_id)
    if (!music) return null
    const chart = music.genre === MusicGenre.Utage
      ? music.charts[0]
      : music.charts[record.level_index]
    if (!chart) throw new ProviderMalformedPayloadError(this.id, 'Diving Fish record references an unknown chart.')
    const achievement = toInternalAchievement(record.achievements)
    return new RecordEntry(
      music,
      chart,
      achievement,
      ComboStatus.of(record.fc),
      SyncStatus.of(record.fs),
      record.dxScore,
      Rate.get(achievement),
      Rating.calc(chart, achievement),
    )
  }

  private normalizeRecords(records: DivingFishRecord[]) {
    const normalized = records.map(record => this.toRecord(record)).filter((record): record is RecordEntry => record !== null)
    this.debug?.event('provider.records.mapped', {
      provider: this.id,
      received: records.length,
      mapped: normalized.length,
      dropped: records.length - normalized.length,
    })
    return normalized
  }

  private playerOf(payload: DivingFishRatingResponse) {
    return new PlayerInfo(
      payload.nickname,
      payload.rating,
      payload.additional_rating + (payload.additional_rating > 10 ? 1 : 0),
    )
  }

  private async ratingPayload(user: UserQuery) {
    const response = await this.http.json({
      label: 'query-player',
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.queryPlayer,
      headers: { 'Content-Type': 'application/json' },
      data: this.queryBody(user),
    })
    this.assertSuccess(response.status, response.data)
    if (response.data === null || response.data === undefined) throw new ProviderNoDataError(this.id)
    return parseRatingPayload(response.data)
  }

  private async developerRecords(user: UserQuery, musics: MusicInfo[]) {
    const response = await this.http.json({
      label: 'developer-records',
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.developerRecords,
      headers: {
        'Content-Type': 'application/json',
        'developer-token': this.config.developerTokens.divingFish,
      },
      data: this.queryBody(user, {
        music_id: musics.map(music => String(music.id)),
      }),
    })
    this.assertSuccess(response.status, response.data)
    if (response.data === null || response.data === undefined) throw new ProviderNoDataError(this.id)
    return this.normalizeRecords(parseDeveloperRecords(response.data))
  }

  async getPlayerRating(user: UserQuery) {
    const payload = await this.ratingPayload(user)
    return new RatingResponse(
      this.playerOf(payload),
      null,
      this.normalizeRecords(payload.charts.sd),
      this.normalizeRecords(payload.charts.dx),
    )
  }

  getPlayerRecord(user: UserQuery, music: MusicInfo) {
    return this.developerRecords(user, [music])
  }

  async getPlayerRecords(user: UserQuery, musics: MusicInfo[]) {
    const records = await this.developerRecords(user, musics)
    const payload = await this.ratingPayload(user)
    return new RecordsResponse(this.playerOf(payload), null, records)
  }

  async getMusicData() {
    const response = await this.http.json({
      label: 'music-data',
      method: 'GET',
      url: DIVING_FISH_ENDPOINTS.musicData,
    })
    this.assertSuccess(response.status, response.data)
    return parseMusicData(response.data)
  }

  async getChartStats() {
    const response = await this.http.json({
      label: 'chart-stats',
      method: 'GET',
      url: DIVING_FISH_ENDPOINTS.chartStats,
    })
    this.assertSuccess(response.status, response.data)
    return parseChartStats(response.data)
  }

  async importRecords(
    userId: string,
    records: DivingFishImportRecord[],
    importToken?: string,
  ) {
    if (!Array.isArray(records) || !records.every(validImportRecord)) {
      throw new ProviderMalformedPayloadError(this.id, 'Diving Fish import records are malformed.')
    }
    const token = importToken ?? await this.repositories.bind.getImportToken(userId)
    if (!token) throw new ProviderBindingRequiredError(this.id, 'A Diving Fish import token is required.')
    const response = await this.http.json({
      label: 'update-records',
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.updateRecords,
      headers: {
        'Content-Type': 'application/json',
        'Import-Token': token,
      },
      data: records,
    })
    this.assertSuccess(response.status, response.data)
    return parseUpdateResponse(response.data)
  }

  updateRecords(userId: string, records: DivingFishImportRecord[], importToken?: string) {
    return this.importRecords(userId, records, importToken)
  }
}

export type { ProviderLogger }
