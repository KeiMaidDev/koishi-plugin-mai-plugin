import { randomBytes as secureRandomBytes } from 'node:crypto'
import type { Awaitable } from '../types'
import { hasAuthority } from './admin'

const TOKEN_BYTES = 18
const TOKEN_PATTERN = /^mai:[A-Za-z0-9_-]{24}$/

export interface SearchPaginationPayload {
  mode: 'search'
  query: string
  page: number
}

export interface LevelPaginationPayload {
  mode: 'level'
  filter: string
  page: number
}

export interface ScoreListPaginationPayload {
  mode: 'score-list'
  filter: string
  page: number
}

export type PaginationPayload =
  | SearchPaginationPayload
  | LevelPaginationPayload
  | ScoreListPaginationPayload

export interface CallbackDispatchContext {
  userId: string
  channelId: string
  authority?: number
  permissions?: readonly string[]
}

export type CallbackHandler<Payload, Result = unknown> = (
  payload: Payload,
  context: CallbackDispatchContext,
) => Awaitable<Result>

export interface CallbackRegistration<Payload, Result = unknown> {
  kind: string
  payload: Payload
  expectedUserId: string
  expectedChannelId: string
  ttlMs?: number
  requiredAuthority?: number
  requiredPermission?: string
  handler: CallbackHandler<Payload, Result>
}

export type PaginationCallbackRegistration<
  Payload extends PaginationPayload,
  Result = unknown,
> = Omit<CallbackRegistration<Payload, Result>, 'kind'>

export interface CommandCallbackRouterOptions {
  capacity?: number
  ttlMs?: number
  now?: () => number
  randomBytes?: (size: number) => Uint8Array
}

export type CallbackRejectionReason =
  | 'malformed-token'
  | 'unknown-token'
  | 'expired-token'
  | 'user-mismatch'
  | 'channel-mismatch'
  | 'insufficient-authority'
  | 'missing-permission'

export type CallbackDispatchResult<Result = unknown> =
  | { ok: true, kind: string, value: Result }
  | { ok: false, reason: CallbackRejectionReason }

interface StoredCallback {
  kind: string
  payload: unknown
  expectedUserId: string
  expectedChannelId: string
  expiresAt: number
  requiredAuthority?: number
  requiredPermission?: string
  reusable: boolean
  handler: CallbackHandler<unknown>
}

function positiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer.`)
  }
  return value
}

function nonEmpty(value: string, name: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${name} must be a non-empty string.`)
  }
  return value
}

function clonePayload<Payload>(payload: Payload): Payload {
  return structuredClone(payload)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value: object, key: PropertyKey) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function validatePaginationPayload(payload: unknown): asserts payload is PaginationPayload {
  if (!isPlainObject(payload)) {
    throw new TypeError('Pagination payload must be a plain object.')
  }
  if (!hasOwn(payload, 'mode') || !hasOwn(payload, 'page')) {
    throw new TypeError('Pagination payload must contain plain own properties.')
  }
  positiveInteger(payload.page as number, 'Pagination page')
  if (payload.mode === 'search') {
    if (!hasOwn(payload, 'query')) {
      throw new TypeError('Pagination payload must contain plain own properties.')
    }
    if (typeof payload.query !== 'string') {
      throw new TypeError('Search pagination query must be a string.')
    }
    return
  }
  if (payload.mode === 'level' || payload.mode === 'score-list') {
    if (!hasOwn(payload, 'filter')) {
      throw new TypeError('Pagination payload must contain plain own properties.')
    }
    if (typeof payload.filter !== 'string') {
      throw new TypeError('Pagination filter must be a string.')
    }
    return
  }
  throw new TypeError('Unsupported pagination mode.')
}

export class CommandCallbackRouter {
  private readonly callbacks = new Map<string, StoredCallback>()
  private readonly capacity: number
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly randomBytes: (size: number) => Uint8Array

  constructor(options: CommandCallbackRouterOptions = {}) {
    this.capacity = positiveInteger(options.capacity ?? 256, 'Callback capacity')
    this.ttlMs = positiveInteger(options.ttlMs ?? 5 * 60_000, 'Callback TTL')
    this.now = options.now ?? Date.now
    this.randomBytes = options.randomBytes ?? secureRandomBytes
  }

