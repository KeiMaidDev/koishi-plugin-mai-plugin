import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import type { Node } from '@takumi-rs/helpers'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MaimaiDataStore } from '../../src/data/sync-service'
import {
  ComboStatus,
  MusicDifficulty,
  MusicGenre,
  MusicType,
  SyncStatus,
} from '../../src/domain/enums'
import {
  ChartInfo,
  MusicInfo,
  Notes,
  RecordEntry,
  type GameVersion,
} from '../../src/domain/music'
import { PlayerInfo, PlayerSettings } from '../../src/domain/player'
import { TakumiMaiRenderer } from '../../src/render/mai-renderer'
import { createContainerNode, createTextNode } from '../../src/render/nodes'
import { TakumiRenderService } from '../../src/render/renderer'

const oldVersion: GameVersion = { id: 1, name: 'maimai ORANGE', version: 19_900 }
const newVersion: GameVersion = { id: 2, name: '舞萌DX 2026', version: 22_100 }
const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

const data = new MaimaiDataStore({
  revision: 'render-template-fixture',
  versions: new Map([[oldVersion.name, oldVersion], [newVersion.name, newVersion]]),
  musics: new Map(),
  plates: new Map(),
  icons: new Map(),
  courses: new Map(),
}, {
  schemaVersion: 1,
  revision: 'render-template-fixture',
  generatedAt: '2026-07-14T00:00:00.000Z',
  files: {},
}, new Map())

function fixtureMusic(
  id: number,
  name: string,
  type = MusicType.Deluxe,
  genre = MusicGenre.Original,
  version = oldVersion,
) {
  const music = new MusicInfo(id, name, type, '', 'Fixture Artist', genre, 186, version, version === newVersion)
  music.charts = [
    [MusicDifficulty.Basic, '7', 7.0],
    [MusicDifficulty.Advanced, '10', 10.4],
    [MusicDifficulty.Expert, '13', 13.2],
    [MusicDifficulty.Master, '14+', 14.7],
    [MusicDifficulty.ReMaster, '15', 15.0],
  ].map(([difficulty, level, levelValue]) => new ChartInfo(
    music,
    difficulty as MusicDifficulty,
    level as string,
    levelValue as number,
    new Notes(320, 40, 65, 20, 15),
    `Fixture Designer ${String(level)}`,
  ))
  return music
}

function fixtureRecord(
  music: MusicInfo,
  difficulty = MusicDifficulty.Master,
  rating = 326,
) {
  const chart = music.charts.find(entry => entry.difficulty === difficulty)!
  return new RecordEntry(
    music,
    chart,
    1_005_000,
    ComboStatus.FullComboPlus,
    SyncStatus.FullSyncDeluxePlus,
    Math.floor(chart.maxDeluxeScore * 0.98),
    'sssp',
    rating,
  )
}

function collectNodes(node: Node, predicate: (candidate: Node) => boolean, result: Node[] = []) {
  if (predicate(node)) result.push(node)
  if (node.type === 'container') {
    for (const child of node.children ?? []) collectNodes(child, predicate, result)
  }
  return result
}

function collectText(node: Node) {
  return collectNodes(node, candidate => candidate.type === 'text')
    .map(candidate => candidate.type === 'text' ? candidate.text : '')
}

function baselineRecord(index: number, version: GameVersion) {
  const difficulties = [
    MusicDifficulty.Basic,
    MusicDifficulty.Advanced,
    MusicDifficulty.Expert,
    MusicDifficulty.Master,
    MusicDifficulty.ReMaster,
  ]
  const achievements = [1_005_000, 1_000_000, 995_000, 990_000, 980_000]
  const rates = ['sssp', 'sss', 'ssp', 'ss', 'sp'] as const
  const combos = [
    ComboStatus.AllPerfectPlus,
    ComboStatus.AllPerfect,
    ComboStatus.FullComboPlus,
    ComboStatus.FullCombo,
    ComboStatus.None,
  ]
  const syncs = [
    SyncStatus.FullSyncDeluxePlus,
    SyncStatus.FullSyncDeluxe,
    SyncStatus.FullSyncPlus,
    SyncStatus.FullSync,
    SyncStatus.None,
  ]
  const music = fixtureMusic(
    80_000 + index,
    index % 7 === 0
      ? `Baseline Track ${index + 1} with a deliberately long operational title for truncation`
      : `Baseline Track ${index + 1}`,
    index % 2 ? MusicType.Standard : MusicType.Deluxe,
    MusicGenre.values[index % MusicGenre.values.length],
    version,
  )
  const chart = music.charts.find(entry => entry.difficulty === difficulties[index % difficulties.length])!
  const maxScore = chart.maxDeluxeScore
  const scoreRatios = [0.88, 0.91, 0.94, 0.96, 0.98]
  return new RecordEntry(
    music,
    chart,
    achievements[index % achievements.length],
    combos[index % combos.length],
    syncs[index % syncs.length],
    Math.floor(maxScore * scoreRatios[index % scoreRatios.length]),
    rates[index % rates.length],
    180 + index * 3,
  )
}

