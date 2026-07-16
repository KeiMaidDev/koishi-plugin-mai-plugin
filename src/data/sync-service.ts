import { readFile, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import type { Config } from '../config'
import type { GameVersion, MusicInfo } from '../domain/music'
import { resolvePackageAssetPath } from '../render/assets'
import type { DebugTracer } from '../utils/debug'
import { CacheStore, type CachedSnapshot } from './cache-store'
import { LxnsAssetCache } from './lxns-assets'
import { inspectFile, parseResourceManifest, sha256, type ResourceManifest, type ResourceManifestFile } from './manifest'
import {
  normalizeMaimaiSource,
  type CourseInfo,
  type IconInfo,
  type NormalizedMaimaiSource,
  type PlateInfo,
} from './normalizers'

const DEFAULT_PROBER_DATA_URL = 'https://www.diving-fish.com/api/maimaidxprober/music_data'
const LXNS_SONG_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/song/list'
const LXNS_ICON_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/icon/list'
const LXNS_PLATE_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/plate/list'
const FALLBACK_COVER = resolvePackageAssetPath('fallback/cover.png')
const FALLBACK_AVATAR = resolvePackageAssetPath('fallback/avatar.png')
const FALLBACK_PLATE = resolvePackageAssetPath('fallback/plate.png')

const BUILTIN_SOURCE = {
  revision: 'builtin-minimal-v1',
  versions: [{ id: 0, name: 'maimai', version: 0 }],
  musics: [{
    id: 1,
    name: 'maimai',
    type: 'SD',
    rights: '',
    artist: '',
    genre: 'maimai',
    bpm: 0,
    version: 'maimai',
    isNew: false,
    charts: [{
      difficulty: 0,
      level: '1',
      levelValue: 1,
      notes: [0, 0, 0, 0],
      notesDesigner: '',
    }],
  }],
  plates: [],
  icons: [],
  courses: [],
} as const

export interface DataSyncLogger {
  warn(message: string): void
}

export interface MaimaiDataSyncOptions {
  config: Config['resourceSync']
  lxnsDeveloperToken?: string
  fetch?: typeof fetch
  logger?: DataSyncLogger
  proberDataUrl?: string
  builtinSource?: unknown | null
  debug?: DebugTracer
}

export interface MaimaiAssetInvalidationEvent {
  revision: string
  paths: readonly string[]
}

export type MaimaiAssetInvalidationListener = (event: MaimaiAssetInvalidationEvent) => void

export interface MaimaiAssetInvalidationSource {
  onAssetInvalidation(listener: MaimaiAssetInvalidationListener): () => void
}

export class MissingMaimaiDataError extends Error {
  constructor(readonly missing: string[], causes: unknown[] = []) {
    const details = causes.length
      ? ` (${causes.map(error => error instanceof Error ? error.message : String(error)).join('; ')})`
      : ''
    super(`[mai-plugin] missing minimum data: ${missing.join(', ')}${details}`)
    this.name = 'MissingMaimaiDataError'
  }
}

function resourceIdFromPath(path: string) {
  const match = basename(path).match(/^(\d+)(?:_s)?\.[^.]+$/i)
  return match ? Number(match[1]) : undefined
}

export class MaimaiDataStore {
  readonly versions: Map<string, GameVersion>
  readonly musics: Map<number, MusicInfo>
  readonly plates: Map<number, PlateInfo>
  readonly icons: Map<number, IconInfo>
  readonly courses: Map<number, CourseInfo>
  private readonly covers = new Map<number, string>()
  private readonly coverThumbnails = new Map<number, string>()
  private readonly avatars = new Map<number, string>()
  private readonly plateImages = new Map<number, string>()
  readonly assetPaths: readonly string[]

  constructor(
    data: NormalizedMaimaiSource,
    readonly manifest: ResourceManifest,
    files: Map<string, string>,
    private readonly remoteAssets?: LxnsAssetCache,
  ) {
    this.assetPaths = Object.freeze([...files.values()])
    this.versions = data.versions
    this.musics = data.musics
    this.plates = data.plates
    this.icons = data.icons
    this.courses = data.courses
    for (const [relativePath, absolutePath] of files) {
      const normalized = relativePath.replaceAll('\\', '/')
      const id = resourceIdFromPath(normalized)
      if (id === undefined) continue
      if (/\/covers\/\d+_s\.jpg$/i.test(normalized)) this.coverThumbnails.set(id, absolutePath)
      else if (/\/covers\/\d+\.(?:png|jpe?g|webp)$/i.test(normalized)) this.covers.set(id, absolutePath)
      else if (/\/(?:avatars|icons)\/\d+\.(?:png|jpe?g|webp)$/i.test(normalized)) this.avatars.set(id, absolutePath)
      else if (/\/plates\/\d+\.(?:png|jpe?g|webp)$/i.test(normalized)) this.plateImages.set(id, absolutePath)
    }
  }

  coverPath(resourceId: number, thumbnail = false) {
    const local = (thumbnail ? this.coverThumbnails.get(resourceId) : this.covers.get(resourceId))
      ?? this.covers.get(resourceId)
    if (local) return local
    const remote = this.remoteAssets?.resolve('jacket', resourceId, FALLBACK_COVER)
    return remote ? remote.then(path => path ?? FALLBACK_COVER) : FALLBACK_COVER
  }

  iconPath(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return FALLBACK_AVATAR
    const local = this.avatars.get(id)
    if (local) return local
    const remote = this.remoteAssets?.resolve('icon', id, FALLBACK_AVATAR)
    return remote ? remote.then(path => path ?? FALLBACK_AVATAR) : FALLBACK_AVATAR
  }

  avatarPath(id: number) {
    return this.iconPath(id)
  }

  platePath(id: number) {
    if (!Number.isSafeInteger(id) || id < 1) return FALLBACK_PLATE
    const local = this.plateImages.get(id)
    if (local) return local
    const remote = this.remoteAssets?.resolve('plate', id, FALLBACK_PLATE)
    return remote ? remote.then(path => path ?? FALLBACK_PLATE) : FALLBACK_PLATE
  }

  previewPath(resourceId: number) {
    return this.remoteAssets?.resolve('music', resourceId)
  }
}

function createRemoteUrlValidator(allowedHosts: string[]) {
  const allowed = new Set([
    'maimai.lxns.net',
    'www.diving-fish.com',
    ...allowedHosts.map(host => host.toLowerCase()),
  ])
  return (url: URL) => {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error(`Unsupported resource source protocol: ${url.protocol}`)
    }
    if (url.username || url.password) throw new Error('Remote resource URLs cannot contain credentials')
    if (!allowed.has(url.hostname.toLowerCase())) {
      throw new Error(`Remote resource host ${url.hostname} is not allowed`)
    }
  }
}

