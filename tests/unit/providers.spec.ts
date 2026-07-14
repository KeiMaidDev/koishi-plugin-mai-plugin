import { describe, expect, it, vi } from 'vitest'
import HTTP from '@cordisjs/plugin-http'
import type { Config } from '../../src/config'
import { MaimaiDataStore } from '../../src/data/sync-service'
import { normalizeMaimaiSource } from '../../src/data/normalizers'
import type { MaiRepositories } from '../../src/database/repositories'
import type { MusicInfo, RecordEntry } from '../../src/domain/music'
import { PlayerInfo, RatingResponse, RecordsResponse } from '../../src/domain/player'
import { Rating } from '../../src/domain/rating'
import {
  ProviderAuthorizationError,
  ProviderBindingRequiredError,
  ProviderMalformedPayloadError,
  ProviderNoDataError,
  ProviderNotFoundError,
  ProviderOAuthRequiredError,
  ProviderPrivacyError,
  ProviderTimeoutError,
} from '../../src/providers/errors'
import {
  DIVING_FISH_ENDPOINTS,
  DivingFishProvider,
} from '../../src/providers/diving-fish'
import { LXNS_ENDPOINTS, LxnsProvider } from '../../src/providers/lxns'
import { ProviderChain } from '../../src/providers/provider-chain'
import type {
  MaimaiProvider,
  ProviderContext,
  ProviderHttpConfig,
  ProviderHttpResponse,
  UserQuery,
} from '../../src/providers/types'
import chartStatsFixture from '../fixtures/providers/diving-fish-chart-stats.json'
import importRecordsFixture from '../fixtures/providers/diving-fish-import-records.json'
import musicDataFixture from '../fixtures/providers/diving-fish-music-data.json'
import divingFishRatingFixture from '../fixtures/providers/diving-fish-rating.json'
import divingFishRecordsFixture from '../fixtures/providers/diving-fish-records.json'
import updateFixture from '../fixtures/providers/diving-fish-update.json'
import errorsFixture from '../fixtures/providers/provider-errors.json'
import lxnsBestsFixture from '../fixtures/providers/lxns-bests.json'
import lxnsOauthFixture from '../fixtures/providers/lxns-oauth-token.json'
import lxnsPlayerFixture from '../fixtures/providers/lxns-player.json'
import lxnsScoresFixture from '../fixtures/providers/lxns-scores.json'
import malformedPayloadsFixture from '../fixtures/providers/malformed-payloads.json'
import musicSourceFixture from '../fixtures/providers/music-source.json'
import oauthGrantErrorsFixture from '../fixtures/providers/oauth-grant-errors.json'

const config: Config = {
  developerTokens: {
    divingFish: 'developer-diving-secret',
    lxns: 'developer-lxns-secret',
  },
  oauth: {
    enabled: true,
    clientId: 'oauth-client-id',
    clientSecret: 'oauth-client-secret',
    tokenCipherKey: 'cipher-key',
  },
  resourceSync: {
    enabled: false,
    intervalMinutes: 60,
    timeoutMs: 10_000,
    cacheDir: 'data/maimai',
    staticBaseUrl: '',
    allowedHosts: [],
  },
  render: {
    concurrency: 1,
    queueLimit: 1,
    timeoutMs: 10_000,
  },
  publicBaseUrl: 'https://bot.example/oauth/lxns/callback',
  administrators: [],
  compatibilityMode: false,
}

function createStore() {
  return new MaimaiDataStore(
    normalizeMaimaiSource(musicSourceFixture),
    {
      schemaVersion: 1,
      revision: 'providers-r1',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {},
    },
    new Map(),
  )
}

function createRepositories() {
  return {
    bind: {
      getImportToken: vi.fn(async () => 'fixture-import-token'),
    },
    setting: {
      get: vi.fn(async () => null),
    },
    oauth: {
      get: vi.fn(async () => null),
      save: vi.fn(async () => undefined),
    },
  } as unknown as MaiRepositories
}

