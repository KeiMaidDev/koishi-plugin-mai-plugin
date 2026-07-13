import type { ChartInfo, MusicInfo, RecordEntry } from '../domain/music'
import {
  defaultRecordFilter,
  defaultRecordSort,
  type ComboFilter,
  type ComboSortValue,
  type FilterType,
} from './filter-types'

function grouped(filters: readonly ComboFilter[]) {
  const result = new Map<FilterType, ComboFilter[]>()
  for (const filter of filters) {
    const group = result.get(filter.type) ?? []
    group.push(filter)
    result.set(filter.type, group)
  }
  return result
}

function compareSortValue(left: ComboSortValue, right: ComboSortValue) {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right), 'zh-CN', { numeric: true })
}

function stableSort(records: RecordEntry[], sortBy: (record: RecordEntry) => ComboSortValue) {
  return records
    .map((record, index) => ({ record, index, value: sortBy(record) }))
    .sort((left, right) => compareSortValue(left.value, right.value) || left.index - right.index)
    .map(entry => entry.record)
}

export function filterCharts(
  filters: readonly ComboFilter[] | null | undefined,
  musics: Iterable<MusicInfo>,
): ChartInfo[] {
  const charts = [...musics].flatMap(music => music.charts)
  if (!filters?.length) return charts
  const groups = grouped(filters)
  return charts.filter(chart => [...groups.values()].every(group => (
    group.some(filter => filter.chart(chart))
  )))
}

export function filterMusics(
  filters: readonly ComboFilter[] | null | undefined,
  musics: Iterable<MusicInfo>,
): MusicInfo[] {
  return [...new Set(filterCharts(filters, musics).map(chart => chart.music))]
}

export function filterRecords(
  filters: readonly ComboFilter[] | null | undefined,
  records: readonly RecordEntry[],
  required = false,
): RecordEntry[] | null {
  if (!filters) return null
  if (required && filters.every(filter => filter.record === defaultRecordFilter)) return null

  for (const filter of filters) {
    if (!filter.modifier) continue
    for (const record of records) filter.modifier(record)
  }

  const groups = grouped(filters)
  let result = records.filter(record => [...groups.values()].every(group => (
    group.some(filter => filter.chart(record.chart) && filter.record(record))
  )))
  result = stableSort([...result], defaultRecordSort)
  for (const filter of filters) {
    if (filter.sortBy !== defaultRecordSort) result = stableSort(result, filter.sortBy)
  }
  return result
}
