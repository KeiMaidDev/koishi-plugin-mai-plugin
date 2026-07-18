import { open } from 'node:fs/promises'
import { join } from 'node:path'
import type { MusicInfo } from '../domain/music'
import type { DebugTracer } from '../utils/debug'
import { normalizeSearchText } from '../utils/strings'
import { CacheStore } from './cache-store'

export const LXNS_ALIAS_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/alias/list'
export const REMOTE_ALIAS_CACHE_SCHEMA_VERSION = 1
export const MAX_REMOTE_ALIAS_ENTRIES = 20_000
export const MAX_REMOTE_ALIAS_NAMES = 20_000
export const MAX_REMOTE_ALIAS_SOURCE_CODE_POINTS = 256_000
export const MAX_REMOTE_ALIASES_PER_MUSIC = 128
export const MAX_REMOTE_ALIAS_CODE_POINTS = 128
export const MAX_REMOTE_ALIAS_BYTES = 8 * 1024 * 1024

export type RemoteAliases = ReadonlyMap<number, readonly string[]>

export interface RemoteAliasCacheLogger {
  warn(message: string): void
}

export interface RemoteAliasCacheOptions {
  cacheDir: string
  timeoutMs: number
  fetch?: typeof fetch
  logger?: RemoteAliasCacheLogger
  debug?: DebugTracer
  now?: () => Date
}

export interface RemoteAliasCacheEntry {
  musicId: number
  names: string[]
}

export interface RemoteAliasCacheDocument {
  schemaVersion: typeof REMOTE_ALIAS_CACHE_SCHEMA_VERSION
  source: 'lxns'
  generatedAt: string
  aliases: RemoteAliasCacheEntry[]
}

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key))
}

function assertAliasArray(value: unknown): asserts value is string[] {
  if (!Array.isArray(value)) throw new TypeError('Alias names must be an array')
  if (value.length > MAX_REMOTE_ALIASES_PER_MUSIC) {
    throw new RangeError('Alias names exceed the per-music limit')
  }
  if (!value.every(name => typeof name === 'string')) {
    throw new TypeError('Alias names must contain only strings')
  }
}

function appendAliases(
  result: Map<number, string[]>,
  normalizedNames: Map<number, Set<string>>,
  musicId: number,
  sourceNames: string[],
) {
  const names = result.get(musicId) ?? []
  const seen = normalizedNames.get(musicId) ?? new Set<string>()
  for (const sourceName of sourceNames) {
    const name = sourceName.trim()
    if (
      !name
      || CONTROL_CHARACTERS.test(name)
      || [...name].length > MAX_REMOTE_ALIAS_CODE_POINTS
    ) continue
    const normalized = normalizeSearchText(name)
    if (!normalized || seen.has(normalized)) continue
    if (names.length >= MAX_REMOTE_ALIASES_PER_MUSIC) {
      throw new RangeError('Aliases exceed the per-music limit')
    }
    seen.add(normalized)
    names.push(name)
  }
  if (names.length) {
    result.set(musicId, names)
    normalizedNames.set(musicId, seen)
  }
}

function normalizeEntries(
  entries: unknown[],
  musics: ReadonlyMap<number, MusicInfo>,
  readEntry: (entry: unknown) => { musicId: number, names: string[] },
) {
  if (entries.length > MAX_REMOTE_ALIAS_ENTRIES) {
    throw new RangeError('Alias entries exceed the remote entry limit')
  }
  const result = new Map<number, string[]>()
  const normalizedNames = new Map<number, Set<string>>()
  let sourceNameCount = 0
  let sourceCodePointCount = 0
  for (const entry of entries) {
    const { musicId, names } = readEntry(entry)
    sourceNameCount += names.length
    if (sourceNameCount > MAX_REMOTE_ALIAS_NAMES) {
      throw new RangeError('Alias names exceed the remote payload limit')
    }
    for (const name of names) {
      for (const _codePoint of name) {
        sourceCodePointCount++
        if (sourceCodePointCount > MAX_REMOTE_ALIAS_SOURCE_CODE_POINTS) {
          throw new RangeError('Alias names exceed the remote code point budget')
        }
      }
    }
    if (!musics.has(musicId)) continue
    appendAliases(result, normalizedNames, musicId, names)
  }
  return result
}

function readLxnsEntry(entry: unknown) {
  if (!isRecord(entry) || !hasExactKeys(entry, ['song_id', 'aliases'])) {
    throw new TypeError('LXNS alias entry has an invalid schema')
  }
  if (!Number.isSafeInteger(entry.song_id) || (entry.song_id as number) <= 0) {
    throw new TypeError('LXNS alias entry has an unsafe song ID')
  }
  assertAliasArray(entry.aliases)
  return { musicId: entry.song_id as number, names: entry.aliases }
}

function readCacheEntry(entry: unknown) {
  if (!isRecord(entry) || !hasExactKeys(entry, ['musicId', 'names'])) {
    throw new TypeError('Alias cache entry has an invalid schema')
  }
  if (!Number.isSafeInteger(entry.musicId) || (entry.musicId as number) <= 0) {
    throw new TypeError('Alias cache entry has an unsafe music ID')
  }
  assertAliasArray(entry.names)
  return { musicId: entry.musicId as number, names: entry.names }
}

export function normalizeLxnsAliases(
  payload: unknown,
  musics: ReadonlyMap<number, MusicInfo>,
): Map<number, string[]> {
  if (!isRecord(payload) || !hasExactKeys(payload, ['aliases']) || !Array.isArray(payload.aliases)) {
    throw new TypeError('LXNS alias payload has an invalid schema')
  }
  return normalizeEntries(payload.aliases, musics, readLxnsEntry)
}

