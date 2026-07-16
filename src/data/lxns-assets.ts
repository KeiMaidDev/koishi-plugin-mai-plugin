import { open, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { CacheStore } from './cache-store'

const LXNS_ASSET_ORIGIN = 'https://assets2.lxns.net'
const LXNS_ASSET_BASE_URL = `${LXNS_ASSET_ORIGIN}/maimai`

export type LxnsAssetKind = 'jacket' | 'icon' | 'plate' | 'music'

export interface LxnsAssetCacheOptions {
  cacheDir: string
  timeoutMs: number
  fetch?: typeof fetch
  logger?: { warn(message: string): void }
}

function assetDescriptor(kind: LxnsAssetKind, id: number) {
  if (!Number.isSafeInteger(id) || id < 1) throw new RangeError(`Invalid LXNS ${kind} asset id: ${id}`)
  const extension = kind === 'music' ? 'mp3' : 'png'
  return {
    relativePath: join('assets', kind, `${id}.${extension}`),
    url: `${LXNS_ASSET_BASE_URL}/${kind}/${id}.${extension}`,
  }
}

async function existingFile(path: string) {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

async function validAsset(path: string, kind: LxnsAssetKind) {
  let file: Awaited<ReturnType<typeof open>> | undefined
  try {
    file = await open(path, 'r')
    const contents = Buffer.alloc(8)
    const { bytesRead } = await file.read(contents, 0, contents.length, 0)
    if (kind !== 'music') {
      return bytesRead >= 8
        && contents.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    }
    return bytesRead >= 3
      && (contents.subarray(0, 3).toString('ascii') === 'ID3'
        || (contents[0] === 0xff && (contents[1] & 0xe0) === 0xe0))
  } catch {
    return false
  } finally {
    await file?.close()
  }
}

export class LxnsAssetCache {
  private readonly store: CacheStore
  private readonly logger: { warn(message: string): void }
  private readonly pending = new Map<string, Promise<string | null>>()

  constructor(private readonly options: LxnsAssetCacheOptions) {
    this.store = new CacheStore(options.cacheDir, options.fetch ?? fetch)
    this.logger = options.logger ?? console
  }

  resolve(kind: LxnsAssetKind, id: number, fallback: string | null = null) {
    const descriptor = assetDescriptor(kind, id)
    const target = join(this.options.cacheDir, descriptor.relativePath)
    const active = this.pending.get(target)
    if (active) return active

    let loading!: Promise<string | null>
    loading = (async () => {
      if (await existingFile(target)) {
        if (await validAsset(target, kind)) return target
        await rm(target, { force: true })
      }
      try {
        await this.store.downloadComputed(descriptor.url, target, {
          timeoutMs: this.options.timeoutMs,
          maxBytes: kind === 'music' ? 32 * 1024 * 1024 : 8 * 1024 * 1024,
          validateUrl(url) {
            if (url.origin !== LXNS_ASSET_ORIGIN || url.username || url.password) {
              throw new Error('Unexpected LXNS asset URL')
            }
          },
        })
        if (!await validAsset(target, kind)) {
          await rm(target, { force: true })
          throw new Error('Invalid LXNS asset contents')
        }
        return target
      } catch {
        if (await existingFile(target) && await validAsset(target, kind)) return target
        this.logger.warn(`[mai-plugin] LXNS ${kind} asset ${id} is unavailable; using local fallback.`)
        return fallback
      }
    })().finally(() => {
      if (this.pending.get(target) === loading) this.pending.delete(target)
    })
    this.pending.set(target, loading)
    return loading
  }
}
