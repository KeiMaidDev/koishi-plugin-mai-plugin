import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '../../src/config'
import { MusicDifficulty } from '../../src/domain/enums'
import { CacheStore } from '../../src/data/cache-store'
import { parseResourceManifest, sha256 } from '../../src/data/manifest'
import { normalizeMaimaiSource } from '../../src/data/normalizers'
import { MaimaiDataSyncService, MissingMaimaiDataError } from '../../src/data/sync-service'
import { connectDataSyncAssetInvalidation, TakumiRenderService } from '../../src/render/renderer'
import minimalSource from '../fixtures/data/minimal-source.json'

const temporaryDirectories: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'mai-data-sync-'))
  temporaryDirectories.push(directory)
  return directory
}

function resourceSyncConfig(
  cacheDir: string,
  staticBaseUrl = '',
  allowedHosts = ['static.example'],
): Config['resourceSync'] {
  return {
    enabled: true,
    intervalMinutes: 60,
    timeoutMs: 1_000,
    cacheDir,
    staticBaseUrl,
    allowedHosts,
  }
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function responseFromBuffer(value: Buffer, status = 200) {
  return new Response(value, { status })
}

function sourceWithName(name: string) {
  return {
    ...minimalSource,
    musics: minimalSource.musics.map((music, index) => index ? music : { ...music, name }),
  }
}

async function staticSourceResponses(baseUrl: string, source: unknown, cover?: Buffer) {
  const sourceBuffer = Buffer.from(JSON.stringify(source))
  const files: Record<string, { sha256: string; size: number; source: string }> = {
    'source.json': {
      sha256: sha256(sourceBuffer),
      size: sourceBuffer.byteLength,
      source: baseUrl,
    },
  }
  if (cover) {
    files['covers/1.png'] = {
      sha256: sha256(cover),
      size: cover.byteLength,
      source: baseUrl,
    }
  }
  const manifest = {
    schemaVersion: 1 as const,
    revision: 'static-r1',
    generatedAt: '2026-07-13T00:00:00.000Z',
    files,
  }
  return new Map<string, Response>([
    [`${baseUrl}manifest.json`, jsonResponse(manifest)],
    [`${baseUrl}source.json`, responseFromBuffer(sourceBuffer)],
    ...(cover ? [[`${baseUrl}covers/1.png`, responseFromBuffer(cover)] as const] : []),
  ])
}

function fetchFromResponses(responses: Map<string, Response>) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const response = responses.get(url)
    if (!response) throw new Error(`Unexpected URL: ${url}`)
    return response.clone()
  }) as unknown as typeof fetch
}

describe('source normalization', () => {
  it('normalizes a valid source into domain models', () => {
    const data = normalizeMaimaiSource(minimalSource)
    const music = data.musics.get(1)

    expect(data.revision).toBe('fixture-r1')
    expect(data.versions.get('maimai DX')).toEqual({ id: 1, name: 'maimai DX', version: 1 })
    expect(music?.charts.map(chart => chart.difficulty)).toEqual([
      MusicDifficulty.Basic,
      MusicDifficulty.Advanced,
    ])
    expect(music?.charts[0].notes).toMatchObject({ tap: 1, hold: 2, slide: 3, touch: 0, break: 4 })
    expect(music?.charts[1].notes.total).toBe(20)
    expect(data.plates.get(100501)?.name).toBe('Fixture Plate')
    expect(data.icons.get(106103)?.name).toBe('Fixture Icon')
    expect(data.courses.get(1)?.musics[0]).toMatchObject({ id: 1, difficulty: 0 })
  })

  it.each([
    ['music ID', { musics: [{ ...minimalSource.musics[0], id: 0 }] }, 'musics[0].id'],
    ['difficulty order', { musics: [{ ...minimalSource.musics[0], charts: [{ ...minimalSource.musics[0].charts[0], difficulty: 1 }] }] }, 'difficulty order'],
    ['level constant', { musics: [{ ...minimalSource.musics[0], charts: [{ ...minimalSource.musics[0].charts[0], levelValue: Number.NaN }] }] }, 'levelValue'],
    ['notes count', { musics: [{ ...minimalSource.musics[0], charts: [{ ...minimalSource.musics[0].charts[0], notes: [1, 2, 3] }] }] }, 'notes'],
  ])('rejects invalid %s data', (_label, replacement, message) => {
    expect(() => normalizeMaimaiSource({ ...minimalSource, ...replacement })).toThrow(message)
  })
})