  get size() {
    this.pruneExpired(this.now())
    return this.callbacks.size
  }

  clear() {
    this.callbacks.clear()
  }

  register<Payload, Result = unknown>(
    registration: CallbackRegistration<Payload, Result>,
  ) {
    return this.store(registration, false)
  }

  registerPagination<Payload extends PaginationPayload, Result = unknown>(
    registration: PaginationCallbackRegistration<Payload, Result>,
  ) {
    const payload = clonePayload(registration.payload)
    validatePaginationPayload(payload)
    return this.store({ ...registration, payload, kind: 'pagination' }, true)
  }

  async dispatch(
    data: unknown,
    context: CallbackDispatchContext,
  ): Promise<CallbackDispatchResult> {
    if (typeof data !== 'string' || !TOKEN_PATTERN.test(data)) {
      return { ok: false, reason: 'malformed-token' }
    }
    const state = this.callbacks.get(data)
    if (!state) return { ok: false, reason: 'unknown-token' }

    if (this.now() >= state.expiresAt) {
      this.callbacks.delete(data)
      return { ok: false, reason: 'expired-token' }
    }
    if (context.userId !== state.expectedUserId) {
      return { ok: false, reason: 'user-mismatch' }
    }
    if (context.channelId !== state.expectedChannelId) {
      return { ok: false, reason: 'channel-mismatch' }
    }
    if (state.requiredAuthority !== undefined
      && !hasAuthority(context, state.requiredAuthority)) {
      return { ok: false, reason: 'insufficient-authority' }
    }
    if (state.requiredPermission
      && !context.permissions?.includes(state.requiredPermission)) {
      return { ok: false, reason: 'missing-permission' }
    }

    if (!state.reusable) this.callbacks.delete(data)
    const value = await state.handler(clonePayload(state.payload), context)
    return { ok: true, kind: state.kind, value }
  }

  private store<Payload, Result>(
    registration: CallbackRegistration<Payload, Result>,
    reusable: boolean,
  ) {
    const kind = nonEmpty(registration.kind, 'Callback kind')
    const expectedUserId = nonEmpty(registration.expectedUserId, 'Expected user ID')
    const expectedChannelId = nonEmpty(registration.expectedChannelId, 'Expected channel ID')
    const ttlMs = positiveInteger(registration.ttlMs ?? this.ttlMs, 'Callback TTL')
    if (registration.requiredAuthority !== undefined
      && (!Number.isFinite(registration.requiredAuthority)
        || registration.requiredAuthority < 0)) {
      throw new RangeError('Required authority must be a non-negative number.')
    }
    if (registration.requiredPermission !== undefined) {
      nonEmpty(registration.requiredPermission, 'Required permission')
    }

    const now = this.now()
    this.pruneExpired(now)
    while (this.callbacks.size >= this.capacity) {
      const oldest = this.callbacks.keys().next().value
      if (oldest === undefined) break
      this.callbacks.delete(oldest)
    }

    const token = this.createToken()
    this.callbacks.set(token, {
      kind,
      payload: clonePayload(registration.payload),
      expectedUserId,
      expectedChannelId,
      expiresAt: now + ttlMs,
      requiredAuthority: registration.requiredAuthority,
      requiredPermission: registration.requiredPermission,
      reusable,
      handler: registration.handler as CallbackHandler<unknown>,
    })
    return token
  }

  private createToken() {
    for (let attempt = 0; attempt < 16; attempt++) {
      const bytes = this.randomBytes(TOKEN_BYTES)
      if (!(bytes instanceof Uint8Array) || bytes.byteLength !== TOKEN_BYTES) {
        throw new TypeError(`randomBytes must return ${TOKEN_BYTES} bytes.`)
      }
      const encoded = Buffer
        .from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        .toString('base64url')
      const token = `mai:${encoded}`
      if (!this.callbacks.has(token)) return token
    }
    throw new Error('Unable to allocate a unique callback token.')
  }

  private pruneExpired(now: number) {
    for (const [token, state] of this.callbacks) {
      if (now >= state.expiresAt) this.callbacks.delete(token)
    }
  }
}
