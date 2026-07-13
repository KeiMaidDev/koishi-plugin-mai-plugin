import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import {
  canonicalResourcePath,
  inspectFile,
  parseResourceManifest,
  verifyFile,
  type ResourceManifest,
  type ResourceManifestFile,
} from './manifest'

export interface CachedSnapshot {
  manifest: ResourceManifest
  sourcePath: string
  files: Map<string, string>
}

export interface DownloadOptions {
  signal?: AbortSignal
  timeoutMs?: number
  validateUrl?: (url: URL) => void
}

function normalizedRelativePath(path: string) {
  return canonicalResourcePath(path)
}

function safeRevision(revision: string) {
  return revision.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'revision'
}

export class CacheStore {
  readonly manifestPath: string

  constructor(
    readonly cacheDir: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.cacheDir = resolve(cacheDir)
    this.manifestPath = join(this.cacheDir, 'manifest.json')
  }

  private path(relativePath: string) {
    const normalized = normalizedRelativePath(relativePath)
    const path = resolve(this.cacheDir, normalized)
    const relation = relative(this.cacheDir, path)
    if (relation.startsWith('..') || relation === '') throw new Error(`Unsafe cache path: ${relativePath}`)
    return path
  }

  private async download(
    url: string,
    target: string,
    expected?: Pick<ResourceManifestFile, 'sha256' | 'size'>,
    options: DownloadOptions = {},
  ) {
    const absoluteTarget = resolve(target)
    await mkdir(dirname(absoluteTarget), { recursive: true })
    const temporary = join(dirname(absoluteTarget), `.${absoluteTarget.split(/[\\/]/).at(-1)}.tmp-${randomUUID()}`)
    const controller = new AbortController()
    const onAbort = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = options.timeoutMs
      ? setTimeout(() => controller.abort(new Error(`Download timed out after ${options.timeoutMs}ms`)), options.timeoutMs)
      : undefined
    try {
      let requestedUrl = new URL(url)
      let response: Response | undefined
      for (let redirects = 0; redirects <= 10; redirects++) {
        options.validateUrl?.(requestedUrl)
        response = await this.fetcher(requestedUrl.href, {
          signal: controller.signal,
          redirect: 'manual',
        })
        const responseUrl = response.url ? new URL(response.url) : requestedUrl
        options.validateUrl?.(responseUrl)
        if (response.status < 300 || response.status >= 400) break
        const location = response.headers.get('location')
        if (!location) break
        if (redirects === 10) throw new Error(`Too many redirects while downloading ${url}`)
        requestedUrl = new URL(location, responseUrl)
        options.validateUrl?.(requestedUrl)
      }
      if (!response) throw new Error(`No response while downloading ${url}`)
      if (!response.ok) throw new Error(`HTTP ${response.status} while downloading ${url}`)
      if (!response.body) throw new Error(`Empty response body while downloading ${url}`)
      const hash = createHash('sha256')
      let size = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          size += chunk.byteLength
          hash.update(chunk)
          callback(null, chunk)
        },
      })
      await pipeline(
        Readable.fromWeb(response.body as never),
        meter,
        createWriteStream(temporary, { flags: 'wx' }),
      )
      const computed = { sha256: hash.digest('hex'), size }
      await verifyFile(temporary, expected ?? computed)
      await rename(temporary, absoluteTarget)
      return computed
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    } finally {
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
    }
  }

  downloadVerified(
    url: string,
    target: string,
    expected: Pick<ResourceManifestFile, 'sha256' | 'size'>,
    options?: DownloadOptions,
  ) {
    return this.download(url, target, expected, options)
  }

  downloadComputed(
    url: string,
    target: string,
    options?: DownloadOptions,
  ) {
    return this.download(url, target, undefined, options)
  }

  async writeAtomic(target: string, contents: string | Buffer | Uint8Array) {
    const absoluteTarget = resolve(target)
    await mkdir(dirname(absoluteTarget), { recursive: true })
    const temporary = join(dirname(absoluteTarget), `.${absoluteTarget.split(/[\\/]/).at(-1)}.tmp-${randomUUID()}`)
    const buffer = typeof contents === 'string' ? Buffer.from(contents) : Buffer.from(contents)
    try {
      await writeFile(temporary, buffer, { flag: 'wx' })
      const metadata = await inspectFile(temporary)
      await verifyFile(temporary, metadata)
      await rename(temporary, absoluteTarget)
      return metadata
    } catch (error) {
      await rm(temporary, { force: true })
      throw error
    }
  }

  async createStagingDirectory() {
    await mkdir(this.cacheDir, { recursive: true })
    const path = join(this.cacheDir, `.staging-${randomUUID()}`)
    await mkdir(path)
    return path
  }

  async discardStagingDirectory(path: string) {
    await rm(path, { recursive: true, force: true })
  }

  async commitSnapshot(
    stagingDirectory: string,
    revision: string,
    files: Record<string, ResourceManifestFile>,
  ) {
    const snapshotName = `${safeRevision(revision)}-${randomUUID()}`
    const snapshotRelative = `snapshots/${snapshotName}`
    const snapshotDirectory = this.path(snapshotRelative)
    const manifestFiles: Record<string, ResourceManifestFile> = {}
    for (const [path, entry] of Object.entries(files)) {
      manifestFiles[`${snapshotRelative}/${normalizedRelativePath(path)}`] = entry
    }
    const manifest = parseResourceManifest({
      schemaVersion: 1,
      revision,
      generatedAt: new Date().toISOString(),
      files: manifestFiles,
    })
    await mkdir(dirname(snapshotDirectory), { recursive: true })
    await rename(stagingDirectory, snapshotDirectory)
    try {
      await this.validateSnapshot(manifest)
      await this.writeAtomic(this.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    } catch (error) {
      await rm(snapshotDirectory, { recursive: true, force: true })
      throw error
    }
    return manifest
  }

  private async validateSnapshot(manifest: ResourceManifest): Promise<CachedSnapshot> {
    const manifestPaths = Object.keys(manifest.files)
    if (!manifestPaths.length) throw new Error('Cached manifest contains no files')
    const snapshotRoot = manifestPaths[0].split('/').slice(0, 2).join('/')
    if (!snapshotRoot.startsWith('snapshots/')) throw new Error('Cached manifest has an invalid snapshot root')
    if (manifestPaths.some(path => !path.startsWith(`${snapshotRoot}/`))) {
      throw new Error('Cached manifest references multiple snapshots')
    }
    const files = new Map<string, string>()
    const sourceKey = `${snapshotRoot}/source.json`
    let sourcePath: string | undefined
    for (const [relativePath, metadata] of Object.entries(manifest.files)) {
      const path = this.path(relativePath)
      await verifyFile(path, metadata)
      files.set(relativePath, path)
      if (relativePath === sourceKey) sourcePath = path
    }
    if (!sourcePath) throw new Error('Cached manifest is missing source.json')
    return { manifest, sourcePath, files }
  }

  async loadSnapshot(): Promise<CachedSnapshot> {
    const manifest = parseResourceManifest(JSON.parse(await readFile(this.manifestPath, 'utf8')))
    return this.validateSnapshot(manifest)
  }
}