describe('manifest and cache integrity', () => {
  it('rejects corrupted schemaVersion 1 manifests', () => {
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'bad',
      generatedAt: 'not-a-date',
      files: {
        'source.json': { sha256: 'broken', size: -1, source: '' },
      },
    })).toThrow('manifest')
  })

  it('cleans temporary files and preserves the target after an interrupted download', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, 'source.json')
    await writeFile(target, 'old-cache')
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('partial'))
        controller.error(new Error('connection interrupted'))
      },
    })
    const fetcher = vi.fn(async () => new Response(stream)) as unknown as typeof fetch
    const cache = new CacheStore(directory, fetcher)

    await expect(cache.downloadVerified(
      'https://static.example/source.json',
      target,
      { size: 10, sha256: sha256('new-cache') },
    )).rejects.toThrow('interrupted')

    expect(await readFile(target, 'utf8')).toBe('old-cache')
    expect((await readdir(directory)).filter(name => name.includes('.tmp-'))).toEqual([])
  })

  it('rejects hash mismatches and atomically keeps the previous file', async () => {
    const directory = await temporaryDirectory()
    const target = join(directory, 'source.json')
    await writeFile(target, 'old-cache')
    const cache = new CacheStore(
      directory,
      vi.fn(async () => responseFromBuffer(Buffer.from('new-cache'))) as unknown as typeof fetch,
    )

    await expect(cache.downloadVerified(
      'https://static.example/source.json',
      target,
      { size: 9, sha256: sha256('different') },
    )).rejects.toThrow('SHA-256')

    expect(await readFile(target, 'utf8')).toBe('old-cache')
    expect((await readdir(directory)).filter(name => name.includes('.tmp-'))).toEqual([])
  })

  it('applies timeoutMs to the complete response body download', async () => {
    const directory = await temporaryDirectory()
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      let streamController: ReadableStreamDefaultController<Uint8Array>
      let closeTimer: ReturnType<typeof setTimeout>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          closeTimer = setTimeout(() => controller.close(), 100)
        },
      })
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(closeTimer)
        streamController.error(init.signal?.reason)
      }, { once: true })
      return new Response(stream)
    }) as unknown as typeof fetch
    const cache = new CacheStore(directory, fetcher)

    await expect(cache.downloadComputed(
      'https://static.example/slow.json',
      join(directory, 'slow.json'),
      { timeoutMs: 10 },
    )).rejects.toThrow('timed out')
  })

  it.each([
    'covers//1.png',
    'covers/./1.png',
  ])('rejects non-canonical manifest path alias %s', alias => {
    const contents = Buffer.from('cover')
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'path-alias',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        [alias]: { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
      },
    })).toThrow('canonical relative path')
  })

  it.each([
    'covers/trailing.',
    'covers/trailing ',
    'covers/a<b.png',
    'covers/a>b.png',
    'covers/a"b.png',
    'covers/a|b.png',
    'covers/a*b.png',
    'covers/CON',
    'covers/con.png',
    'covers/PrN.jpg',
    'covers/AUX.dat',
    'covers/nUl.txt',
    'covers/COM1.png',
    'covers/com9',
    'covers/LPT1.jpg',
    'covers/lpt9.dat',
    'covers/COM\u00b9',
    'covers/COM\u00b2',
    'covers/COM\u00b3',
    'covers/LPT\u00b9',
    'covers/LPT\u00b2',
    'covers/LPT\u00b3',
    'covers/cOm\u00b9.png',
    'covers/lPt\u00b3.TxT',
    'CON/covers/1.png',
  ])('rejects Windows-unsafe manifest path %s', unsafePath => {
    const contents = Buffer.from('cover')
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'windows-path',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        [unsafePath]: { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
      },
    })).toThrow('canonical relative path')
  })

  it('rejects the Windows alias covers/1.png versus covers/1.png.', () => {
    const contents = Buffer.from('cover')
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'windows-alias',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        'covers/1.png': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        'covers/1.png.': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
      },
    })).toThrow('canonical relative path')
  })

  it('rejects case-insensitive duplicate local paths', () => {
    const contents = Buffer.from('cover')
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'path-collision',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        'covers/1.png': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        'COVERS/1.PNG': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
      },
    })).toThrow('duplicate local path')
  })

  it('revalidates a renamed snapshot before replacing the active manifest', async () => {
    const cacheDir = await temporaryDirectory()
    const cache = new CacheStore(cacheDir)
    const oldStaging = await cache.createStagingDirectory()
    const oldContents = `${JSON.stringify(sourceWithName('Previous Cache Song'))}\n`
    const oldMetadata = await cache.writeAtomic(join(oldStaging, 'source.json'), oldContents)
    await cache.commitSnapshot(oldStaging, 'old-revision', {
      'source.json': { ...oldMetadata, source: 'fixture' },
    })
    const newStaging = await cache.createStagingDirectory()
    const newContents = `${JSON.stringify(sourceWithName('Invalid New Song'))}\n`
    const newMetadata = await cache.writeAtomic(join(newStaging, 'source.json'), newContents)

    await expect(cache.commitSnapshot(newStaging, 'invalid-revision', {
      'source.json': { ...newMetadata, sha256: sha256('wrong'), source: 'fixture' },
    })).rejects.toThrow('SHA-256')

    const active = await cache.loadSnapshot()
    const activeSource = normalizeMaimaiSource(JSON.parse(await readFile(active.sourcePath, 'utf8')))
    expect(active.manifest.revision).toBe('old-revision')
    expect(activeSource.musics.get(1)?.name).toBe('Previous Cache Song')
    expect(await readdir(join(cacheDir, 'snapshots'))).toHaveLength(1)
  })

  it('removes a renamed snapshot when active manifest writing fails', async () => {
    const cacheDir = await temporaryDirectory()
    const cache = new CacheStore(cacheDir)
    const oldStaging = await cache.createStagingDirectory()
    const oldContents = `${JSON.stringify(sourceWithName('Previous Cache Song'))}\n`
    const oldMetadata = await cache.writeAtomic(join(oldStaging, 'source.json'), oldContents)
    await cache.commitSnapshot(oldStaging, 'old-revision', {
      'source.json': { ...oldMetadata, source: 'fixture' },
    })
    const newStaging = await cache.createStagingDirectory()
    const newContents = `${JSON.stringify(sourceWithName('Uncommitted Song'))}\n`
    const newMetadata = await cache.writeAtomic(join(newStaging, 'source.json'), newContents)
    const writeFailure = vi.spyOn(cache, 'writeAtomic').mockRejectedValueOnce(new Error('manifest write failed'))

    await expect(cache.commitSnapshot(newStaging, 'uncommitted-revision', {
      'source.json': { ...newMetadata, source: 'fixture' },
    })).rejects.toThrow('manifest write failed')
    writeFailure.mockRestore()

    const active = await cache.loadSnapshot()
    const activeSource = normalizeMaimaiSource(JSON.parse(await readFile(active.sourcePath, 'utf8')))
    expect(active.manifest.revision).toBe('old-revision')
    expect(activeSource.musics.get(1)?.name).toBe('Previous Cache Song')
    expect(await readdir(join(cacheDir, 'snapshots'))).toHaveLength(1)
  })
})

