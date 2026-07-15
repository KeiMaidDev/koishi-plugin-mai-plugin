import { randomBytes as secureRandomBytes } from 'node:crypto'

export const CALLBACK_TOKEN_TTL_MS = 10 * 60 * 1_000
export const CALLBACK_CLEANUP_INTERVAL_MS = 60_000

export type CallbackTokenErrorCode = 'unknown-token' | 'expired-token' | 'store-full'

export class CallbackTokenError extends Error {
  constructor(readonly code: CallbackTokenErrorCode) {
    super(code)
    this.name = 'CallbackTokenError'
  }
}

export interface CallbackStoreOptions {
  now?: () => number
  ttlMs?: number
  cleanupIntervalMs?: number
  maxEntries?: number
  randomBytes?: () => Buffer
}

interface CallbackEntry<T> {
  value: T
  expiresAt: number
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/

export class CallbackStore<T> {
  private readonly entries = new Map<string, CallbackEntry<T>>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly randomBytes: () => Buffer
  private readonly cleanupTimer: ReturnType<typeof setInterval>
  private disposed = false

  constructor(options: CallbackStoreOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? CALLBACK_TOKEN_TTL_MS
    this.maxEntries = options.maxEntries ?? 4_096
    this.randomBytes = options.randomBytes ?? (() => secureRandomBytes(32))
    this.cleanupTimer = setInterval(
      () => this.sweep(),
      options.cleanupIntervalMs ?? CALLBACK_CLEANUP_INTERVAL_MS,
    )
    this.cleanupTimer.unref?.()
  }

  get size() {
    return this.entries.size
  }

  issue(value: T) {
    if (this.disposed) throw new CallbackTokenError('unknown-token')
    this.sweep()
    if (this.entries.size >= this.maxEntries) throw new CallbackTokenError('store-full')
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const bytes = this.randomBytes()
      if (bytes.byteLength !== 32) {
        throw new Error('[mai-plugin] callback token generator must return exactly 32 bytes.')
      }
      const token = bytes.toString('base64url')
      if (this.entries.has(token)) continue
      this.entries.set(token, { value, expiresAt: this.now() + this.ttlMs })
      return token
    }
    throw new Error('[mai-plugin] callback token generator produced repeated collisions.')
  }

  peek(token: string) {
    return this.read(token, false)
  }

  consume(token: string) {
    return this.read(token, true)
  }

  sweep() {
    const now = this.now()
    let removed = 0
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt > now) continue
      this.entries.delete(token)
      removed += 1
    }
    return removed
  }

  clear() {
    this.entries.clear()
  }

  deleteWhere(predicate: (value: T) => boolean) {
    this.sweep()
    let removed = 0
    for (const [token, entry] of this.entries) {
      if (!predicate(entry.value)) continue
      this.entries.delete(token)
      removed += 1
    }
    return removed
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.cleanupTimer)
    this.clear()
  }

  private read(token: string, consume: boolean) {
    if (this.disposed || !TOKEN_PATTERN.test(token)) {
      throw new CallbackTokenError('unknown-token')
    }
    const entry = this.entries.get(token)
    if (!entry) throw new CallbackTokenError('unknown-token')
    if (consume) this.entries.delete(token)
    if (entry.expiresAt <= this.now()) {
      if (!consume) this.entries.delete(token)
      throw new CallbackTokenError('expired-token')
    }
    return entry.value
  }
}
