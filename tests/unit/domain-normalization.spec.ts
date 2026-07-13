import { describe, expect, it } from 'vitest'
import { ComboStatus, MusicDifficulty, MusicGenre, MusicType, SyncStatus } from '../../src/domain/enums'
import { ChartInfo, MusicInfo, Notes, RecordEntry, type GameVersion } from '../../src/domain/music'
import { PlayerInfo, PlayerSettings, RatingResponse, RecordsResponse } from '../../src/domain/player'
import { normalizeLxnsMusicId, toInternalAchievement, type LXNSCollection, type LXNSScore } from '../../src/domain/payloads'

describe('domain models', () => {
  it.each([
    [MusicDifficulty.Basic, 0],
    [MusicDifficulty.Advanced, 1],
    [MusicDifficulty.Expert, 2],
    [MusicDifficulty.Master, 3],
    [MusicDifficulty.ReMaster, 4],
    [MusicDifficulty.Utage, 10],
  ])('maps difficulty %s to %i', (difficulty, value) => {
    expect(difficulty.value).toBe(value)
    expect(MusicDifficulty.of(value)).toBe(difficulty)
  })

  it('maps standard and deluxe music types', () => {
    expect(MusicType.of('SD')).toBe(MusicType.Standard)
    expect(MusicType.of('DX')).toBe(MusicType.Deluxe)
    expect(MusicType.Standard.full).toBe('standard')
    expect(MusicType.Deluxe.full).toBe('dx')
  })

  it('ports Kotlin music genres and game version data', () => {
    expect(MusicGenre.values).toHaveLength(7)
    expect(MusicGenre.PopsAnime).toMatchObject({
      id: 101,
      genreName: '流行&动漫',
      value: 'POPSアニメ',
      names: ['动漫', '流行', '二次元'],
    })
    expect(MusicGenre.Niconico.value).toBe('niconicoボーカロイド')
    expect(MusicGenre.Touhou.value).toBe('東方Project')
    expect(MusicGenre.Variety.value).toBe('ゲームバラエティ')
    expect(MusicGenre.Original.value).toBe('maimai')
    expect(MusicGenre.Chugeki.value).toBe('オンゲキCHUNITHM')
    expect(MusicGenre.Utage.value).toBe('宴会場')
    expect(MusicGenre.of('maimai')).toBe(MusicGenre.Original)

    const version: GameVersion = { id: 12, name: 'maimai でらっくす', version: 14 }
    const music = new MusicInfo(1, 'Song', MusicType.Standard, '', 'Artist', MusicGenre.Original, 180, version, false)
    expect(music.genre).toBe(MusicGenre.Original)
    expect(music.version).toBe(version)
  })

  it('preserves Kotlin difficulty aliases and case-sensitive lookup', () => {
    expect(MusicDifficulty.Basic.names).toEqual(['\u7eff\u8c31', '\u7eff'])
    expect(MusicDifficulty.Basic.brief).toBe('\u7eff')
    expect(MusicDifficulty.from('\u7eff')).toBe(MusicDifficulty.Basic)
    expect(MusicDifficulty.from('asic')).toBe(MusicDifficulty.Basic)
    expect(MusicDifficulty.from('basic')).toBeUndefined()
  })

  it('calculates resource IDs and chart note totals', () => {
    const music = new MusicInfo(10001, 'DX Song', MusicType.Deluxe, '', 'Artist', MusicGenre.Original, 180, { id: 1, name: 'Version', version: 1 }, true)
    const notes = new Notes(1, 2, 3, 4, 5)
    const chart = new ChartInfo(music, MusicDifficulty.Master, '14', 14, notes, 'Designer')

    expect(music.resourceId).toBe(1)
    expect(new MusicInfo(9999, 'SD Song', MusicType.Standard, '', '', MusicGenre.Original, 0, { id: 0, name: '', version: 0 }, false).resourceId).toBe(9999)
    expect(notes.touch).toBe(4)
    expect(notes.break).toBe(5)
    expect(notes.total).toBe(15)
    expect(chart.maxDeluxeScore).toBe(45)
  })

  it('keeps record and response data in domain objects', () => {
    const music = new MusicInfo(1, 'Song', MusicType.Standard, '', 'Artist', MusicGenre.Original, 180, { id: 1, name: 'Version', version: 1 }, false)
    const chart = new ChartInfo(music, MusicDifficulty.Basic, '1', 1, new Notes(), '')
    const record = new RecordEntry(
      music,
      chart,
      1000000,
      ComboStatus.FullCombo,
      SyncStatus.FullSync,
      3,
      'sss',
      216,
    )
    const player = new PlayerInfo('Player', 12345, 8)
    const settings = new PlayerSettings(10, 20)

    expect(new RatingResponse(player, settings, [record], []).oldRatingList).toEqual([record])
    expect(new RecordsResponse(player, settings, [record]).records).toEqual([record])
    expect(record.comboStatus).toBe(ComboStatus.FullCombo)
    expect(record.syncStatus).toBe(SyncStatus.FullSync)
    expect(settings).toEqual({ avatar: 10, plate: 20 })
  })
})

describe('payload normalization', () => {
  it.each([
    [0, 0],
    [79.9999, 799999],
    [100.5, 1005000],
    [101, 1010000],
  ])('stores %s%% achievements as integer ten-thousandths', (achievement, expected) => {
    expect(toInternalAchievement(achievement)).toBe(expected)
  })

  it.each([
    [1, 'dx', 10001],
    [9999, 'dx', 19999],
    [10000, 'dx', 10000],
    [1, 'standard', 1],
    [1, 'utage', 1],
  ])('normalizes LXNS %s %s ID as %i', (id, type, expected) => {
    expect(normalizeLxnsMusicId(id, type)).toBe(expected)
  })

  it('retains LXNS payload field names', () => {
    const score: LXNSScore = {
      id: 1,
      level_index: 3,
      achievements: 100.5,
      fc: 'fc',
      fs: 'fs',
      dx_score: 100,
      type: 'dx',
    }

    expect(normalizeLxnsMusicId(score.id, score.type)).toBe(10001)
  })

  it('models LXNS collection requirements and maps completed difficulties', () => {
    const collection: LXNSCollection = {
      id: 1,
      name: 'Clear all songs',
      color: '#ffffff',
      description: 'Complete the required songs',
      genre: 'maimai',
      required: [{
        difficulties: [3, 4],
        rate: 'sss',
        fc: 'fc',
        fs: 'fs',
        completed: false,
        songs: [{
          id: 100,
          title: 'Song',
          type: 'dx',
          completed: true,
          completed_difficulties: [3],
        }],
      }],
    }

    expect(collection.required?.[0].songs?.[0].completed_difficulties).toEqual([3])
  })
})
