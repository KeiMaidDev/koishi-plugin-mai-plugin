import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { compareImages } from '../../scripts/compare-images'
import {
  ChartInfo,
  ComboStatus,
  MaimaiDataStore,
  MusicDifficulty,
  MusicGenre,
  MusicInfo,
  MusicType,
  Notes,
  PlayerInfo,
  PlayerSettings,
  Rate,
  RecordEntry,
  RENDER_QUEUE_FULL_MESSAGE,
  SyncStatus,
  TakumiMaiRenderer,
  TakumiRenderService,
  createContainerNode,
} from '../../src'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )))
})

function rendererFixture() {
  const oldVersion = { id: 1, name: 'maimai DX 2025', version: 25_000 }
  const newVersion = { id: 2, name: 'maimai DX 2026', version: 26_000 }
  const createMusic = (id: number, isNew: boolean) => {
    const version = isNew ? newVersion : oldVersion
    const music = new MusicInfo(
      id,
      `Stress Track ${id}`,
      MusicType.Deluxe,
      '',
      'Stress Artist',
      MusicGenre.Original,
      180,
      version,
      isNew,
    )
    music.charts = [new ChartInfo(
      music,
      MusicDifficulty.Master,
      '14+',
      14.7,
      new Notes(450, 50, 30, 20, 10),
      'Stress Designer',
    )]
    return music
  }
  const oldMusic = createMusic(40_001, false)
  const newMusic = createMusic(40_002, true)
  const record = (music: MusicInfo, rating: number) => new RecordEntry(
    music,
    music.charts[0],
    1_005_000,
    ComboStatus.FullComboPlus,
    SyncStatus.FullSyncDeluxePlus,
    music.charts[0].maxDeluxeScore,
    Rate.get(1_005_000),
    rating,
  )
  const oldRecord = record(oldMusic, 320)
  const newRecord = record(newMusic, 330)
  const data = new MaimaiDataStore({
    revision: 'stress',
    versions: new Map([[oldVersion.name, oldVersion], [newVersion.name, newVersion]]),
    musics: new Map([[oldMusic.id, oldMusic], [newMusic.id, newMusic]]),
    plates: new Map(),
    icons: new Map(),
    courses: new Map(),
  }, {
    schemaVersion: 1,
    revision: 'stress',
    generatedAt: '2026-07-14T00:00:00.000Z',
    files: {},
  }, new Map())
  const service = new TakumiRenderService({ concurrency: 1, queueLimit: 64, timeoutMs: 240_000 })
  const renderer = new TakumiMaiRenderer(service, data)
  const rating = (index: number) => renderer.renderRating({
    backend: `Stress-${index}`,
    player: new PlayerInfo(`User-${index}`, 15_000 + index, 1),
    settings: new PlayerSettings(null, null),
    oldRecords: Array.from({ length: 35 }, () => oldRecord),
    newRecords: Array.from({ length: 15 }, () => newRecord),
    oldCount: 35,
    newCount: 15,
    title: `User-${index} B50 acceptance`,
  })
  const level = (index: number) => renderer.renderLevel({
    title: `User-${index} 14+ progress`,
    groups: [{ label: '14+', charts: [oldMusic.charts[0], newMusic.charts[0]] }],
    records: [oldRecord, newRecord],
    requirement: 'achievement',
    showProgress: true,
    progress: {
      Basic: { completed: index, total: 16 },
      Advanced: { completed: 16, total: 16 },
      Expert: { completed: 15, total: 16 },
      Master: { completed: 14, total: 16 },
      ReMaster: { completed: 13, total: 16 },
    },
  })
  return { service, rating, level }
}

interface StressResult {
  key: string
  buffer: Buffer
  durationMs: number
}

async function measuredBatch(
  name: string,
  jobs: Array<{ key: string, run(): Promise<Buffer> }>,
) {
  const started = performance.now()
  let peakRss = process.memoryUsage().rss
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 5)
  sampler.unref?.()
  const settled = await Promise.allSettled(jobs.map(async (job): Promise<StressResult> => {
    const jobStarted = performance.now()
    const buffer = await job.run()
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
    return { key: job.key, buffer, durationMs: performance.now() - jobStarted }
  }))
  clearInterval(sampler)
  const elapsedMs = performance.now() - started
  const outputs = settled.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
  const errors = settled.length - outputs.length
  const durations = outputs.map(output => output.durationMs).sort((left, right) => left - right)
  const p95Ms = durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] ?? 0
  const metrics = {
    name,
    requests: jobs.length,
    throughputPerSecond: Number((jobs.length / (elapsedMs / 1_000)).toFixed(2)),
    p95Ms: Number(p95Ms.toFixed(2)),
    peakRssBytes: peakRss,
    errors,
  }
  process.stdout.write(`[mai-plugin stress] ${JSON.stringify(metrics)}\n`)
  return { metrics, outputs }
}

async function expectNonBlank(outputs: StressResult[]) {
  for (const output of outputs) {
    const metadata = await sharp(output.buffer).metadata()
    expect(metadata).toMatchObject({ format: 'png' })
    expect(metadata.width).toBeGreaterThan(100)
    expect(metadata.height).toBeGreaterThan(100)
    const stats = await sharp(output.buffer).stats()
    expect(stats.channels.some(channel => channel.stdev > 0)).toBe(true)
  }
}

