import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { posix } from 'node:path'

export interface ResourceManifestFile {
  sha256: string
  size: number
  source: string
}

export interface ResourceManifest {
  schemaVersion: 1
  revision: string
  generatedAt: string
  files: Record<string, ResourceManifestFile>
}

export class ManifestValidationError extends Error {
  constructor(message: string) {
    super(`Invalid resource manifest: ${message}`)
    this.name = 'ManifestValidationError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function canonicalResourcePath(path: string) {
  const segments = path.split('/')
  const hasUnsafeWindowsSegment = segments.some(segment =>
    /[. ]$/.test(segment)
    || /[<>"|*]/.test(segment)
    || /^(?:con|prn|aux|nul|(?:com|lpt)[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(segment),
  )
  if (
    !path
    || path !== path.normalize('NFC')
    || path.includes('\\')
    || path.startsWith('/')
    || posix.normalize(path) !== path
    || segments.some(segment => !segment || segment === '.' || segment === '..')
    || hasUnsafeWindowsSegment
    || /[\0-\x1f:?%#]/.test(path)
  ) {
    throw new ManifestValidationError(`file key must be a canonical relative path: ${JSON.stringify(path)}`)
  }
  return path
}

export function parseResourceManifest(value: unknown): ResourceManifest {
  if (!isRecord(value)) throw new ManifestValidationError('manifest must be an object')
  if (value.schemaVersion !== 1) throw new ManifestValidationError('schemaVersion must be 1')
  if (typeof value.revision !== 'string' || !value.revision.trim()) {
    throw new ManifestValidationError('revision must be a non-empty string')
  }
  if (typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) {
    throw new ManifestValidationError('generatedAt must be an ISO date')
  }
  if (!isRecord(value.files)) throw new ManifestValidationError('files must be an object')

  const files: Record<string, ResourceManifestFile> = {}
  const localPaths = new Map<string, string>()
  for (const [path, entry] of Object.entries(value.files)) {
    const canonicalPath = canonicalResourcePath(path)
    const collisionKey = canonicalPath.toLowerCase()
    const collision = localPaths.get(collisionKey)
    if (collision) {
      throw new ManifestValidationError(
        `duplicate local path ${JSON.stringify(collision)} and ${JSON.stringify(canonicalPath)}`,
      )
    }
    localPaths.set(collisionKey, canonicalPath)
    if (!isRecord(entry)) throw new ManifestValidationError(`files[${JSON.stringify(path)}] must be an object`)
    if (typeof entry.sha256 !== 'string' || !/^[a-f\d]{64}$/i.test(entry.sha256)) {
      throw new ManifestValidationError(`files[${JSON.stringify(path)}].sha256 must be a SHA-256 digest`)
    }
    if (!Number.isSafeInteger(entry.size) || (entry.size as number) < 0) {
      throw new ManifestValidationError(`files[${JSON.stringify(path)}].size must be a non-negative integer`)
    }
    if (typeof entry.source !== 'string' || !entry.source.trim()) {
      throw new ManifestValidationError(`files[${JSON.stringify(path)}].source must be a non-empty string`)
    }
    files[canonicalPath] = {
      sha256: entry.sha256.toLowerCase(),
      size: entry.size as number,
      source: entry.source,
    }
  }

  return {
    schemaVersion: 1,
    revision: value.revision,
    generatedAt: value.generatedAt,
    files,
  }
}

export function sha256(value: string | Buffer | Uint8Array) {
  return createHash('sha256').update(value).digest('hex')
}

export async function inspectFile(path: string): Promise<Pick<ResourceManifestFile, 'sha256' | 'size'>> {
  const [contents, metadata] = await Promise.all([readFile(path), stat(path)])
  return { sha256: sha256(contents), size: metadata.size }
}

export async function verifyFile(path: string, expected: Pick<ResourceManifestFile, 'sha256' | 'size'>) {
  const actual = await inspectFile(path)
  if (actual.size !== expected.size) {
    throw new Error(`Resource size mismatch for ${path}: expected ${expected.size}, received ${actual.size}`)
  }
  if (actual.sha256 !== expected.sha256.toLowerCase()) {
    throw new Error(`Resource SHA-256 mismatch for ${path}: expected ${expected.sha256}, received ${actual.sha256}`)
  }
}
