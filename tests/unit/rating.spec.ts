import { describe, expect, it } from 'vitest'
import { ComboStatus, MusicDifficulty, MusicGenre, MusicType, Rate, SyncStatus } from '../../src/domain/enums'
import { ChartInfo, MusicInfo, Notes } from '../../src/domain/music'
import { DeluxeScore, Rating } from '../../src/domain/rating'

const chart = new ChartInfo(
  new MusicInfo(10001, 'DX Song', MusicType.Deluxe, '', 'Artist', MusicGenre.Original, 180, { id: 1, name: 'Version', version: 1 }, true),
  MusicDifficulty.Master,
  '14',
  14,
  new Notes(),
  'Designer',
)

describe('Rate', () => {
  it.each([
    [0, 'd'],
    [499999, 'd'],
    [500000, 'c'],
    [599999, 'c'],
    [600000, 'b'],
    [699999, 'b'],
    [700000, 'bb'],
    [749999, 'bb'],
    [750000, 'bbb'],
    [799999, 'bbb'],
    [800000, 'a'],
    [899999, 'a'],
    [900000, 'aa'],
    [939999, 'aa'],
    [940000, 'aaa'],
    [969999, 'aaa'],
    [970000, 's'],
    [979999, 's'],
    [980000, 'sp'],
    [989999, 'sp'],
    [990000, 'ss'],
    [994999, 'ss'],
    [995000, 'ssp'],
    [999999, 'ssp'],
    [1000000, 'sss'],
    [1004999, 'sss'],
    [1005000, 'sssp'],
    [1010000, 'sssp'],
  ])('classifies achievement %i as %s', (achievement, expected) => {
    expect(Rate.get(achievement)).toBe(expected)
  })

  it('keeps the Kotlin ordering and formatted internal achievement unit', () => {
    expect(Rate.floor('sp')).toBe(980000)
    expect(Rate.floor('unknown')).toBe(0)
    expect(Rate.greater('sss', 'ssp')).toBe(true)
    expect(Rate.greater(980001, 'sp')).toBe(true)
    expect(Rate.greaterEqual(980000, 'sp')).toBe(true)
    expect(Rate.next('sssp')).toBe('sssp')
    expect(Rate.next('ssp')).toBe('sss')
    expect(Rate.toString(1005000)).toBe('100.5000%')
    expect(Rate.get(1010001)).toBe('d')
  })
})