function baselineFixtures() {
  const oldRecords = Array.from({ length: 35 }, (_, index) => baselineRecord(index, oldVersion))
  const newRecords = Array.from({ length: 15 }, (_, index) => baselineRecord(35 + index, newVersion))
  const scoreMusic = fixtureMusic(
    91_001,
    'Baseline single-song title that spans the allowed two lines without covering metadata',
    MusicType.Deluxe,
    MusicGenre.Touhou,
    newVersion,
  )
  scoreMusic.charts = scoreMusic.charts.filter(chart => chart.difficulty !== MusicDifficulty.ReMaster)
  const scoreRecords = scoreMusic.charts.map((chart, index) => {
    const record = fixtureRecord(scoreMusic, chart.difficulty, 240 + index * 17)
    record.achievement = [980_000, 990_000, 1_000_000, 1_005_000][index]
    record.rate = ['sp', 'ss', 'sss', 'sssp'][index] as typeof record.rate
    return record
  })
  const levelCharts = [...oldRecords.slice(0, 12).map(record => record.chart), newRecords[4].chart]
  const levelRecords = [...oldRecords.slice(0, 9), newRecords[4]]
  const courseSongs = oldRecords.slice(0, 4).map((record, index) => {
    record.achievement = 990_000 - index * 2_000
    record.rate = 'ss'
    return { chart: record.chart, record }
  })
  const courseBase = {
    name: 'Baseline Course',
    mode: 0,
    random: false,
    lower: 1,
    upper: 15,
    musics: courseSongs.map(({ chart }) => ({
      id: chart.music.id,
      name: chart.music.name,
      difficulty: chart.difficulty.value,
    })),
    life: 50,
    recover: 2,
    damage: { perfect: 0, great: 1, good: 2, miss: 5 },
  }

  return {
    rating: {
      backend: 'Baseline Backend',
      player: new PlayerInfo('超长基准昵称'.repeat(10), 0, 12),
      settings: new PlayerSettings(null, null),
      oldRecords,
      newRecords,
    },
    score: { music: scoreMusic, records: scoreRecords },
    level: {
      title: '14+ 全完成进度 · Baseline',
      groups: [
        { label: '15', charts: levelCharts.slice(0, 4) },
        { label: '14+', charts: levelCharts.slice(4, 9) },
        { label: '13', charts: levelCharts.slice(9) },
      ],
      records: levelRecords,
      requirement: 'achievement' as const,
      showProgress: true,
      progress: {
        Basic: { completed: 18, total: 20 },
        Advanced: { completed: 23, total: 24 },
        Expert: { completed: 36, total: 40 },
        Master: { completed: 30, total: 38 },
        ReMaster: { completed: 12, total: 18 },
      },
    },
    courses: [
      { course: { ...courseBase, id: 1_001 }, songs: courseSongs },
      { course: { ...courseBase, id: 1_050 }, songs: courseSongs },
      { course: { ...courseBase, id: 1_200 }, songs: courseSongs },
    ],
    radar: {
      title: 'Baseline Radar',
      axes: [
        { label: 'Keys', value: 8.2 },
        { label: 'Burst', value: 7.1 },
        { label: 'Stamina', value: 9.4 },
        { label: 'Slide', value: 6.8 },
        { label: 'Reach', value: 5.5 },
        { label: 'Technical', value: 9.9 },
      ] as const,
    },
  }
}

