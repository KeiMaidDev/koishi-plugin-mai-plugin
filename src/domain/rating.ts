import { Rate, type RateName } from './enums'
import type { ChartInfo } from './music'

const newBaseRating: Record<RateName, number> = {
  d: 7,
  c: 8,
  b: 9.6,
  bb: 11.2,
  bbb: 12,
  a: 13.6,
  aa: 15.2,
  aaa: 16.8,
  s: 20,
  sp: 20.3,
  ss: 20.8,
  ssp: 21.1,
  sss: 21.6,
  sssp: 22.4,
}

const oldBaseRating: Record<RateName, number> = {
  d: 0,
  c: 5,
  b: 6,
  bb: 7,
  bbb: 7.5,
  a: 8.5,
  aa: 9.5,
  aaa: 10.5,
  s: 12.5,
  sp: 12.7,
  ss: 13,
  ssp: 13.2,
  sss: 13.5,
  sssp: 14,
}

function levelValueOf(chartOrLevel: ChartInfo | number) {
  return typeof chartOrLevel === 'number' ? chartOrLevel : chartOrLevel.levelValue
}

function cappedRating(levelValue: number, baseRating: number, achievement: number) {
  return Math.floor(levelValue * baseRating * Math.min(1_005_000, achievement) / 1_000_000)
}

export class Rating {
  static color(rating: number) {
    if (rating < 0) return 1
    if (rating >= 0 && rating < 1_000) return 1
    if (rating < 2_000) return 2
    if (rating < 4_000) return 3
    if (rating < 7_000) return 4
    if (rating < 10_000) return 5
    if (rating < 12_000) return 6
    if (rating < 13_000) return 7
    if (rating < 14_000) return 8
    if (rating < 14_500) return 9
    if (rating < 15_000) return 10
    if (rating < 20_000) return 11
    return 1
  }

  static calc(chart: ChartInfo, achievement: number): number
  static calc(levelValue: number, achievement: number): number
  static calc(chartOrLevel: ChartInfo | number, achievement: number) {
    const rate = Rate.get(achievement)
    let baseRating = newBaseRating[rate]
    if (rate === 'bbb' && achievement === 799_999) baseRating = 12.8
    if (rate === 'aaa' && achievement === 969_999) baseRating = 17.6
    if (rate === 'sp' && achievement === 989_999) baseRating = 20.6
    if (rate === 'ssp' && achievement === 999_999) baseRating = 21.4
    if (rate === 'sss' && achievement === 1_004_999) baseRating = 22.2
    return cappedRating(levelValueOf(chartOrLevel), baseRating, achievement)
  }

  static colorOld(rating: number) {
    if (rating < 0) return 1
    if (rating >= 0 && rating < 1_000) return 1
    if (rating < 2_000) return 2
    if (rating < 3_000) return 3
    if (rating < 4_000) return 4
    if (rating < 5_000) return 5
    if (rating < 6_000) return 6
    if (rating < 7_000) return 7
    if (rating < 8_000) return 8
    if (rating < 8_500) return 9
    if (rating < 20_000) return 11
    return 1
  }

  static courseOld(course: number) {
    const values = [
      0, 1_000, 1_200, 1_400, 1_500, 1_600, 1_700, 1_800,
      1_850, 1_900, 1_950, 2_000, 2_010, 2_020, 2_030, 2_040,
      2_050, 2_060, 2_070, 2_080, 2_090, 2_100, 2_100, 2_100,
    ]
    return values[course] ?? 0
  }

  static calcOld(chart: ChartInfo, achievement: number): number
  static calcOld(levelValue: number, achievement: number): number
  static calcOld(chartOrLevel: ChartInfo | number, achievement: number) {
    return cappedRating(
      levelValueOf(chartOrLevel),
      oldBaseRating[Rate.get(achievement)],
      achievement,
    )
  }
}

export class DeluxeScore {
  static stars(deluxeScore: number, maxScore: number) {
    if (maxScore <= 0 || deluxeScore > maxScore) return 0
    const percent = Math.floor(deluxeScore * 100 / maxScore)
    if (percent >= 85 && percent < 90) return 1
    if (percent >= 90 && percent < 93) return 2
    if (percent >= 93 && percent < 95) return 3
    if (percent >= 95 && percent < 97) return 4
    if (percent >= 97 && percent < 100) return 5
    return 0
  }
}