interface Route {
  method: string
  url: string
  status?: number
  data: unknown
}

function routedContext(routes: Route[]) {
  const pending = [...routes]
  const calls: Array<{ url: string; config: ProviderHttpConfig }> = []
  const http = vi.fn(async (url: string | URL, request: ProviderHttpConfig = {}) => {
    const call = { url: String(url), config: request }
    calls.push(call)
    const route = pending.shift()
    if (!route) throw new Error(`Unexpected request: ${request.method ?? 'GET'} ${url}`)
    expect((request.method ?? 'GET').toUpperCase()).toBe(route.method)
    expect(String(url)).toBe(route.url)
    return {
      url: String(url),
      status: route.status ?? 200,
      statusText: '',
      headers: new Headers({ 'content-type': 'application/json' }),
      data: route.data,
    } satisfies ProviderHttpResponse
  })
  return {
    ctx: { http } as ProviderContext,
    calls,
    assertDrained() {
      expect(pending).toHaveLength(0)
    },
  }
}

function normalizedRecords(records: RecordEntry[]) {
  return records.map(record => ({
    musicId: record.music.id,
    difficulty: record.chart.difficulty.value,
    achievement: record.achievement,
    combo: record.comboStatus.value,
    sync: record.syncStatus.value,
    deluxeScore: record.deluxeScore,
    rate: record.rate,
    rating: record.rating,
  }))
}

function username(username = 'fixture-user', userId = 'user-1'): UserQuery {
  return { type: 'username', username, userId, isSelf: true }
}