function validateBaselineUpdate(
  actualPlatform: 'windows' | 'linux' | undefined,
  requestedPlatform: string | undefined,
  update: boolean,
) {
  if (!update) return
  if (requestedPlatform !== 'windows' && requestedPlatform !== 'linux') {
    throw new Error('MAI_BASELINE_PLATFORM must be windows or linux while updating baselines')
  }
  if (requestedPlatform !== actualPlatform) {
    throw new Error(`Cannot generate ${requestedPlatform} baselines on ${actualPlatform ?? process.platform}`)
  }
}

async function changedPixelRatio(actual: Buffer, expected: Buffer) {
  const [actualImage, expectedImage] = await Promise.all([
    sharp(actual).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expected).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  expect(actualImage.info).toMatchObject({
    width: expectedImage.info.width,
    height: expectedImage.info.height,
    channels: expectedImage.info.channels,
  })
  let changed = 0
  for (let offset = 0; offset < actualImage.data.length; offset += actualImage.info.channels) {
    if (!actualImage.data.subarray(offset, offset + actualImage.info.channels)
      .equals(expectedImage.data.subarray(offset, offset + expectedImage.info.channels))) {
      changed++
    }
  }
  return changed / (actualImage.info.width * actualImage.info.height)
}

async function expectNonBlankPng(buffer: Buffer, width: number, height: number) {
  expect(await sharp(buffer).metadata()).toMatchObject({ format: 'png', width, height })
  const { data: pixels, info } = await sharp(buffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const first = pixels.subarray(0, info.channels)
  let changed = 0
  for (let offset = info.channels; offset < pixels.length; offset += info.channels) {
    if (!pixels.subarray(offset, offset + info.channels).equals(first)) changed++
  }
  expect(changed).toBeGreaterThan(1_000)
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(temporaryDirectories.splice(0).map(directory =>
    rm(directory, { recursive: true, force: true }),
  ))
})

describe('maimai visual template contract', () => {
  it('uses the exact required difficulty colors', async () => {
    const renderExports = await import('../../src/index') as Record<string, unknown>

    expect(renderExports.MAIMAI_DIFFICULTY_COLORS).toEqual({
      Basic: '#45c124',
      Advanced: '#f8b709',
      Expert: '#ff5a66',
      Master: '#9f51dc',
      ReMaster: '#dbaaff',
      Utage: '#ff6ffd',
    })
  })

  it('exports a concrete MaiRenderer-compatible service', async () => {
    const renderExports = await import('../../src/index') as Record<string, unknown>
    const RendererConstructor = renderExports.TakumiMaiRenderer as {
      prototype?: Record<string, unknown>
    } | undefined

    expect(RendererConstructor).toBeTypeOf('function')
    expect(RendererConstructor?.prototype).toMatchObject({
      renderRating: expect.any(Function),
      renderScore: expect.any(Function),
      renderLevel: expect.any(Function),
      renderCourse: expect.any(Function),
      renderRadar: expect.any(Function),
    })
  })

  it('builds a complete 35+15 B50 tree and delegates it to the shared renderer', async () => {
    const oldMusic = fixtureMusic(
      10_001,
      'An operationally long maimai song title that must truncate without moving neighboring fields',
    )
    const newMusic = fixtureMusic(20_002, 'Newest Fixture Track', MusicType.Standard, MusicGenre.Niconico, newVersion)
    const oldRecord = fixtureRecord(oldMusic)
    const newRecord = fixtureRecord(newMusic, MusicDifficulty.Expert, 287)
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    const render = vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('rating-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)

    const result = await renderer.renderRating({
      backend: 'Fixture Backend',
      player: new PlayerInfo('极长昵称'.repeat(14), oldRecord.rating + newRecord.rating, 12),
      settings: new PlayerSettings(null, null),
      oldRecords: [oldRecord],
      newRecords: [newRecord],
    })

    expect(result).toEqual(Buffer.from('rating-template'))
    expect(render).toHaveBeenCalledWith(
      expect.any(Object),
      { width: 1440, height: 1490, format: 'png' },
      undefined,
    )
    expect(capturedNode).toBeDefined()
    const slots = collectNodes(capturedNode!, node => node.className === 'rating-slot')
    const statusRows = collectNodes(capturedNode!, node => node.className === 'rating-status-row')
    const statusBadges = collectNodes(capturedNode!, node => node.className === 'rating-status-badge')
    const text = collectText(capturedNode!)
    expect(slots).toHaveLength(50)
    expect(slots.filter(node => node.attributes?.['data-empty'] === 'true')).toHaveLength(48)
    expect(statusRows).toHaveLength(2)
    expect(statusRows.every(node => node.style?.gap === 2 && node.style?.overflow === 'hidden')).toBe(true)
    expect(statusBadges).toHaveLength(10)
    expect(statusBadges.every(node => node.style?.minWidth === 24
      && node.style?.paddingLeft === 3
      && node.style?.paddingRight === 3)).toBe(true)
    expect(text).toEqual(expect.arrayContaining([
      '[Fixture Backend] B35 326 + B15 287 = 613',
      '极长昵称'.repeat(14),
      '#1 · ID 10001',
      oldMusic.name,
      '100.5000%',
      '14.7 -> 326',
      'DX',
      'SSS+',
      'FC+',
      'FSD+',
      'DX ★5',
    ]))
    expect(capturedNode).toMatchObject({
      id: 'rating-template',
      style: expect.objectContaining({ width: 1440, height: 1490, overflow: 'hidden' }),
    })
  })

  it('renders single-song metadata and every standard difficulty row without ReMaster', async () => {
    const music = fixtureMusic(
      30_003,
      'A very long single-song title that remains bounded while every metadata field stays visible',
      MusicType.Deluxe,
      MusicGenre.Touhou,
      newVersion,
    )
    music.charts = music.charts.filter(chart => chart.difficulty !== MusicDifficulty.ReMaster)
    const records = music.charts.map((chart, index) => fixtureRecord(music, chart.difficulty, 210 + index * 12))
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    const render = vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('score-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)

    const result = await renderer.renderScore({ music, records })

    expect(result).toEqual(Buffer.from('score-template'))
    expect(render).toHaveBeenCalledWith(
      expect.any(Object),
      { width: 1200, height: 1080, format: 'png' },
      undefined,
    )
    const rows = collectNodes(capturedNode!, node => node.className === 'score-difficulty-row')
    const cover = collectNodes(capturedNode!, node => node.className === 'score-cover')
    const text = collectText(capturedNode!)
    expect(rows).toHaveLength(5)
    expect(rows.map(node => node.attributes?.['data-difficulty'])).toEqual([
      'Basic', 'Advanced', 'Expert', 'Master', 'ReMaster',
    ])
    expect(rows.at(-1)?.attributes?.['data-empty']).toBe('true')
    expect(cover).toHaveLength(1)
    expect(cover[0]).toMatchObject({ width: 280, height: 280 })
    expect(text).toEqual(expect.arrayContaining([
      'ID 30003',
      music.name,
      'Fixture Artist',
      'BPM 186',
      'DX',
      MusicGenre.Touhou.genreName,
      newVersion.name,
      'Master 14+ (14.7)',
      '100.5000%',
      'SSS+',
      'FC+',
      'FSD+',
      `${records[3].deluxeScore}/${records[3].chart.maxDeluxeScore} · ★5`,
      records[3].chart.notesDesigner,
      'No ReMaster chart',
    ]))
    expect(capturedNode).toMatchObject({
      id: 'score-template',
      style: expect.objectContaining({ width: 1200, height: 1080, overflow: 'hidden' }),
    })
  })

  it('ignores records for another song when matching score rows', async () => {
    const music = fixtureMusic(31_003, 'Target Score Fixture')
    const otherMusic = fixtureMusic(31_004, 'Other Score Fixture')
    const targetRecord = fixtureRecord(music, MusicDifficulty.Master, 321)
    const otherRecord = fixtureRecord(otherMusic, MusicDifficulty.Master, 999)
    otherRecord.achievement = 800_000
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('score-record-filter')
    })

    await new TakumiMaiRenderer(renderService, data).renderScore({
      music,
      records: [otherRecord, targetRecord],
    })

    const text = collectText(capturedNode!)
    expect(text).toContain('100.5000%')
    expect(text).not.toContain('80.0000%')
    expect(text).toContain('Rating 321')
    expect(text).not.toContain('Rating 999')
  })

  it('renders an Utage song as one banquet difficulty row', async () => {
    const music = fixtureMusic(40_004, '宴会場 Fixture', MusicType.Deluxe, MusicGenre.Utage, newVersion)
    music.charts = [new ChartInfo(
      music,
      MusicDifficulty.Utage,
      '宴',
      0,
      new Notes(400, 60, 80, 40, 20),
      '宴谱师',
    )]
    const record = fixtureRecord(music, MusicDifficulty.Utage, 0)
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('utage-score-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)

    await renderer.renderScore({ music, records: [record] })

    const rows = collectNodes(capturedNode!, node => node.className === 'score-difficulty-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      attributes: { 'data-difficulty': 'Utage', 'data-empty': 'false' },
      style: expect.objectContaining({ borderLeft: '10px solid #ff6ffd' }),
    })
    expect(collectText(capturedNode!)).toEqual(expect.arrayContaining([
      'Utage 宴 (0.0)',
      '宴谱师',
      '100.5000%',
      `${record.deluxeScore}/${record.chart.maxDeluxeScore} · ★5`,
    ]))
  })

  it('renders grouped level tiles and four-difficulty completion progress without ReMaster', async () => {
    const first = fixtureMusic(50_005, 'Level Fixture One')
    const second = fixtureMusic(50_006, 'Level Fixture Two', MusicType.Standard)
    const charts = [
      first.charts.find(chart => chart.difficulty === MusicDifficulty.Master)!,
      first.charts.find(chart => chart.difficulty === MusicDifficulty.Expert)!,
      second.charts.find(chart => chart.difficulty === MusicDifficulty.Advanced)!,
      second.charts.find(chart => chart.difficulty === MusicDifficulty.Basic)!,
    ]
    const records = [
      fixtureRecord(first, MusicDifficulty.Master, 305),
      fixtureRecord(first, MusicDifficulty.Expert, 250),
    ]
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    const render = vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('level-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)

    await renderer.renderLevel({
      title: '14+ 完成表 · A deliberately long title that remains inside the header',
      groups: [
        { label: '14+', charts: charts.slice(0, 2) },
        { label: '10', charts: charts.slice(2) },
      ],
      records,
      requirement: 'achievement',
      showProgress: true,
      progress: {
        Basic: { completed: 12, total: 20 },
        Advanced: { completed: 18, total: 24 },
        Expert: { completed: 31, total: 40 },
        Master: { completed: 15, total: 38 },
      },
    })

    expect(render).toHaveBeenCalledWith(
      expect.any(Object),
      { width: 1280, height: 720, format: 'png' },
      undefined,
    )
    const groups = collectNodes(capturedNode!, node => node.className === 'level-group')
    const tiles = collectNodes(capturedNode!, node => node.className === 'level-chart-tile')
    const covers = collectNodes(capturedNode!, node => node.className === 'level-cover')
    const progress = collectNodes(capturedNode!, node => node.className === 'level-progress-item')
    expect(groups).toHaveLength(2)
    expect(tiles).toHaveLength(4)
    expect(covers).toHaveLength(4)
    expect(covers.every(node => node.type === 'image' && node.width === 72 && node.height === 72)).toBe(true)
    expect(progress.map(node => node.attributes?.['data-difficulty'])).toEqual([
      'Basic', 'Advanced', 'Expert', 'Master',
    ])
    expect(tiles.map(node => node.attributes?.['data-difficulty'])).toEqual([
      'Master', 'Expert', 'Advanced', 'Basic',
    ])
    expect(collectText(capturedNode!)).toEqual(expect.arrayContaining([
      '14+ 完成表 · A deliberately long title that remains inside the header',
      '14+',
      '10',
      'ID 50005',
      'DX',
      'SSS+',
      '12/20',
      '18/24',
      '31/40',
      '15/38',
    ]))
    expect(capturedNode).toMatchObject({
      id: 'level-template',
      style: expect.objectContaining({ width: 1280, height: 720, overflow: 'hidden' }),
    })
  })

  it('renders all three course backgrounds with life, recovery, Final, and four tracks', async () => {
    const songs = Array.from({ length: 4 }, (_, index) => {
      const music = fixtureMusic(60_010 + index, `Course Fixture Track ${index + 1}`)
      const chart = music.charts.find(entry => entry.difficulty === MusicDifficulty.Master)!
      const record = fixtureRecord(music, MusicDifficulty.Master, 240 + index)
      record.achievement = 990_000
      record.rate = 'ss'
      return { chart, record }
    })
    const renderService = new TakumiRenderService()
    const captured: Node[] = []
    const render = vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      captured.push(node)
      return Buffer.from('course-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)
    const baseCourse = {
      name: 'Fixture Course',
      mode: 0,
      random: false,
      lower: 1,
      upper: 15,
      musics: songs.map(({ chart }) => ({
        id: chart.music.id,
        name: chart.music.name,
        difficulty: chart.difficulty.value,
      })),
      life: 50,
      recover: 2,
      damage: { perfect: 0, great: 1, good: 2, miss: 5 },
    }

    for (const id of [1_001, 1_050, 1_200]) {
      await renderer.renderCourse({ course: { ...baseCourse, id }, songs })
    }

    expect(render).toHaveBeenCalledTimes(3)
    for (const call of render.mock.calls) {
      expect(call.slice(1)).toEqual([
        { width: 1280, height: 760, format: 'png' },
        undefined,
      ])
    }
    expect(captured.map(node => collectNodes(node, candidate => candidate.className === 'course-background')[0]?.id))
      .toEqual(['course-background-1', 'course-background-2', 'course-background-3'])
    for (const node of captured) {
      expect(collectNodes(node, candidate => candidate.className === 'course-song-card')).toHaveLength(4)
      expect(collectNodes(node, candidate => candidate.id === 'course-final')).toHaveLength(1)
      expect(collectText(node)).toEqual(expect.arrayContaining([
        'Fixture Course',
        'LIFE 50',
        'RECOVER +2',
        'Final',
        'TRACK 1',
        'TRACK 4',
        'Course Fixture Track 1',
        'Course Fixture Track 4',
      ]))
      expect(node).toMatchObject({
        id: 'course-template',
        style: expect.objectContaining({ width: 1280, height: 760, overflow: 'hidden' }),
      })
    }
  })

  it('renders a real six-axis Takumi SVG radar polygon without Canvas', async () => {
    const renderService = new TakumiRenderService()
    let capturedNode: Node | undefined
    const render = vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      capturedNode = node
      return Buffer.from('radar-template')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)

    await renderer.renderRadar({
      title: 'Chart Radar',
      axes: [
        { label: 'Keys', value: 8.2 },
        { label: 'Burst', value: 7.1 },
        { label: 'Stamina', value: 9.4 },
        { label: 'Slide', value: 6.8 },
        { label: 'Reach', value: 5.5 },
        { label: 'Technical', value: 12.0 },
      ],
    })

    expect(render).toHaveBeenCalledWith(
      expect.any(Object),
      { width: 600, height: 600, format: 'png' },
      undefined,
    )
    const radarImage = collectNodes(capturedNode!, node => node.className === 'radar-svg')
    const labels = collectNodes(capturedNode!, node => node.className === 'radar-axis-label')
    expect(radarImage).toHaveLength(1)
    expect(labels).toHaveLength(6)
    expect(radarImage[0].type).toBe('image')
    const source = radarImage[0].type === 'image'
      ? Buffer.from(radarImage[0].src as Uint8Array).toString('utf8')
      : ''
    expect(source).toContain('<svg')
    expect(source).not.toContain('<canvas')
    expect(source.match(/<line /g)).toHaveLength(6)
    expect(source.match(/<polygon /g)).toHaveLength(6)
    const dataPoints = source.match(/<polygon id="radar-data" points="([^"]+)"/)?.[1].split(' ')
    expect(dataPoints).toHaveLength(6)
    expect(collectText(capturedNode!)).toEqual(expect.arrayContaining([
      'Chart Radar',
      'Keys', '8.20',
      'Burst', '7.10',
      'Stamina', '9.40',
      'Slide', '6.80',
      'Reach', '5.50',
      'Technical', '10.00',
    ]))
    expect(capturedNode).toMatchObject({
      id: 'radar-template',
      style: expect.objectContaining({ width: 600, height: 600, overflow: 'hidden' }),
    })
  })

  it('uses generated replacements for missing Shinobu plates and icons', async () => {
    const music = fixtureMusic(70_007, 'Generated Asset Fixture')
    const record = fixtureRecord(music)
    const ratingService = new TakumiRenderService()
    let ratingNode: Node | undefined
    vi.spyOn(ratingService, 'render').mockImplementation(async (node) => {
      ratingNode = node
      return Buffer.from('rating-assets')
    })
    await new TakumiMaiRenderer(ratingService, data).renderRating({
      backend: 'Assets',
      player: new PlayerInfo('Asset Player', record.rating, 10),
      oldRecords: [record],
      newRecords: [],
    })

    expect(collectNodes(ratingNode!, node => node.className === 'rating-number-plate-asset')).toHaveLength(1)
    expect(collectNodes(ratingNode!, node => node.className === 'dan-badge-asset')).toHaveLength(1)
    expect(collectNodes(ratingNode!, node => node.className === 'generated-status-plate').length).toBeGreaterThan(0)

    const utage = fixtureMusic(70_008, '宴 Asset Fixture', MusicType.Deluxe, MusicGenre.Utage, newVersion)
    utage.charts = [new ChartInfo(
      utage,
      MusicDifficulty.Utage,
      '宴',
      0,
      new Notes(100, 20, 30, 10, 5),
      '宴谱师',
    )]
    const scoreService = new TakumiRenderService()
    let scoreNode: Node | undefined
    vi.spyOn(scoreService, 'render').mockImplementation(async (node) => {
      scoreNode = node
      return Buffer.from('score-assets')
    })
    await new TakumiMaiRenderer(scoreService, data).renderScore({ music: utage })

    expect(collectNodes(scoreNode!, node => node.className === 'utage-icon')).toHaveLength(1)
  })

  it('regenerates the checked-in functional assets byte-identically in isolation', async () => {
    const first = await mkdtemp(join(tmpdir(), 'mai-generated-assets-a-'))
    const second = await mkdtemp(join(tmpdir(), 'mai-generated-assets-b-'))
    temporaryDirectories.push(first, second)
    const generator = join(projectRoot, 'scripts', 'generate-render-assets.mjs')

    await execFileAsync(process.execPath, [generator, '--output', first], { cwd: projectRoot })
    await execFileAsync(process.execPath, [generator, '--output', second], { cwd: projectRoot })

    const expectedNames = [
      'course-background-1.png',
      'course-background-2.png',
      'course-background-3.png',
      'course-final-plate.png',
      'dan-badge.png',
      'rating-number-plate.png',
      'status-plate.png',
      'utage-icon.png',
    ]
    expect((await readdir(first)).sort()).toEqual(expectedNames)
    expect((await readdir(second)).sort()).toEqual(expectedNames)

    for (const name of expectedNames) {
      const [firstBytes, secondBytes, checkedInBytes] = await Promise.all([
        readFile(join(first, name)),
        readFile(join(second, name)),
        readFile(join(projectRoot, 'assets', 'generated', name)),
      ])
      const hashes = [firstBytes, secondBytes, checkedInBytes].map(bytes =>
        createHash('sha256').update(bytes).digest('hex'),
      )
      expect(new Set(hashes).size, name).toBe(1)
    }
  })

  it('creates independent frozen B50 trees with fifty stable empty slots', async () => {
    const renderService = new TakumiRenderService()
    const captured: Node[] = []
    vi.spyOn(renderService, 'render').mockImplementation(async (node) => {
      captured.push(node)
      return Buffer.from('empty-rating')
    })
    const renderer = new TakumiMaiRenderer(renderService, data)
    const input = {
      backend: 'Empty Fixture',
      player: new PlayerInfo('Missing avatar and plate fixture', 0, 0),
      settings: new PlayerSettings(999_999, 999_999),
      oldRecords: [],
      newRecords: [],
    }

    await renderer.renderRating(input)
    await renderer.renderRating(input)

    expect(captured).toHaveLength(2)
    expect(captured[0]).not.toBe(captured[1])
    expect(captured[0].style).not.toBe(captured[1].style)
    expect(Object.isFrozen(captured[0])).toBe(true)
    expect(Object.isFrozen(captured[1])).toBe(true)
    for (const tree of captured) {
      const slots = collectNodes(tree, node => node.className === 'rating-slot')
      expect(slots).toHaveLength(50)
      expect(slots.every(node => node.attributes?.['data-empty'] === 'true')).toBe(true)
      expect(slots.every(node => node.style?.width === 268 && node.style?.height === 104)).toBe(true)
    }
    const firstSlot = collectNodes(captured[0], node => node.className === 'rating-slot')[0]
    const secondSlot = collectNodes(captured[1], node => node.className === 'rating-slot')[0]
    expect(firstSlot).not.toBe(secondSlot)
    expect(firstSlot.style).not.toBe(secondSlot.style)
  })

  it('freezes newly created node trees in production mode', () => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const node = createContainerNode({
        style: { width: 100 },
        children: [createTextNode({ text: 'production tree' })],
      })
      expect(Object.isFrozen(node)).toBe(true)
      expect(Object.isFrozen(node.style)).toBe(true)
      expect(Object.isFrozen(node.children)).toBe(true)
      expect(Object.isFrozen(node.children?.[0])).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })

  it('loads an explicit compatibility asset when a mapped file is missing', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'mai-missing-render-asset-'))
    temporaryDirectories.push(directory)
    const fallback = join(directory, 'fallback.bin')
    await writeFile(fallback, Buffer.from('compatibility-asset'))

    await expect(new TakumiRenderService().loadAsset(
      join(directory, 'missing.bin'),
      fallback,
    )).resolves.toEqual(Buffer.from('compatibility-asset'))
  })
})