describe('remote URL policy', () => {
  it('rejects absolute URLs used as manifest file keys', () => {
    const contents = Buffer.from('{}')
    expect(() => parseResourceManifest({
      schemaVersion: 1,
      revision: 'absolute-url',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
        'https://evil.example/cover.png': { sha256: sha256(contents), size: contents.byteLength, source: 'fixture' },
      },
    })).toThrow('canonical relative path')
  })

  it('rejects a redirect to an unapproved host before following it', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const redirectedUrl = 'https://evil.example/manifest.json'
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === `${baseUrl}manifest.json`) {
        return new Response(null, { status: 302, headers: { location: redirectedUrl } })
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as unknown as typeof fetch
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetcher,
      builtinSource: null,
      proberDataUrl: '',
    })

    await expect(service.startup()).rejects.toThrow('evil.example')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith(
      `${baseUrl}manifest.json`,
      expect.objectContaining({ redirect: 'manual' }),
    )
  })

  it('rejects an unapproved final response URL', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const response = jsonResponse({})
    Object.defineProperty(response, 'url', { value: 'https://evil.example/manifest.json' })
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: vi.fn(async () => response) as unknown as typeof fetch,
      builtinSource: null,
      proberDataUrl: '',
    })

    await expect(service.startup()).rejects.toThrow('evil.example')
  })

  it('allows redirects that remain on an approved host', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const redirectedManifestUrl = 'https://static.example/redirected/manifest.json'
    const responses = await staticSourceResponses(baseUrl, sourceWithName('Same Host Redirect Song'))
    const manifestResponse = responses.get(`${baseUrl}manifest.json`)!
    responses.set(`${baseUrl}manifest.json`, new Response(null, {
      status: 302,
      headers: { location: redirectedManifestUrl },
    }))
    responses.set(redirectedManifestUrl, manifestResponse)
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetchFromResponses(responses),
      builtinSource: null,
      proberDataUrl: '',
    })

    const store = await service.startup()

    expect(store.musics.get(1)?.name).toBe('Same Host Redirect Song')
  })

  it('stops after ten redirect hops', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    let hop = 0
    const fetcher = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: `${baseUrl}redirect-${++hop}` },
    })) as unknown as typeof fetch
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetcher,
      builtinSource: null,
      proberDataUrl: '',
    })

    await expect(service.startup()).rejects.toThrow('Too many redirects')
    expect(fetcher).toHaveBeenCalledTimes(11)
    for (const call of (fetcher as ReturnType<typeof vi.fn>).mock.calls) {
      expect(call[1]).toEqual(expect.objectContaining({ redirect: 'manual' }))
    }
  })

  it('enforces allowedHosts for the prober public data URL', async () => {
    const cacheDir = await temporaryDirectory()
    const proberUrl = 'https://prober.example/music_data'
    const fetcher = vi.fn(async () => jsonResponse(minimalSource)) as unknown as typeof fetch
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir),
      fetch: fetcher,
      builtinSource: null,
      proberDataUrl: proberUrl,
    })

    await expect(service.startup()).rejects.toThrow('prober.example')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('allows HTTP(S) hosts when allowedHosts is empty', async () => {
    const cacheDir = await temporaryDirectory()
    const proberUrl = 'https://prober.example/music_data'
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, '', []),
      fetch: vi.fn(async () => jsonResponse(sourceWithName('Empty Allowlist Song'))) as unknown as typeof fetch,
      builtinSource: null,
      proberDataUrl: proberUrl,
    })

    const store = await service.startup()

    expect(store.musics.get(1)?.name).toBe('Empty Allowlist Song')
  })
})

