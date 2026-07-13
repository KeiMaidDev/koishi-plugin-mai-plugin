import type { MaimaiDataStore } from '../data/sync-service'
import type { ChartInfo, GameVersion, RecordEntry } from '../domain/music'

export enum FilterType {
  Achievement = 'achievement',
  Combo = 'combo',
  Sync = 'sync',
  Star = 'star',
  Difficulty = 'difficulty',
  Level = 'level',
  Designer = 'designer',
  Genre = 'genre',
  Version = 'version',
  Type = 'type',
  Plate = 'plate',
  Tag = 'tag',
  Sort = 'sort',
  Modification = 'modification',
  Limit = 'limit',
  Default = 'default',
}

export type ComboSortValue = number | string

export const defaultChartFilter = (_chart: ChartInfo) => true
export const defaultRecordFilter = (_record: RecordEntry) => true
export const defaultRecordSort = (record: RecordEntry) => -record.rating

export interface ComboFilter {
  id: string
  type: FilterType
  chart: (chart: ChartInfo) => boolean
  record: (record: RecordEntry) => boolean
  sortBy: (record: RecordEntry) => ComboSortValue
  nowVersion?: GameVersion
  modifier?: (record: RecordEntry) => void
  disable15?: boolean
  name?: string
  fitLevelValue?: boolean
  singleChart?: boolean
}

export interface ComboTag {
  name: string
  aliases: string[]
  musics: number[]
}

export type ComboDesignerMap = Readonly<Record<string, readonly string[]>>

export interface ComboDesignerConfig {
  aliases: ComboDesignerMap
  includes: ComboDesignerMap
  collabs: ComboDesignerMap
}

export interface ComboQueryOptions {
  data?: MaimaiDataStore
  designerConfig?: ComboDesignerConfig
  random?: () => number
  tags?: ComboTag[]
}

export interface KeywordRule {
  aliases: string[]
  filter: ComboFilter
  order: number
}

export function createFilter(
  id: string,
  type: FilterType,
  values: Partial<Omit<ComboFilter, 'id' | 'type'>> = {},
): ComboFilter {
  return {
    id,
    type,
    chart: defaultChartFilter,
    record: defaultRecordFilter,
    sortBy: defaultRecordSort,
    ...values,
  }
}
