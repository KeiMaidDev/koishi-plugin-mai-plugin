import { createHash } from 'node:crypto'
import { Renderer } from '@takumi-rs/core'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContainerNode, createTextNode } from '../../src/render/nodes'
import {
  RENDER_QUEUE_FULL_MESSAGE,
  TakumiRenderService,
} from '../../src/render/renderer'
import { MAIMAI_RENDER_THEME } from '../../src/render/theme'
import { Semaphore } from '../../src/utils/semaphore'

afterEach(() => {
  vi.restoreAllMocks()
})

function fixture(index: number) {
  const red = 48 + (index * 37) % 160
  const green = 48 + (index * 61) % 160
  const blue = 48 + (index * 83) % 160
  return createContainerNode({
    style: {
      width: '100%',
      height: '100%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: `rgb(${red}, ${green}, ${blue})`,
      color: '#ffffff',
      fontFamily: MAIMAI_RENDER_THEME.fontFamily,
    },
    children: [createTextNode({
      text: `并发渲染 ${index}`,
      style: { fontSize: 18, fontWeight: index % 2 ? 400 : 700 },
    })],
  })
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

async function assertNonBlank(buffer: Buffer) {
  const { data, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const colors = new Set<string>()
  for (let offset = 0; offset < data.length; offset += info.channels) {
    colors.add(data.subarray(offset, offset + info.channels).toString('hex'))
    if (colors.size > 2) break
  }
  expect(colors.size).toBeGreaterThan(1)
}

describe('Semaphore', () => {
  it('bounds active permits and rejects beyond the queue limit with the exact message', async () => {
    const semaphore = new Semaphore(1, 1)
    const firstRelease = await semaphore.acquire()
    const queued = semaphore.acquire()

    expect(RENDER_QUEUE_FULL_MESSAGE).toBe('当前图片生成繁忙，请稍后重试')
    expect(semaphore.active).toBe(1)
    expect(semaphore.pending).toBe(1)
    await expect(semaphore.acquire()).rejects.toThrow(RENDER_QUEUE_FULL_MESSAGE)

    firstRelease()
    const secondRelease = await queued
    expect(semaphore.active).toBe(1)
    expect(semaphore.pending).toBe(0)
    secondRelease()
    expect(semaphore.active).toBe(0)
  })

  it('cancels a queued acquisition without leaking listeners or permits', async () => {
    const semaphore = new Semaphore(1, 2)
    const firstRelease = await semaphore.acquire()
    const controller = new AbortController()
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener')
    const queued = semaphore.acquire(controller.signal)

    controller.abort(new Error('queue cancelled'))

    await expect(queued).rejects.toThrow('queue cancelled')
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(semaphore.pending).toBe(0)
    firstRelease()
    expect(semaphore.active).toBe(0)

    const finalRelease = await semaphore.acquire()
    expect(semaphore.active).toBe(1)
    finalRelease()
    finalRelease()
    expect(semaphore.active).toBe(0)
  })

  it('rejects immediately when the caller is already aborted', async () => {
    const semaphore = new Semaphore(1, 1)
    const controller = new AbortController()
    controller.abort(new Error('already aborted'))

    await expect(semaphore.acquire(controller.signal)).rejects.toThrow('already aborted')
    expect(semaphore.active).toBe(0)
    expect(semaphore.pending).toBe(0)
  })
})

describe('native Takumi render concurrency', () => {
  it.each([1, 4, 8, 16])(
    'renders isolated nonblank outputs at concurrency %i without exceeding the limit',
    async (concurrency) => {
      let activeNativeRenders = 0
      let maximumNativeRenders = 0
      const service = new TakumiRenderService(
        { concurrency, queueLimit: 64, timeoutMs: 30_000 },
        {
          onRenderStart() {
            activeNativeRenders++
            maximumNativeRenders = Math.max(maximumNativeRenders, activeNativeRenders)
          },
          onRenderEnd() {
            activeNativeRenders--
          },
        },
      )
      const render = vi.spyOn(Renderer.prototype, 'render')
      const count = Math.max(16, concurrency * 2)
      const expected = new Map<number, string>()

      for (let index = 0; index < count; index++) {
        expected.set(index, sha256(await service.render(fixture(index), {
          width: 160,
          height: 90,
          format: 'png',
        })))
      }

      let baselineCalls = render.mock.calls.length
      const outputs = await Promise.all(Array.from({ length: count }, (_, index) =>
        service.render(fixture(index), { width: 160, height: 90, format: 'png' })
          .then(buffer => ({ index, buffer })),
      ))

      expect(render.mock.calls.length - baselineCalls).toBe(count)
      expect(maximumNativeRenders).toBeLessThanOrEqual(concurrency)
      expect(maximumNativeRenders).toBeGreaterThan(0)
      expect(activeNativeRenders).toBe(0)
      expect(service.activeRenders).toBe(0)
      expect(service.pendingRenders).toBe(0)
      for (const { index, buffer } of outputs) {
        expect(sha256(buffer)).toBe(expected.get(index))
        await assertNonBlank(buffer)
      }
      baselineCalls = render.mock.calls.length
      expect(baselineCalls).toBe(count * 2)
    },
    120_000,
  )

  it('rejects work beyond the configured queue without leaking a permit', async () => {
    let unblock: (() => void) | undefined
    const blocked = new Promise<void>(resolve => {
      unblock = resolve
    })
    let starts = 0
    const service = new TakumiRenderService(
      { concurrency: 1, queueLimit: 1, timeoutMs: 30_000 },
      {
        async beforeRender() {
          starts++
          if (starts === 1) await blocked
        },
      },
    )
    await service.initialize()

    const first = service.render(fixture(1), { width: 160, height: 90 })
    await vi.waitFor(() => expect(service.activeRenders).toBe(1))
    const second = service.render(fixture(2), { width: 160, height: 90 })
    await vi.waitFor(() => expect(service.pendingRenders).toBe(1))

    await expect(service.render(fixture(3), { width: 160, height: 90 }))
      .rejects.toThrow(RENDER_QUEUE_FULL_MESSAGE)

    unblock!()
    await Promise.all([first, second])
    expect(service.activeRenders).toBe(0)
    expect(service.pendingRenders).toBe(0)
  }, 60_000)
})
