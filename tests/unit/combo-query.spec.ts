import { describe, expect, it } from 'vitest'
import { MaimaiDataStore } from '../../src/data/sync-service'
import { MusicDifficulty, MusicGenre, MusicType, ComboStatus, SyncStatus } from '../../src/domain/enums'
import { ChartInfo, MusicInfo, Notes, RecordEntry, type GameVersion } from '../../src/domain/music'
import { parseComboQuery } from '../../src/query/combo-parser'
import { createDesignerFilter } from '../../src/query/combo-rules'
import { filterCharts, filterMusics, filterRecords } from '../../src/query/combo-executor'
import { FilterType, type ComboDesignerConfig } from '../../src/query/filter-types'

const oldVersion: GameVersion = { id: 1, name: 'maimai ORANGE', version: 19_900 }
const dxVersion: GameVersion = { id: 2, name: '舞萌DX 2024', version: 21_000 }
const newestVersion: GameVersion = { id: 3, name: '舞萌DX 2025', version: 22_000 }

function chart(
  music: MusicInfo,
  difficulty: MusicDifficulty,
  level: string,
  levelValue: number,
  designer: string,
) {
  return new ChartInfo(music, difficulty, level, levelValue, new Notes(100, 20, 10, 5, 5), designer)
}

function music(
  id: number,
  name: string,
  type: MusicType,
  genre: MusicGenre,
  version: GameVersion,
  chartValues: Array<[MusicDifficulty, string, number, string]>,
) {
  const result = new MusicInfo(id, name, type, '', 'Artist', genre, 180, version, version === newestVersion)
  result.charts = chartValues.map(value => chart(result, ...value))
  return result
}

const general = music(123, '大将之歌', MusicType.Standard, MusicGenre.Original, oldVersion, [
  [MusicDifficulty.Basic, '10', 10.0, 'mai-Star'],
  [MusicDifficulty.Expert, '13+', 13.7, '翠楼屋'],
  [MusicDifficulty.ReMaster, '14', 14.4, '合作谱师'],
])
const deluxe = music(456, '舞萌DX Song', MusicType.Deluxe, MusicGenre.Touhou, dxVersion, [
  [MusicDifficulty.Expert, '13', 13.4, '翠楼屋'],
  [MusicDifficulty.Master, '14+', 14.8, 'Jack'],
])
const newest = music(654, 'Newest Track', MusicType.Deluxe, MusicGenre.Niconico, newestVersion, [
  [MusicDifficulty.Master, '15', 15.0, 'Jack'],
])
const utage = music(789, '宴会場', MusicType.Deluxe, MusicGenre.Utage, newestVersion, [
  [MusicDifficulty.Utage, '宴', 0, '-'],
])

const data = new MaimaiDataStore({
  revision: 'combo-query-test',
  versions: new Map([
    [oldVersion.name, oldVersion],
    [dxVersion.name, dxVersion],
    [newestVersion.name, newestVersion],
  ]),
  musics: new Map([general, deluxe, newest, utage].map(item => [item.id, item])),
  plates: new Map([
    [1, { id: 1, filename: '', name: '真極', genre: '実績', hint: '', requires: [123], remasters: [] }],
    [2, { id: 2, filename: '', name: '覇者', genre: '実績', hint: '', requires: [123], remasters: [] }],
  ]),
  icons: new Map(),
  courses: new Map(),
}, {
  schemaVersion: 1,
  revision: 'combo-query-test',
  generatedAt: '2026-07-13T00:00:00.000Z',
  files: {},
}, new Map())

function parse(command: string, random: () => number = Math.random) {
  return parseComboQuery(command, { data, random })
}

function record(
  source: MusicInfo,
  difficulty: MusicDifficulty,
  achievement: number,
  comboStatus = ComboStatus.None,
  syncStatus = SyncStatus.None,
  deluxeScore = 0,
) {
  const selected = source.charts.find(item => item.difficulty === difficulty)!
  return new RecordEntry(
    source,
    selected,
    achievement,
    comboStatus,
    syncStatus,
    deluxeScore,
    achievement >= 1_005_000 ? 'sssp' : achievement >= 1_000_000 ? 'sss' : achievement >= 995_000 ? 'ssp' : 'aaa',
    Math.floor(selected.levelValue * achievement / 10_000),
  )
}