function qq(qqNumber = '123456789', userId = 'user-1'): UserQuery {
  return { type: 'qq', qq: qqNumber, userId, isSelf: true }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('provider normalization', () => {
  it('normalizes equivalent Diving Fish and LXNS best lists into identical record semantics', async () => {
    const store = createStore()
    const divingHttp = routedContext([{
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.queryPlayer,
      data: divingFishRatingFixture,
    }])
    const lxnsHttp = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`, data: lxnsPlayerFixture },
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/987654321/bests`, data: lxnsBestsFixture },
    ])
    const divingFish = new DivingFishProvider({
      ctx: divingHttp.ctx,
      config,
      data: store,
      repositories: createRepositories(),
    })
    const lxns = new LxnsProvider({
      ctx: lxnsHttp.ctx,
      config,
      data: store,
      repositories: createRepositories(),
    })

    const divingResult = await divingFish.getPlayerRating(username())
    const lxnsResult = await lxns.getPlayerRating(username())

    expect(divingResult.player).toEqual(lxnsResult.player)
    expect(normalizedRecords([
      ...divingResult.oldRatingList,
      ...divingResult.newRatingList,
    ])).toEqual(normalizedRecords([
      ...lxnsResult.oldRatingList,
      ...lxnsResult.newRatingList,
    ]))
    expect(divingHttp.calls[0].config.data).toEqual({ b50: true, username: 'fixture-user' })
    expect(divingHttp.calls[0].config.headers).toEqual({
      'Content-Type': 'application/json',
    })
    expect(lxnsHttp.calls[0].config.headers).toEqual({
      Authorization: 'developer-lxns-secret',
    })
    divingHttp.assertDrained()
    lxnsHttp.assertDrained()
  })

  it('uses the Diving Fish developer records endpoint and preserves explicit headers', async () => {
    const store = createStore()
    const http = routedContext([
      { method: 'POST', url: DIVING_FISH_ENDPOINTS.developerRecords, data: divingFishRecordsFixture },
      { method: 'POST', url: DIVING_FISH_ENDPOINTS.queryPlayer, data: divingFishRatingFixture },
    ])
    const provider = new DivingFishProvider({
      ctx: http.ctx,
      config,
      data: store,
      repositories: createRepositories(),
    })

    const result = await provider.getPlayerRecords(username(), [...store.musics.values()])

    expect(result.records).toHaveLength(2)
    expect(http.calls[0].config.headers).toEqual({
      'Content-Type': 'application/json',
      'developer-token': 'developer-diving-secret',
    })
    expect(http.calls[0].config.data).toEqual({
      b50: true,
      username: 'fixture-user',
      music_id: ['1', '10002'],
    })
    http.assertDrained()
  })

  it('serializes Diving Fish QQ queries as numeric JSON like the Kotlin provider', async () => {
    const http = routedContext([{
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.queryPlayer,
      data: divingFishRatingFixture,
    }])
    const provider = new DivingFishProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await provider.getPlayerRating(qq())

    expect(http.calls[0].config.data).toEqual({ b50: true, qq: 123456789 })
  })

  it('loads Diving Fish music data, chart stats, and imports records with a bound token', async () => {
    const repositories = createRepositories()
    const http = routedContext([
      { method: 'GET', url: DIVING_FISH_ENDPOINTS.musicData, data: musicDataFixture },
      { method: 'GET', url: DIVING_FISH_ENDPOINTS.chartStats, data: chartStatsFixture },
      { method: 'POST', url: DIVING_FISH_ENDPOINTS.updateRecords, data: updateFixture },
    ])
    const provider = new DivingFishProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
    })

    expect(await provider.getMusicData()).toEqual(musicDataFixture)
    expect(await provider.getChartStats()).toEqual(chartStatsFixture)
    expect(await provider.importRecords('user-1', importRecordsFixture)).toEqual(updateFixture)
    expect(repositories.bind.getImportToken).toHaveBeenCalledWith('user-1')
    expect(http.calls[2].config.headers).toEqual({
      'Content-Type': 'application/json',
      'Import-Token': 'fixture-import-token',
    })
    expect(http.calls[2].config.data).toEqual(importRecordsFixture)
    http.assertDrained()
  })

  it.each([
    ['legacy song_id shortcut', ({ song_id: 1 })],
    ['missing field', ({ ...importRecordsFixture[0], title: undefined })],
    ['fractional integer', ({ ...importRecordsFixture[0], dxScore: 57.5 })],
    ['fractional difficulty', ({ ...importRecordsFixture[0], level_index: 0.5 })],
    ['invalid type', ({ ...importRecordsFixture[0], type: malformedPayloadsFixture.divingFish.invalidType })],
    ['invalid combo', ({ ...importRecordsFixture[0], fc: malformedPayloadsFixture.divingFish.invalidCombo })],
  ])('rejects DivingFishRecordSimple import payloads with %s', async (_name, record) => {
    const http = vi.fn()
    const provider = new DivingFishProvider({
      ctx: { http } as ProviderContext,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.importRecords('user-1', [record] as never))
      .rejects.toBeInstanceOf(ProviderMalformedPayloadError)
    expect(http).not.toHaveBeenCalled()
  })

  it.each([
    ['fractional notes', (() => {
      const payload = clone(musicDataFixture)
      payload[0].charts[0].notes[0] = malformedPayloadsFixture.divingFish.fractionalNote
      return payload
    })()],
    ['fractional BPM', (() => {
      const payload = clone(musicDataFixture)
      payload[0].basic_info.bpm = malformedPayloadsFixture.divingFish.fractionalBpm
      return payload
    })()],
    ['unsafe BPM integer', (() => {
      const payload = clone(musicDataFixture)
      payload[0].basic_info.bpm = malformedPayloadsFixture.divingFish.unsafeInteger
      return payload
    })()],
  ])('rejects Diving Fish music data with %s', async (_name, payload) => {
    const http = routedContext([{
      method: 'GET',
      url: DIVING_FISH_ENDPOINTS.musicData,
      data: payload,
    }])
    const provider = new DivingFishProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.getMusicData()).rejects.toBeInstanceOf(ProviderMalformedPayloadError)
  })
})