describe('Rating', () => {
  it('uses the Kotlin fallback color outside defined ranges', () => {
    expect(Rating.color(-1)).toBe(1)
    expect(Rating.colorOld(-1)).toBe(1)
    expect(Rating.color(20000)).toBe(1)
    expect(Rating.colorOld(20000)).toBe(1)
  })

  it.each([
    [0, 0],
    [799999, 143],
    [800000, 152],
    [969999, 239],
    [970000, 271],
    [989999, 285],
    [990000, 288],
    [999999, 299],
    [1000000, 302],
    [1004999, 312],
    [1005000, 315],
    [1010000, 315],
  ])('calculates new rating at achievement %i', (achievement, expected) => {
    expect(Rating.calc(chart, achievement)).toBe(expected)
  })

  it.each([
    [0, 0],
    [799999, 83],
    [800000, 95],
    [1005000, 196],
  ])('calculates old rating at achievement %i', (achievement, expected) => {
    expect(Rating.calcOld(chart, achievement)).toBe(expected)
  })

  it.each([
    [0, 0],
    [1, 1000],
    [8, 1850],
    [21, 2100],
    [23, 2100],
    [24, 0],
  ])('returns old course bonus %i as %i', (course, expected) => {
    expect(Rating.courseOld(course)).toBe(expected)
  })

  it('matches Kotlin ratings for every record in a varied B35 plus B15 fixture', () => {
    const oldRecords = [
      [1, 0, 0],
      [2, 500000, 8],
      [3, 600000, 17],
      [4, 700000, 31],
      [5, 750000, 45],
      [6, 799999, 61],
      [7, 800000, 76],
      [8, 900000, 109],
      [9, 940000, 142],
      [10, 969999, 170],
      [10.5, 970000, 203],
      [11, 980000, 218],
      [11.5, 989999, 234],
      [12, 990000, 247],
      [12.5, 995000, 262],
      [13, 999999, 278],
      [13.5, 1000000, 291],
      [14, 1004999, 312],
      [14.5, 1005000, 326],
      [15, 1010000, 337],
      [15.5, 850000, 179],
      [16, 925000, 224],
      [16.5, 965000, 267],
      [17, 975000, 331],
      [17.5, 985000, 349],
      [18, 992000, 371],
      [18.5, 997000, 389],
      [19, 1002000, 411],
      [19.5, 1007000, 438],
      [20, 1010000, 450],
      [20.5, 400000, 57],
      [21, 699999, 141],
      [21.5, 749999, 180],
      [22, 899999, 269],
      [22.5, 939999, 321],
    ] as const
    const newRecords = [
      [1.5, 0, 0],
      [2.25, 500000, 9],
      [3.5, 600000, 20],
      [4.75, 700000, 37],
      [5.25, 750000, 47],
      [6.5, 799999, 66],
      [7.25, 800000, 78],
      [8.5, 900000, 116],
      [9.25, 940000, 146],
      [10.75, 969999, 183],
      [11.25, 970000, 218],
      [11.75, 989999, 239],
      [12.25, 999999, 262],
      [13.5, 1004999, 301],
      [14, 1005000, 315],
    ] as const

    const calculate = (records: readonly (readonly [number, number, number])[]) =>
      records.map(([level, achievement, expected]) => ({
        actual: Rating.calc(level, achievement),
        expected,
      }))
    const oldRatings = calculate(oldRecords)
    const newRatings = calculate(newRecords)

    expect(oldRatings).toHaveLength(35)
    expect(newRatings).toHaveLength(15)
    oldRatings.forEach(({ actual, expected }) => expect(actual).toBe(expected))
    newRatings.forEach(({ actual, expected }) => expect(actual).toBe(expected))
    expect(oldRatings.reduce((total, { actual }) => total + actual, 0)).toBe(7744)
    expect(newRatings.reduce((total, { actual }) => total + actual, 0)).toBe(2037)
    expect([...oldRatings, ...newRatings].reduce((total, { actual }) => total + actual, 0)).toBe(9781)
  })
})

describe('status predicates', () => {
  it('recognizes full combo and all perfect states', () => {
    expect(ComboStatus.of('fc').isFC()).toBe(true)
    expect(ComboStatus.of('ap').isAP()).toBe(true)
    expect(ComboStatus.of('app').isFC()).toBe(true)
    expect(ComboStatus.of('fc').isAP()).toBe(false)
    expect(ComboStatus.of('unknown')).toBe(ComboStatus.None)
  })

  it('recognizes full sync variants but not plain sync', () => {
    expect(SyncStatus.of('fs').isFS()).toBe(true)
    expect(SyncStatus.of('fsd').isFSD()).toBe(true)
    expect(SyncStatus.of('fsdp').isFS()).toBe(true)
    expect(SyncStatus.of('fsp').isFSD()).toBe(false)
    expect(SyncStatus.of('sync').isFS()).toBe(false)
  })
})

describe('DeluxeScore', () => {
  it.each([
    [0, 0],
    [84, 0],
    [85, 1],
    [89, 1],
    [90, 2],
    [92, 2],
    [93, 3],
    [94, 3],
    [95, 4],
    [96, 4],
    [97, 5],
    [99, 5],
    [100, 0],
    [101, 0],
  ])('returns %i stars for a score of %i/100', (score, expected) => {
    expect(DeluxeScore.stars(score, 100)).toBe(expected)
  })

  it('returns zero when no maximum score exists', () => {
    expect(DeluxeScore.stars(1, 0)).toBe(0)
  })
})