describe('combo query parser and executors', () => {
  it('normalizes DBC/fullwidth text, punctuation, case, and traditional Chinese', () => {
    const filters = parse('ＦＣ，紅譜。ＤＸ譜')!

    expect(filters.map(filter => filter.name ?? filter.id)).toEqual(expect.arrayContaining(['fc', 'difficulty:Expert', 'type:dx']))
  })

  it('consumes long rank keywords before overlapping short keywords', () => {
    const filters = parse('大將')!

    expect(filters.map(filter => filter.id)).toContain('rate:ge:sssp')
    expect(filters.map(filter => filter.id)).not.toContain('rate:ge:sss')
  })

  it('ports FC/AP and FS/FSD status rules', () => {
    const records = [
      record(general, MusicDifficulty.Basic, 1_000_000, ComboStatus.FullCombo),
      record(deluxe, MusicDifficulty.Expert, 1_005_000, ComboStatus.AllPerfectPlus, SyncStatus.FullSyncDeluxePlus),
      record(newest, MusicDifficulty.Master, 1_000_000, ComboStatus.None, SyncStatus.FullSyncDeluxe),
    ]

    expect(filterRecords(parse('全连'), records)?.map(item => item.music.id)).toEqual([456, 123])
    expect(filterRecords(parse('理论'), records)?.map(item => item.music.id)).toEqual([456])
    expect(filterRecords(parse('舞舞'), records)?.map(item => item.music.id)).toEqual([654, 456])
    expect(filterRecords(parse('fsd+'), records)?.map(item => item.music.id)).toEqual([456])
  })

  it('ports exact and threshold rank rules', () => {
    const records = [
      record(general, MusicDifficulty.Basic, 1_004_000),
      record(deluxe, MusicDifficulty.Expert, 1_006_000),
      record(newest, MusicDifficulty.Master, 1_000_000),
    ]

    expect(filterRecords(parse('大将'), records)?.map(item => item.music.id)).toEqual([456])
    expect(filterRecords(parse('纯鸟'), records)?.map(item => item.music.id)).toEqual([654, 123])
  })

  it('ports exact percentage and fitted achievement rules', () => {
    const records = [
      record(general, MusicDifficulty.Basic, 1_005_000),
      record(deluxe, MusicDifficulty.Expert, 1_004_500),
      record(newest, MusicDifficulty.Master, 999_500),
    ]

    expect(filterRecords(parse('100.5000％'), records)?.map(item => item.music.id)).toEqual([123])
    expect(filterRecords(parse('寸'), records)?.map(item => item.music.id)).toEqual([654, 456])
    expect(filterRecords(parse('锁血'), records)?.map(item => item.music.id)).toEqual([123])
  })

  it('uses fitted constants for rating sort without duplicating the overlapping keyword', () => {
    general.charts[0].fitLevelValue = 15
    deluxe.charts[0].fitLevelValue = 13
    const filters = parse('拟合定数')!
    const records = [
      record(general, MusicDifficulty.Basic, 1_005_000),
      record(deluxe, MusicDifficulty.Expert, 1_005_000),
    ]

    expect(filters.filter(filter => filter.type === FilterType.Modification)).toHaveLength(1)
    expect(filters.some(filter => filter.fitLevelValue)).toBe(true)
    expect(filterRecords(filters, records)?.map(item => item.music.id)).toEqual([123, 456])
  })

  it('filters old frame, DX frame, old versions, and newest version', () => {
    expect(filterMusics(parse('旧框'), data.musics.values()).map(item => item.id)).toEqual([123])
    expect(filterMusics(parse('dx'), data.musics.values()).map(item => item.id)).toEqual([456, 654])
    expect(filterMusics(parse('旧版本'), data.musics.values()).map(item => item.id)).toEqual([123, 456])
    expect(filterMusics(parse('新歌'), data.musics.values()).map(item => item.id)).toEqual([654])
  })

  it('ports difficulty, level, fitted constant, and chart selection rules', () => {
    expect(filterCharts(parse('红谱'), data.musics.values()).map(item => item.music.id)).toEqual([123, 456])
    expect(filterCharts(parse('13+'), data.musics.values()).map(item => item.music.id)).toEqual([123])
    expect(filterCharts(parse('13.4'), data.musics.values()).map(item => item.music.id)).toEqual([456])
  })

  it('ports standard and deluxe chart type rules', () => {
    expect(filterMusics(parse('标准'), data.musics.values()).map(item => item.id)).toEqual([123])
    expect(filterMusics(parse('dx谱'), data.musics.values()).map(item => item.id)).toEqual([456, 654])
  })

  it('ports genre, star, and designer rules', () => {
    const starRecord = record(deluxe, MusicDifficulty.Expert, 1_000_000, ComboStatus.None, SyncStatus.None, 410)

    expect(filterMusics(parse('东方'), data.musics.values()).map(item => item.id)).toEqual([456])
    expect(filterRecords(parse('五星'), [starRecord])?.map(item => item.music.id)).toEqual([456])
    expect(filterCharts(parse('翠楼屋'), data.musics.values()).map(item => item.music.id)).toEqual([123, 456])
  })

  it('ports configured designer aliases and inclusion mappings', () => {
    const designerConfig: ComboDesignerConfig = {
      aliases: { 'mai-Star': ['mai星'] },
      includes: { 'mai-Star': ['合作谱师'] },
      collabs: {},
    }
    const filters = parseComboQuery('mai星', { data, designerConfig })

    expect(filterCharts(filters, data.musics.values()).map(item => [item.music.id, item.difficulty.name])).toEqual([
      [123, 'Basic'],
      [123, 'ReMaster'],
    ])
  })

  it('ports collaboration charts configured by the main designer name', () => {
    const designerConfig: ComboDesignerConfig = {
      aliases: { 翠楼屋: ['绿楼'] },
      includes: {},
      collabs: { 翠楼屋: ['654#3'] },
    }
    const filters = parseComboQuery('绿楼', { data, designerConfig })

    expect(filterCharts(filters, data.musics.values()).map(item => [item.music.id, item.difficulty.name])).toEqual([
      [123, 'Expert'],
      [456, 'Expert'],
      [654, 'Master'],
    ])
  })

  it('ports collaboration charts configured by the invoked designer alias', () => {
    const designerConfig: ComboDesignerConfig = {
      aliases: { 翠楼屋: ['合作别名'] },
      includes: {},
      collabs: { 合作别名: ['456#3'] },
    }
    const filters = [createDesignerFilter('合作别名', designerConfig)]

    expect(filterCharts(filters, data.musics.values()).map(item => [item.music.id, item.difficulty.name])).toEqual([
      [123, 'Expert'],
      [456, 'Expert'],
      [456, 'Master'],
    ])
  })

  it('rejects configured collaboration charts with unknown difficulties', () => {
    const designerConfig: ComboDesignerConfig = {
      aliases: {},
      includes: {},
      collabs: { 翠楼屋: ['654#9'] },
    }

    expect(() => createDesignerFilter('翠楼屋', designerConfig)).toThrow('Unknown music difficulty: 9')
  })

  it('ports simplified plate names and plate record requirements', () => {
    const records = [
      record(general, MusicDifficulty.Basic, 1_000_000, ComboStatus.FullCombo),
      record(general, MusicDifficulty.ReMaster, 1_000_000, ComboStatus.FullCombo),
      record(deluxe, MusicDifficulty.Expert, 799_999),
      record(deluxe, MusicDifficulty.Master, 800_000),
    ]

    expect(filterCharts(parse('真极'), data.musics.values()).map(item => [item.music.id, item.difficulty.name])).toEqual([[123, 'Basic'], [123, 'Expert']])
    expect(filterRecords(parse('霸者'), records)?.map(item => item.chart.difficulty.name)).toEqual(['Basic'])
  })

  it('makes random sorting deterministic per record and injected RNG', () => {
    const values = [0.7, 0.1, 0.4]
    const filters = parse('随机', () => values.shift() ?? 0)
    const records = [
      record(general, MusicDifficulty.Basic, 1_000_000),
      record(deluxe, MusicDifficulty.Expert, 1_000_000),
      record(newest, MusicDifficulty.Master, 1_000_000),
    ]

    expect(filterRecords(filters, records)?.map(item => item.music.id)).toEqual([456, 123, 654])
    expect(filterRecords(filters, records)?.map(item => item.music.id)).toEqual([456, 123, 654])
  })

  it('groups same-type filters with OR and different types with AND', () => {
    const selected = filterCharts(parse('红谱 紫谱 dx谱'), data.musics.values())

    expect(selected.map(item => [item.music.id, item.difficulty.name])).toEqual([
      [456, 'Expert'],
      [456, 'Master'],
      [654, 'Master'],
    ])
  })

  it('excludes Utage by default and includes it only for an explicit Utage query', () => {
    expect(filterMusics(parse('dx谱'), data.musics.values()).map(item => item.id)).not.toContain(789)
    expect(filterMusics(parse('宴谱'), data.musics.values()).map(item => item.id)).toEqual([789])
  })

  it('returns null for empty or unrecognized broad commands', () => {
    expect(parse('')).toBeNull()
    expect(parse('有什么歌')).toBeNull()
  })
})
