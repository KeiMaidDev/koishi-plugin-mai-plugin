import { readFile, stat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

export interface RenderAssetFileSystem {
  readFile(path: string): Promise<Buffer>
  stat(path: string): Promise<Pick<Stats, 'mtimeMs'>>
}

const defaultFileSystem: RenderAssetFileSystem = {
  readFile: path => readFile(path),
  stat: path => stat(path),
}

export function resolvePackageAssetPath(relativePath: string) {
  const moduleDirectory = __dirname
  const packageRoot = ['dist', 'lib'].includes(basename(moduleDirectory))
    ? dirname(moduleDirectory)
    : resolve(moduleDirectory, '../..')
  return join(packageRoot, 'assets', relativePath)
}

export class RenderAssetCache {
  private readonly cache = new Map<string, Buffer>()
  private readonly pending = new Map<string, Promise<Buffer>>()
  private readonly cacheKeysByPath = new Map<string, Set<string>>()
  private readonly generations = new Map<string, number>()

  constructor(private readonly fileSystem: RenderAssetFileSystem = defaultFileSystem) {}

  async load(path: string) {
    return Buffer.from(await this.loadStored(path))
  }

  private async loadStored(path: string) {
    const absolutePath = resolve(path)
    const metadata = await this.fileSystem.stat(absolutePath)
    const key = `${absolutePath}\0${metadata.mtimeMs}`
    const cached = this.cache.get(key)
    if (cached) return cached
    const inFlight = this.pending.get(key)
    if (inFlight) return inFlight

    const generation = this.generations.get(absolutePath) ?? 0
    let loading!: Promise<Buffer>
    loading = this.fileSystem.readFile(absolutePath)
      .then(contents => {
        const buffer = Buffer.from(contents)
        if ((this.generations.get(absolutePath) ?? 0) === generation) {
          this.cache.set(key, buffer)
          const keys = this.cacheKeysByPath.get(absolutePath) ?? new Set<string>()
          keys.add(key)
          this.cacheKeysByPath.set(absolutePath, keys)
        }
        return buffer
      })
      .finally(() => {
        if (this.pending.get(key) === loading) this.pending.delete(key)
      })
    this.pending.set(key, loading)
    return loading
  }

  invalidate(paths: Iterable<string>) {
    for (const path of paths) {
      const absolutePath = resolve(path)
      this.generations.set(absolutePath, (this.generations.get(absolutePath) ?? 0) + 1)
      for (const key of this.cacheKeysByPath.get(absolutePath) ?? []) this.cache.delete(key)
      this.cacheKeysByPath.delete(absolutePath)
      const prefix = `${absolutePath}\0`
      for (const key of this.pending.keys()) {
        if (key.startsWith(prefix)) this.pending.delete(key)
      }
    }
  }

  clear() {
    this.cache.clear()
    this.pending.clear()
    this.cacheKeysByPath.clear()
    this.generations.clear()
  }
}
