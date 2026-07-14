import type { Node } from '@takumi-rs/helpers'
import type { MaimaiDataStore } from '../data/sync-service'
import { MusicDifficulty } from '../domain/enums'
import type { ChartInfo, RecordEntry } from '../domain/music'
import { resolvePackageAssetPath } from './assets'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import {
  MAIMAI_DIFFICULTY_COLORS,
  type MaimaiDifficultyName,
} from './rating-template'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const LEVEL_TEMPLATE_WIDTH = 1280
export const LEVEL_TEMPLATE_MIN_HEIGHT = 720

export type LevelRequirement = 'achievement' | 'combo' | 'sync'

export interface LevelChartGroup {
  label: string
  charts: readonly ChartInfo[]
}

export interface LevelProgressValue {
  completed: number
  total: number
}

export interface LevelRenderInput {
  title: string
  groups: readonly LevelChartGroup[]
  records?: readonly RecordEntry[]
  requirement?: LevelRequirement
  showProgress?: boolean
  progress?: Partial<Record<MaimaiDifficultyName, LevelProgressValue>>
}

export interface LevelRenderPlan {
  node: Node
  width: number
  height: number
}

const rateLabels: Record<string, string> = {
  sssp: 'SSS+', sss: 'SSS', ssp: 'SS+', ss: 'SS', sp: 'S+', s: 'S',
  aaa: 'AAA', aa: 'AA', a: 'A', bbb: 'BBB', bb: 'BB', b: 'B', c: 'C', d: 'D',
}

const comboLabels: Record<string, string> = {
  none: '--', fc: 'FC', fcp: 'FC+', ap: 'AP', app: 'AP+',
}

const syncLabels: Record<string, string> = {
  none: '--', fs: 'FS', fsp: 'FS+', fsd: 'FSD', fsdp: 'FSD+', sync: 'SYNC',
}

function difficultyColor(chart: ChartInfo) {
  return MAIMAI_DIFFICULTY_COLORS[chart.difficulty.name as MaimaiDifficultyName]
}

function recordFor(chart: ChartInfo, records: readonly RecordEntry[] | undefined) {
  return records?.find(record =>
    record.music.id === chart.music.id
    && record.chart.difficulty === chart.difficulty,
  )
}

function completionLabel(record: RecordEntry | undefined, requirement: LevelRequirement) {
  if (!record) return '--'
  if (requirement === 'combo') {
    return record.comboStatus.isFC() ? comboLabels[record.comboStatus.value] ?? '--' : '--'
  }
  if (requirement === 'sync') {
    return record.syncStatus.isFS() ? syncLabels[record.syncStatus.value] ?? '--' : '--'
  }
  return record.achievement >= 800_000 ? rateLabels[record.rate] ?? record.rate.toUpperCase() : '--'
}

function levelStatus(text: string) {
  const complete = text !== '--'
  return createContainerNode({
    className: 'level-status-icon',
    attributes: { 'data-complete': String(complete) },
    style: {
      width: 54,
      height: 25,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      backgroundColor: complete ? '#26313e' : '#a7aeb8',
      color: '#ffffff',
    },
    children: [createTextNode({ text, style: { fontSize: 11, fontWeight: 700 } })],
  })
}

async function levelTile(
  chart: ChartInfo,
  requirement: LevelRequirement,
  records: readonly RecordEntry[] | undefined,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const cover = await renderService.loadAsset(
    data.coverPath(chart.music.resourceId, true),
    resolvePackageAssetPath('fallback/cover.png'),
  )
  const color = difficultyColor(chart)
  const completion = completionLabel(recordFor(chart, records), requirement)
  return createContainerNode({
    className: 'level-chart-tile',
    attributes: {
      'data-difficulty': chart.difficulty.name,
      'data-music-id': String(chart.music.id),
    },
    style: {
      width: 142,
      height: 104,
      padding: 4,
      display: 'flex',
      flexDirection: 'row',
      gap: 6,
      overflow: 'hidden',
      borderRadius: 5,
      backgroundColor: color,
      flexShrink: 0,
    },
    children: [
      createImageNode({
        className: 'level-cover',
        src: cover,
        width: 72,
        height: 72,
        style: {
          width: 72,
          height: 72,
          marginTop: 12,
          objectFit: 'cover',
          borderRadius: 3,
          flexShrink: 0,
        },
      }),
      createContainerNode({
        style: {
          width: 56,
          height: 96,
          paddingTop: 7,
          paddingBottom: 7,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderRadius: 3,
          backgroundColor: 'rgba(255,255,255,0.94)',
          overflow: 'hidden',
        },
        children: [
          createTextNode({
            text: `ID ${chart.music.id}`,
            style: {
              width: 52,
              height: 17,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              fontSize: 9,
              fontWeight: 700,
              color: '#394453',
            },
          }),
          createTextNode({
            text: chart.music.type.value,
            style: { fontSize: 12, fontWeight: 700, color: '#137e91' },
          }),
          createTextNode({
            text: chart.level,
            style: { fontSize: 15, fontWeight: 700, color },
          }),
          levelStatus(completion),
        ],
      }),
    ],
  })
}

