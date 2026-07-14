import type { BindRepository, SettingRepository } from '../database/repositories'
import type { MusicInfo } from '../domain/music'
import { PlayerSettings } from '../domain/player'
import type { ProviderChain } from '../providers/provider-chain'
import type { ProviderMode, UserQuery } from '../providers/types'
import type { SettingService } from './setting-service'

export interface PendingCommandScope {
  userId: string
  sessionId: string
}

export interface PendingCommandCacheOptions {
  maxEntries?: number
  ttlMs?: number
  now?: () => number
}

interface PendingCommandEntry {
  command: string
  expiresAt: number
}

const DEFAULT_PENDING_COMMAND_LIMIT = 128
const DEFAULT_PENDING_COMMAND_TTL_MS = 5 * 60 * 1_000

function pendingCommandKey(scope: PendingCommandScope) {
  return JSON.stringify([scope.userId, scope.sessionId])
}

export class PendingCommandCache {
  private readonly entries = new Map<string, PendingCommandEntry>()
  private readonly maxEntries: number
  private readonly ttlMs: number
  private readonly now: () => number

  constructor(options: PendingCommandCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_PENDING_COMMAND_LIMIT
    this.ttlMs = options.ttlMs ?? DEFAULT_PENDING_COMMAND_TTL_MS
    this.now = options.now ?? Date.now
    if (!Number.isSafeInteger(this.maxEntries) || this.maxEntries < 1) {
      throw new RangeError('Pending command cache maxEntries must be a positive integer.')
    }
    if (!Number.isFinite(this.ttlMs) || this.ttlMs <= 0) {
      throw new RangeError('Pending command cache ttlMs must be positive.')
    }
  }

  get size() {
    this.pruneExpired()
    return this.entries.size
  }

  set(scope: PendingCommandScope, command: string) {
    const now = this.now()
    this.pruneExpired(now)
    const key = pendingCommandKey(scope)
    this.entries.delete(key)
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
    this.entries.set(key, { command, expiresAt: now + this.ttlMs })
  }

  consume(scope: PendingCommandScope) {
    const now = this.now()
    this.pruneExpired(now)
    const key = pendingCommandKey(scope)
    const entry = this.entries.get(key)
    if (!entry) return null
    this.entries.delete(key)
    return entry.command
  }

  private pruneExpired(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key)
    }
  }
}

export class QqBindingRequiredError extends Error {
  constructor(readonly scope: PendingCommandScope) {
    super('A QQ binding is required before querying the current user.')
    this.name = 'QqBindingRequiredError'
  }
}

export class QueryTargetBindingRequiredError extends Error {
  constructor(readonly targetUserId: string) {
    super('The mentioned query target has no QQ binding.')
    this.name = 'QueryTargetBindingRequiredError'
  }
}

export interface QueryMention {
  userId: string
  qq?: string | number
  isBot?: boolean
  isSelf?: boolean
}

export interface QuerySession extends PendingCommandScope {
  command: string
  mentions?: readonly QueryMention[]
}

type BindRepositoryPort = Pick<BindRepository, 'getQq'>
type SettingRepositoryPort = Pick<SettingRepository, 'get' | 'list'>

export interface QueryRepositoriesPort {
  bind: BindRepositoryPort
  setting: SettingRepositoryPort
}

export interface QueryServiceOptions {
  pendingCommands?: PendingCommandCache
  providerChain?: Pick<ProviderChain, 'rating' | 'record' | 'records' | 'recent'>
  settings?: Pick<SettingService, 'getSettings'>
}

function positiveInteger(value: string | null | undefined) {
  if (!value || !/^\d+$/.test(value.trim())) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

export function normalizeProviderPreference(value: string | null | undefined): ProviderMode {
  return value === 'diving-fish' || value === 'lxns' ? value : 'auto'
}

type PublicQueryTarget = {
  type: 'qq'
  qq: string | number
} | {
  type: 'username'
  username: string
}

function publicQuery(userId: string, target: PublicQueryTarget): UserQuery {
  if (target.type === 'qq') {
    return { ...target, userId, isSelf: false, provider: 'auto' }
  }
  return { ...target, userId, isSelf: false, provider: 'auto' }
}

export class QueryService {
  private readonly pendingCommands: PendingCommandCache
  private readonly providerChain?: QueryServiceOptions['providerChain']
  private readonly settings?: QueryServiceOptions['settings']

  constructor(
    private readonly repositories: QueryRepositoriesPort,
    options: QueryServiceOptions = {},
  ) {
    this.pendingCommands = options.pendingCommands ?? new PendingCommandCache()
    this.providerChain = options.providerChain
    this.settings = options.settings
  }

  async getQueryParams(session: QuerySession, queryArgs?: string | null): Promise<UserQuery> {
    const mention = session.mentions?.find(target => !target.isBot && !target.isSelf)
    if (mention) {
      const qq = mention.qq ?? await this.repositories.bind.getQq(mention.userId)
      if (qq === null || qq === undefined || String(qq).trim() === '') {
        throw new QueryTargetBindingRequiredError(mention.userId)
      }
      return publicQuery(session.userId, { type: 'qq', qq: String(qq) })
    }

    const target = queryArgs?.trim() ?? ''
    if (!target) return this.selfQuery(session)

    const qq = target.match(/^qq(\d+)$/i)
    if (qq) return publicQuery(session.userId, { type: 'qq', qq: qq[1] })
    return publicQuery(session.userId, { type: 'username', username: target })
  }

  consumePendingCommand(scope: PendingCommandScope) {
    return this.pendingCommands.consume(scope)
  }

  rating(user: UserQuery) {
    return this.requireProviderChain().rating(user)
  }

  record(user: UserQuery, music: MusicInfo) {
    return this.requireProviderChain().record(user, music)
  }

  records(user: UserQuery, musics: MusicInfo[]) {
    return this.requireProviderChain().records(user, musics)
  }

  recent(user: UserQuery) {
    return this.requireProviderChain().recent(user)
  }

  private async selfQuery(session: QuerySession): Promise<UserQuery> {
    const qq = await this.repositories.bind.getQq(session.userId)
    if (!qq) {
      const command = session.command.trim()
      if (command) this.pendingCommands.set(session, command)
      throw new QqBindingRequiredError(session)
    }

    if (this.settings) {
      const settings = await this.settings.getSettings(session.userId)
      return {
        type: 'qq',
        qq,
        userId: session.userId,
        isSelf: true,
        settings: new PlayerSettings(settings.avatar, settings.plate),
        provider: settings.provider,
      }
    }

    const stored = await this.repositories.setting.list(session.userId)
    return {
      type: 'qq',
      qq,
      userId: session.userId,
      isSelf: true,
      settings: new PlayerSettings(
        positiveInteger(stored.icon),
        positiveInteger(stored.plate),
      ),
      provider: normalizeProviderPreference(stored.prober),
    }
  }

  private requireProviderChain() {
    if (!this.providerChain) {
      throw new Error('[mai-plugin] query provider chain is not configured.')
    }
    return this.providerChain
  }
}