describe('data synchronization', () => {
  it('invalidates preserved-mtime renderer assets through the production sync event', async () => {
    const cacheDir = await temporaryDirectory()
    const cache = new CacheStore(cacheDir)
    const staging = await cache.createStagingDirectory()
    const source = Buffer.from(JSON.stringify(minimalSource))
    const firstCover = Buffer.from('cover-v1')
    const sourceMetadata = await cache.writeAtomic(join(staging, 'source.json'), source)
    const coverMetadata = await cache.writeAtomic(join(staging, 'covers', '1.png'), firstCover)
    await cache.commitSnapshot(staging, 'preserved-mtime', {
      'source.json': { ...sourceMetadata, source: 'test' },
      'covers/1.png': { ...coverMetadata, source: 'test' },
    })
    const dataSync = new MaimaiDataSyncService({
      config: { ...resourceSyncConfig(cacheDir), enabled: false },
      builtinSource: null,
      proberDataUrl: '',
    })
    const renderer = new TakumiRenderService()
    const disconnect = connectDataSyncAssetInvalidation(dataSync, renderer)

    const firstStore = await dataSync.startup()
    const coverPath = firstStore.coverPath(1)
    await expect(renderer.loadAsset(coverPath)).resolves.toEqual(firstCover)
    const timestamps = await stat(coverPath)
    const secondCover = Buffer.from('cover-v2')
    await writeFile(coverPath, secondCover)
    await utimes(coverPath, timestamps.atime, timestamps.mtime)
    const manifest = JSON.parse(await readFile(cache.manifestPath, 'utf8'))
    const coverKey = Object.keys(manifest.files).find(path => path.endsWith('/covers/1.png'))
    if (!coverKey) throw new Error('cover manifest entry is missing')
    manifest.files[coverKey] = {
      ...manifest.files[coverKey],
      sha256: sha256(secondCover),
      size: secondCover.byteLength,
    }
    await writeFile(cache.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    await dataSync.startup()

    await expect(renderer.loadAsset(coverPath)).resolves.toEqual(secondCover)
    disconnect()
  })

  it.each([
    'covers//1.png',
    'covers/./1.png',
  ])('keeps the previous cache active when a manifest contains %s', async alias => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const initialResponses = await staticSourceResponses(baseUrl, sourceWithName('Previous Cache Song'))
    await new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetchFromResponses(initialResponses),
      builtinSource: null,
      proberDataUrl: '',
    }).startup()
    const sourceBuffer = Buffer.from(JSON.stringify(sourceWithName('Aliased Song')))
    const invalidManifest = {
      schemaVersion: 1,
      revision: 'aliased-revision',
      generatedAt: '2026-07-13T00:00:00.000Z',
      files: {
        'source.json': { sha256: sha256(sourceBuffer), size: sourceBuffer.byteLength, source: baseUrl },
        [alias]: { sha256: sha256('cover'), size: 5, source: baseUrl },
      },
    }
    const fetcher = fetchFromResponses(new Map([
      [`${baseUrl}manifest.json`, jsonResponse(invalidManifest)],
    ]))

    const store = await new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetcher,
      logger: { warn: vi.fn() },
      builtinSource: null,
      proberDataUrl: '',
    }).startup()

    expect(store.manifest.revision).toBe('static-r1')
    expect(store.musics.get(1)?.name).toBe('Previous Cache Song')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('uses configured static data before prober public data', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const proberUrl = 'https://prober.example/music_data'
    const responses = await staticSourceResponses(baseUrl, sourceWithName('Static Song'))
    responses.set(proberUrl, jsonResponse(sourceWithName('Prober Song')))
    const fetcher = fetchFromResponses(responses)
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetcher,
      proberDataUrl: proberUrl,
    })

    const store = await service.startup()

    expect(store.musics.get(1)?.name).toBe('Static Song')
    expect(fetcher).not.toHaveBeenCalledWith(proberUrl, expect.anything())
  })

  it('falls through an HTTP 500 static source to prober public data', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const proberUrl = 'https://prober.example/music_data'
    const responses = new Map<string, Response>([
      [`${baseUrl}manifest.json`, jsonResponse({ error: 'failed' }, 500)],
      [proberUrl, jsonResponse(sourceWithName('Prober Song'))],
    ])
    const service = new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl, ['static.example', 'prober.example']),
      fetch: fetchFromResponses(responses),
      proberDataUrl: proberUrl,
    })

    const store = await service.startup()

    expect(store.musics.get(1)?.name).toBe('Prober Song')
    expect(store.manifest.schemaVersion).toBe(1)
    expect(Object.keys(store.manifest.files).some(path => path.endsWith('/source.json'))).toBe(true)
  })

  it('starts from a complete cache while offline and records a warning', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const responses = await staticSourceResponses(baseUrl, sourceWithName('Cached Song'))
    await new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetchFromResponses(responses),
      builtinSource: null,
      proberDataUrl: '',
    }).startup()
    const warn = vi.fn()
    const offlineFetch = vi.fn(async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch

    const store = await new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: offlineFetch,
      logger: { warn },
      builtinSource: null,
      proberDataUrl: '',
    }).startup()

    expect(store.musics.get(1)?.name).toBe('Cached Song')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('using cached revision'))
  })

  it('generates 72x72 JPEG cover thumbnails named by resource ID', async () => {
    const cacheDir = await temporaryDirectory()
    const baseUrl = 'https://static.example/mai/'
    const cover = await sharp({
      create: { width: 120, height: 80, channels: 4, background: '#1f7a8c' },
    }).png().toBuffer()
    const responses = await staticSourceResponses(baseUrl, minimalSource, cover)
    const store = await new MaimaiDataSyncService({
      config: resourceSyncConfig(cacheDir, baseUrl),
      fetch: fetchFromResponses(responses),
      proberDataUrl: '',
    }).startup()

    const thumbnail = store.coverPath(1, true)
    const metadata = await sharp(thumbnail).metadata()

    expect(thumbnail).toMatch(/1_s\.jpg$/)
    expect(metadata).toMatchObject({ width: 72, height: 72, format: 'jpeg' })
  })

  it('returns stable functional fallback paths for missing covers, avatars, and plates', async () => {
    const cacheDir = await temporaryDirectory()
    const store = await new MaimaiDataSyncService({
      config: { ...resourceSyncConfig(cacheDir), enabled: false },
      proberDataUrl: '',
    }).startup()

    const paths = [store.coverPath(999999), store.iconPath(999999), store.platePath(999999)]
    expect(paths.map(path => path.replaceAll('\\', '/'))).toEqual([
      expect.stringMatching(/assets\/fallback\/cover\.png$/),
      expect.stringMatching(/assets\/fallback\/avatar\.png$/),
      expect.stringMatching(/assets\/fallback\/plate\.png$/),
    ])
    for (const path of paths) {
      await expect(sharp(path).metadata()).resolves.toMatchObject({ format: 'png' })
    }
  })

  it('lists missing minimum data when first startup has no usable source', async () => {
    const cacheDir = await temporaryDirectory()
    const service = new MaimaiDataSyncService({
      config: { ...resourceSyncConfig(cacheDir), enabled: false },
      builtinSource: null,
      proberDataUrl: '',
    })

    await expect(service.startup()).rejects.toMatchObject<Partial<MissingMaimaiDataError>>({
      missing: ['versions', 'musics'],
    })
  })
})