describe('LXNS endpoints and OAuth', () => {
  it('queries a single best with the Kotlin song id and type mapping', async () => {
    const store = createStore()
    const http = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/qq/123456789`, data: lxnsPlayerFixture },
      {
        method: 'GET',
        url: `${LXNS_ENDPOINTS.maimai}/player/987654321/bests?song_id=2&song_type=dx`,
        data: { ...lxnsScoresFixture, data: [lxnsScoresFixture.data[1]] },
      },
    ])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: store,
      repositories: createRepositories(),
    })

    const result = await provider.getPlayerRecord(qq(), store.musics.get(10002)!)

    expect(normalizedRecords(result)).toEqual([{
      musicId: 10002,
      difficulty: 0,
      achievement: 995_000,
      combo: 'fc',
      sync: 'fs',
      deluxeScore: 72,
      rate: 'ssp',
      rating: Rating.calc(store.musics.get(10002)!.charts[0], 995_000),
    }])
    http.assertDrained()
  })

  it('refreshes OAuth before full-score access and persists the rotated token', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.oauth.get).mockResolvedValue({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'stale-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: new Date('2026-07-13T01:00:20.000Z'),
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    })
    const http = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`, data: lxnsPlayerFixture },
      { method: 'POST', url: LXNS_ENDPOINTS.oauthToken, data: lxnsOauthFixture },
      { method: 'GET', url: `${LXNS_ENDPOINTS.user}/maimai/player/scores`, data: lxnsScoresFixture },
    ])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
      now: () => new Date('2026-07-13T01:00:00.000Z'),
    })

    const result = await provider.getPlayerRecords(username(), [])

    expect(result.records).toHaveLength(2)
    expect(http.calls[1].config.data).toEqual({
      client_id: 'oauth-client-id',
      client_secret: 'oauth-client-secret',
      grant_type: 'refresh_token',
      refresh_token: 'stored-refresh-token',
    })
    expect(http.calls[2].config.headers).toEqual({
      Authorization: 'Bearer fixture-access-token',
    })
    expect(repositories.oauth.save).toHaveBeenCalledWith({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'fixture-access-token',
      refreshToken: 'fixture-refresh-token',
      expiresAt: new Date('2026-07-13T02:00:00.000Z'),
    })
    http.assertDrained()
  })

  it('reuses a stored access token while it remains outside the expiry skew', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.oauth.get).mockResolvedValue({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'stored-access-token',
      refreshToken: 'stored-refresh-token',
      expiresAt: new Date('2026-07-13T01:01:00.000Z'),
      updatedAt: new Date('2026-07-13T00:00:00.000Z'),
    })
    const http = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`, data: lxnsPlayerFixture },
      { method: 'GET', url: `${LXNS_ENDPOINTS.user}/maimai/player/scores`, data: lxnsScoresFixture },
    ])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
      now: () => new Date('2026-07-13T01:00:00.000Z'),
    })

    const result = await provider.getPlayerRecords(username(), [])

    expect(result.records).toHaveLength(2)
    expect(http.calls[1].config.headers).toEqual({
      Authorization: 'Bearer stored-access-token',
    })
    expect(repositories.oauth.save).not.toHaveBeenCalled()
    http.assertDrained()
  })

  it('exchanges an OAuth code and stores access and refresh tokens without logging them', async () => {
    const repositories = createRepositories()
    const warnings: string[] = []
    const http = routedContext([{
      method: 'POST',
      url: LXNS_ENDPOINTS.oauthToken,
      data: lxnsOauthFixture,
    }])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
      logger: { warn: message => warnings.push(message) },
      now: () => new Date('2026-07-13T01:00:00.000Z'),
    })

    await provider.exchangeOAuthCode('user-1', 'oauth-code-secret')

    expect(http.calls[0].config.data).toEqual({
      client_id: 'oauth-client-id',
      client_secret: 'oauth-client-secret',
      grant_type: 'authorization_code',
      code: 'oauth-code-secret',
      redirect_uri: 'https://bot.example/oauth/lxns/callback',
    })
    expect(repositories.oauth.save).toHaveBeenCalledTimes(1)
    expect(warnings.join('\n')).not.toMatch(/oauth-code-secret|fixture-access-token|fixture-refresh-token|Authorization/i)
    http.assertDrained()
  })

  it('maps authorization-code invalid_grant responses to OAuth-required', async () => {
    const http = routedContext([{
      method: 'POST',
      url: LXNS_ENDPOINTS.oauthToken,
      status: 400,
      data: oauthGrantErrorsFixture.authorizationCode,
    }])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.exchangeOAuthCode('user-1', 'expired-code'))
      .rejects.toBeInstanceOf(ProviderOAuthRequiredError)
  })

  it('maps refresh-token invalid_grant responses to OAuth-required', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.oauth.get).mockResolvedValue({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'expired-access-token',
      refreshToken: 'expired-refresh-token',
      expiresAt: new Date('2026-07-13T00:00:00.000Z'),
      updatedAt: new Date('2026-07-12T00:00:00.000Z'),
    })
    const http = routedContext([{
      method: 'POST',
      url: LXNS_ENDPOINTS.oauthToken,
      status: 400,
      data: oauthGrantErrorsFixture.refreshToken,
    }])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
    })

    await expect(provider.refreshOAuthToken('user-1'))
      .rejects.toBeInstanceOf(ProviderOAuthRequiredError)
  })

  it('queries recent scores', async () => {
    const http = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`, data: lxnsPlayerFixture },
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/987654321/recents`, data: lxnsScoresFixture },
    ])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    expect((await provider.getPlayerRecent(username())).records).toHaveLength(2)
    http.assertDrained()
  })

  it('never uses a local OAuth token for public-target full score queries', async () => {
    const http = routedContext([])
    const repositories = createRepositories()
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories,
    })
    const publicTarget: UserQuery = {
      type: 'username',
      username: 'fixture-user',
      userId: 'requester-user',
      isSelf: false,
      provider: 'lxns',
    }

    await expect(provider.getPlayerRecords(publicTarget, []))
      .rejects.toBeInstanceOf(ProviderOAuthRequiredError)
    expect(repositories.oauth.get).not.toHaveBeenCalled()
    expect(http.calls).toEqual([])
    http.assertDrained()
  })

  it.each([
    ['collection scalar', (() => {
      const payload = clone(lxnsPlayerFixture)
      payload.data.icon!.color = malformedPayloadsFixture.lxns.invalidCollectionColor as never
      return payload
    })()],
    ['collection integer list', (() => {
      const payload = clone(lxnsPlayerFixture)
      payload.data.icon!.required![0].difficulties = [malformedPayloadsFixture.lxns.fractionalDifficulty]
      return payload
    })()],
  ])('rejects malformed LXNS optional %s fields', async (_name, payload) => {
    const http = routedContext([{
      method: 'GET',
      url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`,
      data: payload,
    }])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.getPlayerInfo(username())).rejects.toBeInstanceOf(ProviderMalformedPayloadError)
  })

  it('rejects malformed LXNS optional timestamp fields', async () => {
    const payload = clone(lxnsBestsFixture)
    payload.data.standard[0].play_time = malformedPayloadsFixture.lxns.invalidTimestamp as never
    const http = routedContext([
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`, data: lxnsPlayerFixture },
      { method: 'GET', url: `${LXNS_ENDPOINTS.maimai}/player/987654321/bests`, data: payload },
    ])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.getPlayerRating(username())).rejects.toBeInstanceOf(ProviderMalformedPayloadError)
  })
})

describe('provider error taxonomy and timeouts', () => {
  const cases = [
    ['authorization', ProviderAuthorizationError],
    ['privacy', ProviderPrivacyError],
    ['notFound', ProviderNotFoundError],
    ['noData', ProviderNoDataError],
    ['unbound', ProviderBindingRequiredError],
    ['oauthRequired', ProviderOAuthRequiredError],
    ['malformed', ProviderMalformedPayloadError],
  ] as const

  it.each(cases)('maps %s independently', async (name, ErrorType) => {
    const fixture = errorsFixture[name]
    const http = routedContext([{
      method: 'GET',
      url: `${LXNS_ENDPOINTS.maimai}/player/fixture-user`,
      status: fixture.status,
      data: fixture.body,
    }])
    const provider = new LxnsProvider({
      ctx: http.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.getPlayerInfo(username())).rejects.toBeInstanceOf(ErrorType)
  })

  it('maps Diving Fish 400 to not found and 403 to privacy', async () => {
    const notFoundHttp = routedContext([{
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.queryPlayer,
      status: 400,
      data: { message: 'not found' },
    }])
    const privacyHttp = routedContext([{
      method: 'POST',
      url: DIVING_FISH_ENDPOINTS.queryPlayer,
      status: 403,
      data: { message: 'private' },
    }])

    await expect(new DivingFishProvider({
      ctx: notFoundHttp.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    }).getPlayerRating(username())).rejects.toBeInstanceOf(ProviderNotFoundError)
    await expect(new DivingFishProvider({
      ctx: privacyHttp.ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    }).getPlayerRating(username())).rejects.toBeInstanceOf(ProviderPrivacyError)
  })

  it('uses an abort signal for connection timeout and ctx.http timeout for the total request', async () => {
    const calls: ProviderHttpConfig[] = []
    const ctx = {
      http: vi.fn((_url: string | URL, request: ProviderHttpConfig = {}) => {
        calls.push(request)
        return new Promise<ProviderHttpResponse>((_resolve, reject) => {
          request.signal?.addEventListener('abort', () => reject(request.signal?.reason))
        })
      }),
    } as ProviderContext
    const provider = new DivingFishProvider({
      ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
      connectTimeoutMs: 5,
      totalTimeoutMs: 25,
    })

    await expect(provider.getPlayerRating(username())).rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(calls[0].timeout).toBe(25)
    expect(calls[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('maps ctx.http total timeout failures and logs no credentials', async () => {
    const warnings: string[] = []
    const ctx = {
      http: vi.fn(async () => {
        throw Object.assign(new Error('request timeout'), { code: 'ETIMEDOUT' })
      }),
    } as ProviderContext
    const provider = new DivingFishProvider({
      ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
      logger: { warn: message => warnings.push(message) },
    })

    await expect(provider.importRecords('user-1', [], 'fixture-import-token'))
      .rejects.toBeInstanceOf(ProviderTimeoutError)
    expect(warnings).toHaveLength(1)
    expect(warnings.join('\n')).not.toMatch(/developer-diving-secret|fixture-import-token|Authorization/i)
  })

  it.each([
    ['provider timeout', new ProviderTimeoutError('diving-fish')],
    ['timeout code', Object.assign(new Error('timed out'), { code: 'ETIMEDOUT' })],
  ])('maps Cordis-style wrapped %s causes to provider timeout', async (_name, cause) => {
    const wrapped = new HTTP.Error('fetch https://example.invalid failed')
    wrapped.cause = cause
    const ctx = {
      http: vi.fn(async () => { throw wrapped }),
    } as ProviderContext
    const provider = new DivingFishProvider({
      ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
    })

    await expect(provider.getPlayerRating(username())).rejects.toBeInstanceOf(ProviderTimeoutError)
  })

  it.each(['raw', 'wrapped'])('preserves a genuine %s AbortError through ProviderHttpClient', async kind => {
    const abort = Object.assign(new Error('cancelled by caller'), { name: 'AbortError' })
    const error = kind === 'wrapped'
      ? Object.assign(new HTTP.Error('fetch https://example.invalid failed'), { cause: abort })
      : abort
    const warnings: string[] = []
    const ctx = {
      http: vi.fn(async () => { throw error }),
    } as ProviderContext
    const provider = new DivingFishProvider({
      ctx,
      config,
      data: createStore(),
      repositories: createRepositories(),
      logger: { warn: message => warnings.push(message) },
    })

    await expect(provider.getPlayerRating(username())).rejects.toBe(abort)
    expect(warnings).toEqual([])
  })
})

function fakeProvider(
  id: 'diving-fish' | 'lxns',
  implementations: Partial<MaimaiProvider> = {},
): MaimaiProvider {
  return {
    id,
    name: id,
    getPlayerRating: vi.fn(async () => {
      throw new ProviderNoDataError(id)
    }),
    getPlayerRecord: vi.fn(async () => {
      throw new ProviderNoDataError(id)
    }),
    getPlayerRecords: vi.fn(async () => {
      throw new ProviderNoDataError(id)
    }),
    ...implementations,
  }
}

function successfulRating(nickname: string) {
  return new RatingResponse(
    new PlayerInfo(nickname),
    null,
    [{} as RecordEntry],
    [],
  )
}

describe('ProviderChain', () => {
  it('falls back to LXNS after a non-terminal failure with saved Diving Fish preference', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.setting.get).mockResolvedValue('diving-fish')
    const order: string[] = []
    const divingFish = fakeProvider('diving-fish', {
      getPlayerRating: vi.fn(async () => {
        order.push('diving-fish')
        throw new ProviderNoDataError('diving-fish')
      }),
    })
    const lxns = fakeProvider('lxns', {
      getPlayerRating: vi.fn(async () => {
        order.push('lxns')
        return successfulRating('LXNS Player')
      }),
    })
    const chain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: { divingFish, lxns },
    })

    const result = await chain.rating(username())

    expect(result.provider.id).toBe('lxns')
    expect(order).toEqual(['diving-fish', 'lxns'])
  })

  it('falls back to LXNS recent scores when preferred Diving Fish is unsupported', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.setting.get).mockResolvedValue('diving-fish')
    const divingFish = fakeProvider('diving-fish')
    const recent = vi.fn(async () => new RecordsResponse(new PlayerInfo('LXNS Player'), null, []))
    const lxns = fakeProvider('lxns', { getPlayerRecent: recent })
    const chain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: { divingFish, lxns },
    })

    const result = await chain.recent(username())

    expect(result.provider.id).toBe('lxns')
    expect(recent).toHaveBeenCalledTimes(1)
  })

  it('tries saved LXNS preference first and then falls back to Diving Fish', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.setting.get).mockResolvedValue('lxns')
    const order: string[] = []
    const divingFish = fakeProvider('diving-fish', {
      getPlayerRating: vi.fn(async () => {
        order.push('diving-fish')
        return successfulRating('Diving Fish Player')
      }),
    })
    const lxns = fakeProvider('lxns', {
      getPlayerRating: vi.fn(async () => {
        order.push('lxns')
        throw new ProviderNoDataError('lxns')
      }),
    })
    const chain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: { divingFish, lxns },
    })

    const result = await chain.rating(username())

    expect(result.provider.id).toBe('diving-fish')
    expect(order).toEqual(['lxns', 'diving-fish'])
  })

  it('keeps explicit per-query provider override exclusive', async () => {
    const repositories = createRepositories()
    const divingFish = fakeProvider('diving-fish', {
      getPlayerRating: vi.fn(async () => successfulRating('Diving Fish Player')),
    })
    const lxns = fakeProvider('lxns')
    const chain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: { divingFish, lxns },
    })

    await expect(chain.rating({ ...username(), provider: 'lxns' }))
      .rejects.toBeInstanceOf(ProviderNoDataError)
    expect(divingFish.getPlayerRating).not.toHaveBeenCalled()
    expect(repositories.setting.get).not.toHaveBeenCalled()
  })

  it('ignores saved provider preference for non-self queries', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.setting.get).mockResolvedValue('lxns')
    const divingResponse = successfulRating('Diving Fish Player')
    const divingFish = fakeProvider('diving-fish', {
      getPlayerRating: vi.fn(async () => divingResponse),
    })
    const lxns = fakeProvider('lxns')
    const chain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: { divingFish, lxns },
    })

    const result = await chain.rating({ ...username(), isSelf: false })

    expect(result.provider.id).toBe('diving-fish')
    expect(repositories.setting.get).not.toHaveBeenCalled()
    expect(lxns.getPlayerRating).not.toHaveBeenCalled()
  })

  it('keeps Kotlin exception priority in auto mode and converts QQ not-found to binding-required', async () => {
    const repositories = createRepositories()
    vi.mocked(repositories.setting.get).mockResolvedValue('auto')
    const privacyChain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: {
        divingFish: fakeProvider('diving-fish', {
          getPlayerRating: vi.fn(async () => { throw new ProviderAuthorizationError('diving-fish') }),
        }),
        lxns: fakeProvider('lxns', {
          getPlayerRating: vi.fn(async () => { throw new ProviderPrivacyError('lxns') }),
        }),
      },
    })
    const noDataChain = new ProviderChain({
      data: createStore(),
      repositories,
      providers: {
        divingFish: fakeProvider('diving-fish', {
          getPlayerRating: vi.fn(async () => { throw new ProviderNotFoundError('diving-fish') }),
        }),
        lxns: fakeProvider('lxns'),
      },
    })

    await expect(privacyChain.rating(username())).rejects.toBeInstanceOf(ProviderPrivacyError)
    await expect(noDataChain.rating(qq())).rejects.toBeInstanceOf(ProviderNoDataError)
  })

  it('immediately rethrows OAuth-required in auto mode after an earlier privacy failure', async () => {
    const chain = new ProviderChain({
      data: createStore(),
      repositories: createRepositories(),
      providers: {
        divingFish: fakeProvider('diving-fish', {
          getPlayerRating: vi.fn(async () => { throw new ProviderPrivacyError('diving-fish') }),
        }),
        lxns: fakeProvider('lxns', {
          getPlayerRating: vi.fn(async () => { throw new ProviderOAuthRequiredError('lxns') }),
        }),
      },
    })

    await expect(chain.rating(username())).rejects.toBeInstanceOf(ProviderOAuthRequiredError)
  })

  it.each(['maxscore', '理论', '理论值'])('generates %s theoretical ratings and records without remote calls', async alias => {
    const repositories = createRepositories()
    const divingFish = fakeProvider('diving-fish')
    const lxns = fakeProvider('lxns')
    const store = createStore()
    const chain = new ProviderChain({
      data: store,
      repositories,
      providers: { divingFish, lxns },
    })
    const query = username(alias)

    const rating = await chain.rating(query)
    const records = await chain.records(query, [...store.musics.values()])
    const single = await chain.record(query, store.musics.get(1) as MusicInfo)

    expect(rating.response.player.nickname).toBe('理论值')
    expect(rating.response.player.course).toBe(23)
    expect(rating.response.oldRatingList).toHaveLength(1)
    expect(rating.response.newRatingList).toHaveLength(1)
    expect(records.response.records).toHaveLength(2)
    expect(single.response).toHaveLength(1)
    expect(records.response.records.every(record => (
      record.achievement === 1_010_000
      && record.comboStatus.value === 'app'
      && record.syncStatus.value === 'fsdp'
      && record.deluxeScore === record.chart.maxDeluxeScore
    ))).toBe(true)
    expect(divingFish.getPlayerRating).not.toHaveBeenCalled()
    expect(divingFish.getPlayerRecords).not.toHaveBeenCalled()
    expect(lxns.getPlayerRating).not.toHaveBeenCalled()
    expect(lxns.getPlayerRecords).not.toHaveBeenCalled()
  })
})