function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = ISO_DATE_TIME.exec(value)
  if (!match || !Number.isFinite(Date.parse(value))) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth[month - 1]
}

export function parseAliasCache(
  payload: unknown,
  musics: ReadonlyMap<number, MusicInfo>,
): Map<number, string[]> {
  if (
    !isRecord(payload)
    || !hasExactKeys(payload, ['schemaVersion', 'source', 'generatedAt', 'aliases'])
    || payload.schemaVersion !== REMOTE_ALIAS_CACHE_SCHEMA_VERSION
    || payload.source !== 'lxns'
    || !isValidIsoDate(payload.generatedAt)
    || !Array.isArray(payload.aliases)
  ) {
    throw new TypeError('Alias cache payload has an invalid schema')
  }
  return normalizeEntries(payload.aliases, musics, readCacheEntry)
}

export function serializeAliasCache(aliases: RemoteAliases, generatedAt: string) {
  if (!isValidIsoDate(generatedAt)) throw new TypeError('Alias cache date must be a valid ISO date')
  const document: RemoteAliasCacheDocument = {
    schemaVersion: REMOTE_ALIAS_CACHE_SCHEMA_VERSION,
    source: 'lxns',
    generatedAt,
    aliases: [...aliases]
      .sort(([left], [right]) => left - right)
      .map(([musicId, names]) => ({ musicId, names: [...names] })),
  }
  return `${JSON.stringify(document, null, 2)}\n`
}

function aliasCounts(aliases: RemoteAliases) {
  let aliasCount = 0
  for (const names of aliases.values()) aliasCount += names.length
  return { songs: aliases.size, aliases: aliasCount }
}

function validateLxnsAliasUrl(url: URL) {
  if (
    url.protocol !== 'https:'
    || url.hostname.toLowerCase() !== 'maimai.lxns.net'
    || url.port
    || url.username
    || url.password
    || url.pathname !== '/api/v0/maimai/alias/list'
    || url.search
    || url.hash
  ) {
    throw new Error('LXNS alias URL is not allowed')
  }
}

async function readAliasJson(path: string): Promise<unknown> {
  const handle = await open(path, 'r')
  try {
    const metadata = await handle.stat()
    if (metadata.size > MAX_REMOTE_ALIAS_BYTES) {
      throw new RangeError('Alias cache exceeds the remote byte limit')
    }
    const contents = await handle.readFile()
    if (contents.byteLength > MAX_REMOTE_ALIAS_BYTES) {
      throw new RangeError('Alias cache exceeds the remote byte limit')
    }
    return JSON.parse(contents.toString('utf8'))
  } finally {
    await handle.close()
  }
}

export class RemoteAliasCache {
  private readonly cache: CacheStore
  private readonly logger: RemoteAliasCacheLogger
  private readonly now: () => Date

  constructor(private readonly options: RemoteAliasCacheOptions) {
    this.cache = new CacheStore(options.cacheDir, options.fetch ?? fetch)
    this.logger = options.logger ?? console
    this.now = options.now ?? (() => new Date())
  }

  async startup(musics: ReadonlyMap<number, MusicInfo>): Promise<Map<number, string[]>> {
    const cachePath = join(this.options.cacheDir, 'aliases.json')
    try {
      const cached = parseAliasCache(await readAliasJson(cachePath), musics)
      const counts = aliasCounts(cached)
      if (counts.aliases) {
        this.options.debug?.event('alias.cache.hit', { source: 'cache', ...counts })
        return cached
      }
      this.options.debug?.event('alias.cache.miss', { source: 'cache', status: 'empty', ...counts })
    } catch (error) {
      this.options.debug?.failure('alias.cache.miss', error, { source: 'cache', status: 'invalid' })
    }

    let stagingDirectory: string | undefined
    try {
      stagingDirectory = await this.cache.createStagingDirectory()
      const downloadedPath = join(stagingDirectory, 'aliases.json')
      await this.cache.downloadComputed(LXNS_ALIAS_LIST_URL, downloadedPath, {
        timeoutMs: this.options.timeoutMs,
        maxBytes: MAX_REMOTE_ALIAS_BYTES,
        validateUrl: validateLxnsAliasUrl,
      })
      const aliases = normalizeLxnsAliases(await readAliasJson(downloadedPath), musics)
      const counts = aliasCounts(aliases)
      if (!counts.aliases) throw new Error('LXNS alias payload contains no valid aliases')
      const serialized = serializeAliasCache(aliases, this.now().toISOString())
      if (Buffer.byteLength(serialized, 'utf8') > MAX_REMOTE_ALIAS_BYTES) {
        throw new RangeError('Serialized alias cache exceeds the remote byte limit')
      }
      await this.cache.writeAtomic(cachePath, serialized)
      this.options.debug?.event('alias.cache.sync', { source: 'lxns', ...counts })
      return aliases
    } catch (error) {
      this.logger.warn('[mai-plugin] remote aliases are unavailable; continuing without remote aliases.')
      this.options.debug?.failure('alias.cache.failure', error, { source: 'lxns' })
      return new Map()
    } finally {
      if (stagingDirectory) {
        try {
          await this.cache.discardStagingDirectory(stagingDirectory)
        } catch (error) {
          this.options.debug?.failure('alias.cache.cleanup.failure', error, { source: 'staging' })
        }
      }
    }
  }
}