describe('image comparison acceptance utility', () => {
  it('enforces the 0.5% whole-image and key-region thresholds', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mai-image-compare-'))
    temporaryDirectories.push(directory)
    const expectedPath = join(directory, 'expected.png')
    const withinPath = join(directory, 'within.png')
    const outsidePath = join(directory, 'outside.png')
    const base = await sharp({
      create: { width: 100, height: 100, channels: 4, background: '#113355' },
    }).png().toBuffer()
    const changed = async (size: number) => sharp(base)
      .composite([{
        input: await sharp({
          create: { width: size, height: size, channels: 4, background: '#ffffff' },
        }).png().toBuffer(),
        left: 0,
        top: 0,
      }])
      .png()
      .toBuffer()
    await Promise.all([
      writeFile(expectedPath, base),
      writeFile(withinPath, await changed(5)),
      writeFile(outsidePath, await changed(10)),
    ])

    await expect(compareImages(withinPath, expectedPath, { threshold: 0.005 }))
      .resolves.toMatchObject({ pass: true, changedPixelRatio: 0.0025 })
    await expect(compareImages(withinPath, expectedPath, {
      threshold: 0.005,
      regions: [{ name: 'cover', left: 0, top: 0, width: 50, height: 50 }],
    })).resolves.toMatchObject({
      pass: false,
      changedPixelRatio: 0.0025,
      regions: [{ name: 'cover', changedPixelRatio: 0.01, pass: false }],
    })
    await expect(compareImages(outsidePath, expectedPath, { threshold: 0.005 }))
      .resolves.toMatchObject({ pass: false, changedPixelRatio: 0.01 })
  })
})

describe('Takumi acceptance stress', () => {
  const runHeavyStress = process.env.MAI_RUN_STRESS === '1'
    || process.env.npm_lifecycle_event === 'test:stress'

  it.runIf(runHeavyStress)(
    'renders 16 B50, 16 level, and 64 mixed requests without blank or cross-user output',
    async () => {
      const unhandled: unknown[] = []
      const onUnhandled = (error: unknown) => { unhandled.push(error) }
      process.on('unhandledRejection', onUnhandled)
      const fixture = rendererFixture()
      try {
        const acceptBatch = async (batch: Awaited<ReturnType<typeof measuredBatch>>) => {
          expect(batch.metrics.errors).toBe(0)
          expect(batch.metrics.throughputPerSecond).toBeGreaterThan(0)
          expect(batch.metrics.p95Ms).toBeGreaterThan(0)
          await expectNonBlank(batch.outputs)
          const hashes = batch.outputs.map(output => (
            createHash('sha256').update(output.buffer).digest('hex')
          ))
          expect(new Set(hashes).size).toBe(batch.outputs.length)
        }
        await acceptBatch(await measuredBatch('b50-16', Array.from({ length: 16 }, (_, index) => ({
          key: `rating-${index}`,
          run: () => fixture.rating(index),
        }))))
        await acceptBatch(await measuredBatch('level-16', Array.from({ length: 16 }, (_, index) => ({
          key: `level-${index}`,
          run: () => fixture.level(index),
        }))))
        await acceptBatch(await measuredBatch('mixed-64', Array.from({ length: 64 }, (_, index) => ({
          key: `${index % 2 ? 'level' : 'rating'}-${index}`,
          run: () => index % 2 ? fixture.level(100 + index) : fixture.rating(100 + index),
        }))))
        expect(fixture.service.activeRenders).toBe(0)
        expect(fixture.service.pendingRenders).toBe(0)
        await new Promise(resolve => setImmediate(resolve))
        expect(unhandled).toEqual([])
      } finally {
        process.off('unhandledRejection', onUnhandled)
      }
    },
    300_000,
  )

  it('enforces queue limits and releases permits after timeout cancellation', async () => {
    let releaseGate: (() => void) | undefined
    const gate = new Promise<void>(resolve => { releaseGate = resolve })
    let starts = 0
    const limited = new TakumiRenderService(
      { concurrency: 1, queueLimit: 1, timeoutMs: 30_000 },
      { beforeRender: async () => { if (++starts === 1) await gate } },
    )
    const node = createContainerNode({
      style: { width: 32, height: 32, backgroundColor: '#336699' },
      children: [],
    })
    const first = limited.render(node, { width: 32, height: 32 })
    await expect.poll(() => limited.activeRenders).toBe(1)
    const second = limited.render(node, { width: 32, height: 32 })
    await expect.poll(() => limited.pendingRenders).toBe(1)
    await expect(limited.render(node, { width: 32, height: 32 }))
      .rejects.toThrow(RENDER_QUEUE_FULL_MESSAGE)
    releaseGate!()
    await Promise.all([first, second])

    const timed = new TakumiRenderService(
      { concurrency: 1, queueLimit: 1, timeoutMs: 25 },
      { beforeRender: () => new Promise(() => undefined) },
    )
    await expect(timed.render(node, { width: 32, height: 32 })).rejects.toMatchObject({
      name: 'TimeoutError',
    })
    expect(limited.activeRenders).toBe(0)
    expect(limited.pendingRenders).toBe(0)
    expect(timed.activeRenders).toBe(0)
    expect(timed.pendingRenders).toBe(0)
  }, 60_000)
})
