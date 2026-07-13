import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Renderer } from '@takumi-rs/core'
import type { ContainerNode, TextNode } from '@takumi-rs/helpers'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RenderAssetCache } from '../../src/render/assets'
import {
  createContainerNode,
  createTextNode,
} from '../../src/render/nodes'
import { TakumiRenderService } from '../../src/render/renderer'
import { MAIMAI_RENDER_THEME } from '../../src/render/theme'

const temporaryDirectories: string[] = []
const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

afterEach(async () => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'mai-render-'))
  temporaryDirectories.push(directory)
  return directory
}

function chineseFixture(title = '舞萌 DX') {
  return createContainerNode({
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: MAIMAI_RENDER_THEME.colors.background,
      color: MAIMAI_RENDER_THEME.colors.text,
      fontFamily: MAIMAI_RENDER_THEME.fontFamily,
    },
    children: [
      createTextNode({
        text: title,
        style: { fontSize: 34, fontWeight: 700 },
      }),
      createTextNode({
        text: '中文原生渲染测试',
        style: { fontSize: 18, marginTop: 8 },
      }),
    ],
  })
}

async function expectNonBlankPng(buffer: Buffer, width: number, height: number) {
  expect(buffer.subarray(0, pngSignature.length)).toEqual(pngSignature)
  const metadata = await sharp(buffer).metadata()
  expect(metadata).toMatchObject({ format: 'png', width, height })

  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const firstPixel = data.subarray(0, info.channels)
  let changedPixels = 0
  for (let offset = info.channels; offset < data.length; offset += info.channels) {
    if (!data.subarray(offset, offset + info.channels).equals(firstPixel)) changedPixels++
  }
  expect(changedPixels).toBeGreaterThan(100)
}