function ensureBaseUrl(value: string, validateUrl: (url: URL) => void) {
  const url = new URL(value)
  validateUrl(url)
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

export class MaimaiDataSyncService implements MaimaiAssetInvalidationSource {
  private readonly logger: DataSyncLogger
  private readonly cache: CacheStore
  private readonly proberDataUrl: string
  private readonly builtinSource: unknown | null
  private readonly validateRemoteUrl: (url: URL) => void
  private readonly assets: LxnsAssetCache
  private readonly assetInvalidationListeners = new Set<MaimaiAssetInvalidationListener>()
  private publishedAssetPaths = new Set<string>()

  constructor(private readonly options: MaimaiDataSyncOptions) {
    this.logger = options.logger ?? console
    this.cache = new CacheStore(options.config.cacheDir, options.fetch ?? fetch)
    this.assets = new LxnsAssetCache({
      cacheDir: options.config.cacheDir,
      timeoutMs: options.config.timeoutMs,
      fetch: options.fetch,
      logger: this.logger,
      debug: options.debug,
    })
    this.proberDataUrl = options.proberDataUrl === undefined ? DEFAULT_PROBER_DATA_URL : options.proberDataUrl
    this.builtinSource = options.builtinSource === undefined ? BUILTIN_SOURCE : options.builtinSource
    this.validateRemoteUrl = createRemoteUrlValidator(options.config.allowedHosts)
  }

  onAssetInvalidation(listener: MaimaiAssetInvalidationListener): () => void {
    this.assetInvalidationListeners.add(listener)
    return () => {
      this.assetInvalidationListeners.delete(listener)
    }
  }

  private complete(store: MaimaiDataStore) {
    const currentPaths = new Set(store.assetPaths)
    const affectedPaths = Object.freeze([...new Set([
      ...this.publishedAssetPaths,
      ...currentPaths,
    ])])
    this.publishedAssetPaths = currentPaths
    if (affectedPaths.length) {
      const event = Object.freeze({
        revision: store.manifest.revision,
        paths: affectedPaths,
      })
      for (const listener of this.assetInvalidationListeners) listener(event)
    }
    return store
  }

  private async generateCoverThumbnails(
    stagingDirectory: string,
    files: Record<string, ResourceManifestFile>,
    source: string,
  ) {
    for (const relativePath of Object.keys({ ...files })) {
      const normalized = relativePath.replaceAll('\\', '/')
      const match = normalized.match(/^covers\/(\d+)\.(?:png|jpe?g|webp)$/i)
      if (!match) continue
      const thumbnailPath = `covers/${match[1]}_s.jpg`
      const target = join(stagingDirectory, thumbnailPath)
      const contents = await sharp(join(stagingDirectory, relativePath))
        .resize(72, 72, { fit: 'cover' })
        .jpeg({ quality: 85, chromaSubsampling: '4:4:4' })
        .toBuffer()
      const metadata = await this.cache.writeAtomic(target, contents)
      files[thumbnailPath] = { ...metadata, source: `generated:${source}` }
    }
  }

  private async storeFromCache(snapshot?: CachedSnapshot) {
    const loaded = snapshot ?? await this.cache.loadSnapshot()
    const source = JSON.parse(await readFile(loaded.sourcePath, 'utf8'))
    const data = normalizeMaimaiSource(source, { revision: loaded.manifest.revision })
    return new MaimaiDataStore(data, loaded.manifest, loaded.files, this.assets)
  }

  private async syncLxnsSource() {
    const token = this.options.lxnsDeveloperToken?.trim()
    if (!token) throw new Error('LXNS developer token is unavailable')
    const staging = await this.cache.createStagingDirectory()
    try {
      const requests = [
        ['songs.json', LXNS_SONG_LIST_URL],
        ['icons.json', LXNS_ICON_LIST_URL],
        ['plates.json', LXNS_PLATE_LIST_URL],
      ] as const
      await Promise.all(requests.map(([filename, url]) => this.cache.downloadComputed(
        url,
        join(staging, filename),
        {
          timeoutMs: this.options.config.timeoutMs,
          maxBytes: 32 * 1024 * 1024,
          validateUrl: this.validateRemoteUrl,
          headers: { Authorization: token },
        },
      )))
      const [songs, icons, plates] = await Promise.all(requests.map(([filename]) => (
        readFile(join(staging, filename), 'utf8').then(JSON.parse)
      )))
      const source = {
        sourceType: 'lxns',
        ...songs,
        icons: icons.icons,
        plates: plates.plates,
      }
      const serialized = `${JSON.stringify(source)}\n`
      const revision = `lxns-${sha256(serialized).slice(0, 16)}`
      const persisted = { ...source, revision }
      normalizeMaimaiSource(persisted, { revision })
      const sourcePath = join(staging, 'source.json')
      const metadata = await this.cache.writeAtomic(sourcePath, `${JSON.stringify(persisted)}\n`)
      await Promise.all(requests.map(([filename]) => rm(join(staging, filename), { force: true })))
      await this.cache.commitSnapshot(staging, revision, {
        'source.json': { ...metadata, source: LXNS_SONG_LIST_URL },
      })
      return this.storeFromCache()
    } catch (error) {
      await this.cache.discardStagingDirectory(staging)
      throw error
    }
  }

  private async syncStaticSource() {
    const baseUrl = ensureBaseUrl(this.options.config.staticBaseUrl, this.validateRemoteUrl)
    const staging = await this.cache.createStagingDirectory()
    try {
      const remoteManifestPath = join(staging, '.remote-manifest.json')
      await this.cache.downloadComputed(
        new URL('manifest.json', baseUrl).href,
        remoteManifestPath,
        {
          timeoutMs: this.options.config.timeoutMs,
          maxBytes: 32 * 1024 * 1024,
          validateUrl: this.validateRemoteUrl,
        },
      )
      const remoteManifest = parseResourceManifest(JSON.parse(await readFile(remoteManifestPath, 'utf8')))
      await rm(remoteManifestPath, { force: true })
      if (!Object.keys(remoteManifest.files).includes('source.json')) {
        throw new Error('Static resource manifest is missing source.json')
      }
      const files: Record<string, ResourceManifestFile> = {}
      for (const [relativePath, metadata] of Object.entries(remoteManifest.files)) {
        await this.cache.downloadVerified(
          new URL(relativePath, baseUrl).href,
          join(staging, relativePath),
          metadata,
          {
            timeoutMs: this.options.config.timeoutMs,
            validateUrl: this.validateRemoteUrl,
          },
        )
        files[relativePath] = { ...metadata, source: metadata.source || baseUrl.href }
      }
      normalizeMaimaiSource(JSON.parse(await readFile(join(staging, 'source.json'), 'utf8')), {
        revision: remoteManifest.revision,
      })
      await this.generateCoverThumbnails(staging, files, baseUrl.href)
      await this.cache.commitSnapshot(staging, remoteManifest.revision, files)
      return this.storeFromCache()
    } catch (error) {
      await this.cache.discardStagingDirectory(staging)
      throw error
    }
  }

  private async syncProberSource() {
    const staging = await this.cache.createStagingDirectory()
    try {
      const sourcePath = join(staging, 'source.json')
      const metadata = await this.cache.downloadComputed(
        this.proberDataUrl,
        sourcePath,
        {
          timeoutMs: this.options.config.timeoutMs,
          maxBytes: 32 * 1024 * 1024,
          validateUrl: this.validateRemoteUrl,
        },
      )
      const source = JSON.parse(await readFile(sourcePath, 'utf8'))
      const data = normalizeMaimaiSource(source)
      await this.cache.commitSnapshot(staging, data.revision, {
        'source.json': { ...metadata, source: this.proberDataUrl },
      })
      return this.storeFromCache()
    } catch (error) {
      await this.cache.discardStagingDirectory(staging)
      throw error
    }
  }

  private async storeBuiltinSource() {
    if (this.builtinSource === null) throw new MissingMaimaiDataError(['versions', 'musics'])
    const data = normalizeMaimaiSource(this.builtinSource)
    const staging = await this.cache.createStagingDirectory()
    try {
      const sourcePath = join(staging, 'source.json')
      const metadata = await this.cache.writeAtomic(sourcePath, `${JSON.stringify(this.builtinSource, null, 2)}\n`)
      await this.cache.commitSnapshot(staging, data.revision, {
        'source.json': { ...metadata, source: 'builtin' },
      })
      return this.storeFromCache()
    } catch (error) {
      await this.cache.discardStagingDirectory(staging)
      throw error
    }
  }

  private async attemptSource(name: string, operation: () => Promise<MaimaiDataStore>) {
    const startedAt = Date.now()
    this.options.debug?.event('data.source.start', { source: name })
    try {
      const store = await operation()
      this.options.debug?.event('data.source.success', {
        source: name,
        durationMs: Date.now() - startedAt,
        revision: store.manifest.revision,
        musics: store.musics.size,
        icons: store.icons.size,
        plates: store.plates.size,
      })
      return store
    } catch (error) {
      this.options.debug?.failure('data.source.failure', error, {
        source: name,
        durationMs: Date.now() - startedAt,
      })
      throw error
    }
  }

  async startup() {
    const remoteErrors: unknown[] = []
    if (this.options.config.enabled) {
      try {
        return this.complete(await this.attemptSource('lxns', () => this.syncLxnsSource()))
      } catch (error) {
        remoteErrors.push(error)
      }
      if (this.proberDataUrl) {
        try {
          const store = await this.attemptSource('diving-fish', () => this.syncProberSource())
          if (remoteErrors.length) {
            this.logger.warn('[mai-plugin] LXNS data source is unavailable; using Diving Fish fallback.')
          }
          return this.complete(store)
        } catch (error) {
          remoteErrors.push(error)
        }
      }
      if (this.options.config.staticBaseUrl) {
        try {
          return this.complete(await this.attemptSource('static', () => this.syncStaticSource()))
        } catch (error) {
          remoteErrors.push(error)
        }
      }
    }

    try {
      const cached = await this.cache.loadSnapshot()
      this.options.debug?.event('data.source.cache', { revision: cached.manifest.revision })
      if (remoteErrors.length) {
        this.logger.warn(`[mai-plugin] resource synchronization failed; using cached revision ${cached.manifest.revision}`)
      }
      return this.complete(await this.storeFromCache(cached))
    } catch (cacheError) {
      try {
        const store = await this.storeBuiltinSource()
        this.options.debug?.event('data.source.builtin', { revision: store.manifest.revision })
        if (remoteErrors.length) {
          this.logger.warn('[mai-plugin] resource sources are unavailable; using builtin minimum data')
        }
        return this.complete(store)
      } catch (builtinError) {
        throw new MissingMaimaiDataError(
          ['versions', 'musics'],
          [...remoteErrors, cacheError, builtinError],
        )
      }
    }
  }
}