describe('native template baselines', () => {
  const platform = process.platform === 'win32'
    ? 'windows'
    : process.platform === 'linux'
      ? 'linux'
      : undefined

  it('rejects cross-platform baseline updates before files are written', () => {
    expect(() => validateBaselineUpdate('windows', 'linux', true))
      .toThrow('Cannot generate linux baselines on windows')
    expect(() => validateBaselineUpdate('linux', 'windows', true))
      .toThrow('Cannot generate windows baselines on linux')
  })

  it.skipIf(!platform)('matches fixed platform baselines within 0.5% changed pixels', async () => {
    const baselineDirectory = join(projectRoot, 'tests', 'render', 'baselines')
    const updatePlatform = process.env.MAI_BASELINE_PLATFORM
    const update = process.env.MAI_UPDATE_RENDER_BASELINES === '1'
    validateBaselineUpdate(platform, updatePlatform, update)
    if (platform === 'linux' && !update) {
      const status = await readFile(join(baselineDirectory, 'linux.status'), 'utf8')
      if (status.trim() !== 'verified-on-linux') {
        throw new Error('Linux render baselines have not been generated on Linux')
      }
    }
    const fixtures = baselineFixtures()
    const renderer = new TakumiMaiRenderer(new TakumiRenderService({ timeoutMs: 120_000 }), data)
    const outputs = new Map<string, Buffer>([
      ['rating', await renderer.renderRating(fixtures.rating)],
      ['score', await renderer.renderScore(fixtures.score)],
      ['level', await renderer.renderLevel(fixtures.level)],
      ['course-1', await renderer.renderCourse(fixtures.courses[0])],
      ['course-2', await renderer.renderCourse(fixtures.courses[1])],
      ['course-3', await renderer.renderCourse(fixtures.courses[2])],
      ['radar', await renderer.renderRadar(fixtures.radar)],
    ])
    await mkdir(baselineDirectory, { recursive: true })

    for (const [name, output] of outputs) {
      const metadata = await sharp(output).metadata()
      await expectNonBlankPng(output, metadata.width!, metadata.height!)
      const baselinePath = join(baselineDirectory, `${name}.${update ? updatePlatform : platform}.png`)
      if (update) {
        await writeFile(baselinePath, output)
        continue
      }
      const baseline = await readFile(baselinePath)
      expect(await changedPixelRatio(output, baseline), name).toBeLessThanOrEqual(0.005)
    }
    if (update && updatePlatform === 'linux') {
      await writeFile(join(baselineDirectory, 'linux.status'), 'verified-on-linux\n')
    }
  }, 180_000)
})