describe('TakumiRenderService', () => {
  it('initializes concurrently while registering both real fonts exactly once', async () => {
    const registerFont = vi.spyOn(Renderer.prototype, 'registerFont')
    const service = new TakumiRenderService()

    await Promise.all(Array.from({ length: 20 }, () => service.initialize()))
    await service.initialize()

    expect(registerFont).toHaveBeenCalledTimes(2)
    expect(registerFont.mock.calls.map(([font]) => font)).toEqual([
      expect.objectContaining({ name: MAIMAI_RENDER_THEME.fontFamily, weight: 400 }),
      expect.objectContaining({ name: MAIMAI_RENDER_THEME.fontFamily, weight: 700 }),
    ])
  }, 60_000)

  it('uses the native renderer for a nonblank Chinese PNG', async () => {
    const render = vi.spyOn(Renderer.prototype, 'render')
    const service = new TakumiRenderService()

    const image = await service.render(chineseFixture(), {
      width: 320,
      height: 180,
      format: 'png',
    })

    expect(render).toHaveBeenCalledTimes(1)
    await expectNonBlankPng(image, 320, 180)
  }, 60_000)

  it('produces 100 byte-identical native renders for the same fresh fixture', async () => {
    const service = new TakumiRenderService()
    const hashes: string[] = []

    for (let index = 0; index < 100; index++) {
      const image = await service.render(chineseFixture(), {
        width: 240,
        height: 120,
        format: 'png',
      })
      hashes.push(createHash('sha256').update(image).digest('hex'))
    }

    expect(new Set(hashes)).toEqual(new Set([hashes[0]]))
  }, 120_000)

  it('merges caller cancellation and cleans its timeout timer and listener', async () => {
    const service = new TakumiRenderService({ timeoutMs: 30_000 })
    await service.initialize()
    const controller = new AbortController()
    const addEventListener = vi.spyOn(controller.signal, 'addEventListener')
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    vi.useFakeTimers()

    const render = service.render(chineseFixture(), { width: 160, height: 90 }, controller.signal)
    await vi.waitFor(() => expect(addEventListener).toHaveBeenCalledWith('abort', expect.any(Function), { once: true }))
    controller.abort(new Error('caller cancelled'))

    await expect(render).rejects.toThrow('caller cancelled')
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  }, 60_000)

  it('cleans its timeout after a successful native render', async () => {
    const service = new TakumiRenderService({ timeoutMs: 30_000 })
    await service.initialize()
    vi.useFakeTimers()

    const image = await service.render(chineseFixture(), { width: 160, height: 90 })

    expect(image.subarray(0, pngSignature.length)).toEqual(pngSignature)
    expect(vi.getTimerCount()).toBe(0)
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  }, 60_000)

  it('aborts a stalled render stage at the configured timeout and releases its permit', async () => {
    let markStarted!: () => void
    const started = new Promise<void>(resolve => {
      markStarted = resolve
    })
    const stalled = new Promise<void>(() => undefined)
    const service = new TakumiRenderService(
      { concurrency: 1, timeoutMs: 25 },
      {
        beforeRender() {
          markStarted()
          return stalled
        },
      },
    )
    await service.initialize()

    const render = service.render(chineseFixture(), { width: 160, height: 90 })
    await started

    await expect(render).rejects.toMatchObject({
      name: 'TimeoutError',
      message: 'Render timed out after 25ms',
    })
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  }, 1_000)

  it('fails closed after font initialization rejects and never invokes native render', async () => {
    const registerFont = vi.spyOn(Renderer.prototype, 'registerFont')
      .mockRejectedValueOnce(new Error('font registration failed'))
    const nativeRender = vi.spyOn(Renderer.prototype, 'render')
    const service = new TakumiRenderService()

    const first = service.initialize()
    const second = service.initialize()
    await expect(first).rejects.toThrow('font registration failed')
    await expect(second).rejects.toThrow('font registration failed')
    await expect(service.render(chineseFixture(), { width: 160, height: 90 }))
      .rejects.toThrow('font registration failed')

    expect(registerFont).toHaveBeenCalledTimes(1)
    expect(nativeRender).not.toHaveBeenCalled()
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  })

  it('forwards active cancellation to native render and cleans timer and permit state', async () => {
    const service = new TakumiRenderService({ concurrency: 1, timeoutMs: 30_000 })
    await service.initialize()
    let nativeSignal: AbortSignal | undefined
    const nativeRender = vi.spyOn(Renderer.prototype, 'render').mockImplementation((_node, options) => {
      nativeSignal = options?.signal
      return new Promise<Buffer>((_resolve, reject) => {
        nativeSignal!.addEventListener('abort', () => reject(nativeSignal!.reason), { once: true })
      })
    })
    const controller = new AbortController()
    vi.useFakeTimers()

    const render = service.render(chineseFixture(), { width: 160, height: 90 }, controller.signal)
    await vi.waitFor(() => expect(nativeSignal).toBeDefined())
    expect(service.activeRenders).toBe(1)
    controller.abort(new Error('active render cancelled'))

    await expect(render).rejects.toThrow('active render cancelled')
    expect(nativeRender).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ signal: nativeSignal }),
    )
    expect(nativeSignal).not.toBe(controller.signal)
    expect(nativeSignal).toMatchObject({ aborted: true, reason: controller.signal.reason })
    expect(vi.getTimerCount()).toBe(0)
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  }, 60_000)
})

describe('render node factories', () => {
  it('creates fresh trees without shared nested references', () => {
    const props = {
      style: { display: 'flex' as const, backgroundColor: '#ffffff' },
      children: [createTextNode({
        text: '舞萌',
        style: { color: '#111111', fontWeight: 700 },
      })],
    }

    const first = createContainerNode(props)
    const second = createContainerNode(props)
    const firstText = first.children?.[0] as TextNode
    const secondText = second.children?.[0] as TextNode

    expect(first).not.toBe(second)
    expect(first.style).not.toBe(second.style)
    expect(first.children).not.toBe(second.children)
    expect(firstText).not.toBe(secondText)
    expect(firstText.style).not.toBe(secondText.style)
  })

  it('recursively freezes nested test nodes so mutation throws', () => {
    const node = createContainerNode({
      style: { display: 'flex' },
      children: [createTextNode({ text: '舞萌', style: { color: '#111111' } })],
    })
    const child = node.children?.[0] as TextNode

    expect(Object.isFrozen(node)).toBe(true)
    expect(Object.isFrozen(node.children)).toBe(true)
    expect(Object.isFrozen(child)).toBe(true)
    expect(Object.isFrozen(child.style)).toBe(true)
    expect(() => {
      child.style!.color = '#ffffff'
    }).toThrow(TypeError)
  })

  it('clones an existing node tree before freezing it', () => {
    const source: ContainerNode = {
      type: 'container',
      children: [{ type: 'text', text: '舞萌', style: { fontSize: 18 } }],
    }

    const node = createContainerNode(source)

    expect(node).not.toBe(source)
    expect(node.children).not.toBe(source.children)
    expect(node.children?.[0]).not.toBe(source.children?.[0])
    expect(Object.isFrozen(source)).toBe(false)
  })
})