function progressDifficulties(groups: readonly LevelChartGroup[]) {
  const hasReMaster = groups.some(group =>
    group.charts.some(chart => chart.difficulty === MusicDifficulty.ReMaster),
  )
  return hasReMaster
    ? standardProgressDifficulties
    : standardProgressDifficulties.slice(0, 4)
}

const standardProgressDifficulties = [
  MusicDifficulty.Basic,
  MusicDifficulty.Advanced,
  MusicDifficulty.Expert,
  MusicDifficulty.Master,
  MusicDifficulty.ReMaster,
] as const

function progressItem(
  difficulty: MusicDifficulty,
  value: LevelProgressValue | undefined,
) {
  const total = Math.max(0, Math.trunc(value?.total ?? 0))
  const completed = Math.min(total, Math.max(0, Math.trunc(value?.completed ?? 0)))
  const ratio = total ? completed / total : 0
  const color = MAIMAI_DIFFICULTY_COLORS[difficulty.name as MaimaiDifficultyName]
  return createContainerNode({
    className: 'level-progress-item',
    attributes: { 'data-difficulty': difficulty.name },
    style: {
      height: 58,
      flex: 1,
      minWidth: 0,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 6,
      overflow: 'hidden',
    },
    children: [
      createContainerNode({
        style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        children: [
          createTextNode({ text: difficulty.name, style: { fontSize: 13, fontWeight: 700, color } }),
          createTextNode({ text: `${completed}/${total}`, style: { fontSize: 13, fontWeight: 700, color: '#3e4957' } }),
        ],
      }),
      createContainerNode({
        style: {
          width: '100%',
          height: 12,
          overflow: 'hidden',
          borderRadius: 3,
          backgroundColor: '#dfe4ea',
        },
        children: [createContainerNode({
          className: 'level-progress-fill',
          style: { width: `${(ratio * 100).toFixed(2)}%`, height: '100%', backgroundColor: color },
        })],
      }),
    ],
  })
}

function levelHeader(input: LevelRenderInput) {
  const difficulties = progressDifficulties(input.groups)
  return createContainerNode({
    id: 'level-header',
    style: {
      width: '100%',
      height: input.showProgress ? 150 : 82,
      paddingLeft: 22,
      paddingRight: 22,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 12,
      overflow: 'hidden',
      borderLeft: '8px solid #00a8a8',
      backgroundColor: '#ffffff',
    },
    children: [
      createTextNode({
        text: input.title,
        style: {
          width: '100%',
          height: 38,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 27,
          fontWeight: 700,
        },
      }),
      ...(input.showProgress ? [createContainerNode({
        id: 'level-progress',
        style: { width: '100%', height: 58, display: 'flex', flexDirection: 'row', gap: 18 },
        children: difficulties.map(difficulty => progressItem(
          difficulty,
          input.progress?.[difficulty.name as MaimaiDifficultyName],
        )),
      })] : []),
    ],
  })
}

async function levelGroup(
  group: LevelChartGroup,
  requirement: LevelRequirement,
  records: readonly RecordEntry[] | undefined,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const tiles = await Promise.all(group.charts.map(chart =>
    levelTile(chart, requirement, records, renderService, data),
  ))
  const rowCount = Math.max(1, Math.ceil(group.charts.length / 8))
  return createContainerNode({
    className: 'level-group',
    attributes: { 'data-level': group.label, 'data-rows': String(rowCount) },
    style: {
      width: '100%',
      height: 42 + rowCount * 104 + (rowCount - 1) * 10,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      overflow: 'hidden',
    },
    children: [
      createContainerNode({
        style: { height: 34, display: 'flex', alignItems: 'center', borderBottom: '2px solid #cfd5dd' },
        children: [createTextNode({
          text: group.label,
          style: { fontSize: 22, fontWeight: 700, color: '#303b49' },
        })],
      }),
      createContainerNode({
        className: 'level-group-grid',
        style: {
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          alignContent: 'flex-start',
        },
        children: tiles,
      }),
    ],
  })
}

export async function createLevelRenderPlan(
  input: LevelRenderInput,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
): Promise<LevelRenderPlan> {
  const requirement = input.requirement ?? 'achievement'
  const groups = await Promise.all(input.groups.map(group =>
    levelGroup(group, requirement, input.records, renderService, data),
  ))
  const headerHeight = input.showProgress ? 150 : 82
  const groupsHeight = input.groups.reduce((sum, group) => {
    const rows = Math.max(1, Math.ceil(group.charts.length / 8))
    return sum + 42 + rows * 104 + (rows - 1) * 10
  }, 0)
  const height = Math.max(
    LEVEL_TEMPLATE_MIN_HEIGHT,
    48 + headerHeight + 18 + groupsHeight + Math.max(0, input.groups.length - 1) * 16,
  )

  return {
    width: LEVEL_TEMPLATE_WIDTH,
    height,
    node: createContainerNode({
      id: 'level-template',
      style: {
        width: LEVEL_TEMPLATE_WIDTH,
        height,
        padding: 24,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 18,
        backgroundColor: MAIMAI_RENDER_THEME.colors.background,
        color: MAIMAI_RENDER_THEME.colors.text,
        fontFamily: MAIMAI_RENDER_THEME.fontFamily,
      },
      children: [
        levelHeader(input),
        createContainerNode({
          id: 'level-groups',
          style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 16 },
          children: groups,
        }),
      ],
    }),
  }
}
