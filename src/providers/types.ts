import type { Config } from '../config'
import type { Context, HTTP } from 'koishi'
import type { MaimaiDataStore } from '../data/sync-service'
import type { MaiRepositories } from '../database/repositories'
import type { MusicInfo, RecordEntry } from '../domain/music'
import type { PlayerSettings, RatingResponse, RecordsResponse } from '../domain/player'
import {
  findCancellationError,
  isProviderError,
  ProviderMalformedPayloadError,
  ProviderTimeoutError,
  ProviderTransportError,
} from './errors'

export const PROVIDER_CONNECT_TIMEOUT_MS = 60_000
export const PROVIDER_TOTAL_TIMEOUT_MS = 60_000

export type ProviderId = 'diving-fish' | 'lxns'
export type ProviderMode = ProviderId | 'auto'

export interface UserQueryBase {
  userId?: string
  isSelf?: boolean
  settings?: PlayerSettings | null
  provider?: ProviderMode
}

export type UserQuery = UserQueryBase & ({
  type: 'qq'
  qq: string | number
} | {
  type: 'username'
  username: string
})

export type ProviderHttpConfig = HTTP.RequestConfig
export type ProviderHttpResponse<T = unknown> = HTTP.Response<T>
export type ProviderHttp = Context['http']

export interface ProviderContext {
  http: ProviderHttp
}

export interface ProviderLogger {
  warn(message: string): void
}

export interface ProviderOptions {
  ctx: ProviderContext
  config: Config
  data: MaimaiDataStore
  repositories: MaiRepositories
  logger?: ProviderLogger
  connectTimeoutMs?: number
  totalTimeoutMs?: number
  now?: () => Date
}

export interface MaimaiProvider {
  readonly id: ProviderId
  readonly name: string
  getPlayerRating(user: UserQuery): Promise<RatingResponse>
  getPlayerRecord(user: UserQuery, music: MusicInfo): Promise<RecordEntry[]>
  getPlayerRecords(user: UserQuery, musics: MusicInfo[]): Promise<RecordsResponse>
  getPlayerRecent?(user: UserQuery): Promise<RecordsResponse>
}

export interface ProviderResult<T> {
  response: T
  provider: MaimaiProvider
}

export interface ProviderJsonRequest {
  label: string
  method: HTTP.Method
  url: string
  headers?: Record<string, string>
  data?: unknown
}

function timeoutFromCause(provider: ProviderId, error: unknown) {
  const seen = new Set<unknown>()
  let current = error
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current)
    if (current instanceof ProviderTimeoutError) return current
    if ((current as { code?: unknown }).code === 'ETIMEDOUT') {
      return new ProviderTimeoutError(provider)
    }
    current = (current as { cause?: unknown }).cause
  }
  return null
}

export class ProviderHttpClient {
  private readonly connectTimeoutMs: number
  private readonly totalTimeoutMs: number

  constructor(
    private readonly provider: ProviderId,
    private readonly ctx: ProviderContext,
    private readonly logger?: ProviderLogger,
    options: { connectTimeoutMs?: number; totalTimeoutMs?: number } = {},
  ) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? PROVIDER_CONNECT_TIMEOUT_MS
    this.totalTimeoutMs = options.totalTimeoutMs ?? PROVIDER_TOTAL_TIMEOUT_MS
  }

  async json<T = unknown>(request: ProviderJsonRequest) {
    const controller = new AbortController()
    let connected = false
    const connectTimer = setTimeout(() => {
      if (!connected) controller.abort(new ProviderTimeoutError(this.provider, 'Provider connection timed out.'))
    }, this.connectTimeoutMs)

    try {
      const response = await this.ctx.http<T>(request.url, {
        method: request.method,
        headers: request.headers,
        data: request.data,
        timeout: this.totalTimeoutMs,
        signal: controller.signal,
        validateStatus: () => true,
        responseType: async (raw) => {
          connected = true
          clearTimeout(connectTimer)
          const text = await raw.text()
          if (!text) return null
          try {
            return JSON.parse(text)
          } catch {
            throw new ProviderMalformedPayloadError(this.provider, 'Provider response is not valid JSON.')
          }
        },
      })
      connected = true
      return response
    } catch (error) {
      const timeout = timeoutFromCause(this.provider, error)
      if (timeout) {
        this.logger?.warn(`[mai-plugin] ${this.provider} ${request.label} request failed (timeout).`)
        throw timeout
      }
      const cancellation = findCancellationError(error)
      if (cancellation) throw cancellation
      this.logger?.warn(`[mai-plugin] ${this.provider} ${request.label} request failed (transport).`)
      if (isProviderError(error)) throw error
      throw new ProviderTransportError(this.provider)
    } finally {
      clearTimeout(connectTimer)
    }
  }
}