describe('RenderAssetCache', () => {
  it('deduplicates concurrent reads by resolved absolute path and modification time', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'cover.png')
    await writeFile(path, Buffer.from('asset-v1'))
    const read = vi.fn((absolutePath: string) => readFile(absolutePath))
    const cache = new RenderAssetCache({ readFile: read, stat })

    const results = await Promise.all(Array.from({ length: 20 }, () => cache.load(path)))

    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(resolve(path))
    expect(results.every(buffer => buffer.equals(Buffer.from('asset-v1')))).toBe(true)
    expect(new Set(results).size).toBe(results.length)
    results[0][0] = 0
    await expect(cache.load(path)).resolves.toEqual(Buffer.from('asset-v1'))
  })

  it('returns defensive copies so caller mutation cannot poison cached assets', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'cover.png')
    await writeFile(path, Buffer.from('asset-v1'))
    const cache = new RenderAssetCache()

    const first = await cache.load(path)
    const second = await cache.load(path)
    first.fill(0)

    expect(first).not.toBe(second)
    expect(second).toEqual(Buffer.from('asset-v1'))
    await expect(cache.load(path)).resolves.toEqual(Buffer.from('asset-v1'))
  })

  it('uses a new cache entry when the file modification time changes', async () => {
    const directory = await temporaryDirectory()
    const path = join(directory, 'cover.png')
    await writeFile(path, Buffer.from('asset-v1'))
    const read = vi.fn((absolutePath: string) => readFile(absolutePath))
    const cache = new RenderAssetCache({ readFile: read, stat })
    await cache.load(path)
    const before = await stat(path)

    await writeFile(path, Buffer.from('asset-v2'))
    const changed = new Date(before.mtimeMs + 2_000)
    await utimes(path, changed, changed)

    await expect(cache.load(path)).resolves.toEqual(Buffer.from('asset-v2'))
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('invalidates affected absolute paths after data sync even when mtime is preserved', async () => {
    const directory = await temporaryDirectory()
    const affectedPath = join(directory, 'cover.png')
    const untouchedPath = join(directory, 'icon.png')
    await writeFile(affectedPath, Buffer.from('cover-v1'))
    await writeFile(untouchedPath, Buffer.from('icon-v1'))
    const affectedTime = await stat(affectedPath)
    const read = vi.fn((absolutePath: string) => readFile(absolutePath))
    const cache = new RenderAssetCache({ readFile: read, stat })
    await cache.load(affectedPath)
    await cache.load(untouchedPath)

    await writeFile(affectedPath, Buffer.from('cover-v2'))
    await utimes(affectedPath, affectedTime.atime, affectedTime.mtime)
    cache.invalidate([resolve(affectedPath)])

    await expect(cache.load(affectedPath)).resolves.toEqual(Buffer.from('cover-v2'))
    await expect(cache.load(untouchedPath)).resolves.toEqual(Buffer.from('icon-v1'))
    expect(read).toHaveBeenCalledTimes(3)
  })
})

describe('bundled fonts', () => {
  it.each([
    ['NotoSansSC-Regular.otf', '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'],
    ['NotoSansSC-Bold.otf', 'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a'],
  ])('ships the official OpenType font bytes: %s', async (filename, expectedHash) => {
    const font = await readFile(join(projectRoot, 'assets', 'fonts', filename))

    expect(font.byteLength).toBeGreaterThan(1_000_000)
    expect(font.subarray(0, 4).toString('ascii')).toBe('OTTO')
    expect(createHash('sha256').update(font).digest('hex')).toBe(expectedHash)
  })

  it('records the official Noto source and SIL Open Font License', async () => {
    const source = await readFile(join(projectRoot, 'assets', 'fonts', 'SOURCE.md'), 'utf8')
    const license = await readFile(join(projectRoot, 'assets', 'fonts', 'OFL.txt'), 'utf8')

    expect(source).toContain('github.com/notofonts/noto-cjk')
    expect(source).toContain('NotoSansCJKsc-Regular.otf')
    expect(source).toContain('NotoSansCJKsc-Bold.otf')
    expect(license).toContain('SIL OPEN FONT LICENSE Version 1.1')
  })
})
