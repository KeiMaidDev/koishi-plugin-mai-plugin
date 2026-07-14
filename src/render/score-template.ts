import type { Node } from '@takumi-rs/helpers'
import type { MaimaiDataStore } from '../data/sync-service'
import { MusicDifficulty, Rate } from '../domain/enums'
import type { ChartInfo, MusicInfo, RecordEntry } from '../domain/music'
import { DeluxeScore } from '../domain/rating'
import { resolvePackageAssetPath } from './assets'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import {
  MAIMAI_DIFFICULTY_COLORS,
  type MaimaiDifficultyName,
} from './rating-template'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const SCORE_TEMPLATE_SIZE = Object.freeze({ width: 1200, height: 1080 })

export interface ScoreRenderInput {
  music: MusicInfo
  records?: readonly RecordEntry[]
}

export interface ScoreRenderPlan {
  node: Node
  width: number
  height: number
}

const standardDifficulties = [
  MusicDifficulty.Basic,
  MusicDifficulty.Advanced,
  MusicDifficulty.Expert,
  MusicDifficulty.Master,
  MusicDifficulty.ReMaster,
] as const

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

function difficultyColor(difficulty: MusicDifficulty) {
  return MAIMAI_DIFFICULTY_COLORS[difficulty.name as MaimaiDifficultyName]
}

function scoreBadge(text: string, backgroundColor: string) {
  return createContainerNode({
    style: {
      height: 30,
      minWidth: 54,
      paddingLeft: 10,
      paddingRight: 10,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      backgroundColor,
      color: '#ffffff',
      flexShrink: 0,
    },
    children: [createTextNode({ text, style: { fontSize: 14, fontWeight: 700 } })],
  })
}

function missingDifficultyRow(difficulty: MusicDifficulty) {
  const color = difficultyColor(difficulty)
  return createContainerNode({
    className: 'score-difficulty-row',
    attributes: {
      'data-difficulty': difficulty.name,
      'data-empty': 'true',
    },
    style: {
      width: '100%',
      height: 132,
      display: 'flex',
      alignItems: 'center',
      border: '1px dashed #cbd1da',
      borderLeft: `10px solid ${color}`,
      borderRadius: 6,
      backgroundColor: '#edf0f4',
      color: '#7b8492',
      overflow: 'hidden',
    },
    children: [createTextNode({
      text: `No ${difficulty.name} chart`,
      style: { marginLeft: 26, fontSize: 22, fontWeight: 700 },
    })],
  })
}

function chartLabel(chart: ChartInfo) {
  return `${chart.difficulty.name} ${chart.level} (${chart.levelValue.toFixed(1)})`
}

function difficultyRow(chart: ChartInfo, record: RecordEntry | undefined) {
  const color = difficultyColor(chart.difficulty)
  const stars = record ? DeluxeScore.stars(record.deluxeScore, chart.maxDeluxeScore) : 0
  return createContainerNode({
    className: 'score-difficulty-row',
    attributes: {
      'data-difficulty': chart.difficulty.name,
      'data-empty': 'false',
    },
    style: {
      width: '100%',
      height: 132,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      border: '1px solid #d5dae2',
      borderLeft: `10px solid ${color}`,
      borderRadius: 6,
      backgroundColor: '#ffffff',
      overflow: 'hidden',
    },
    children: [
      createContainerNode({
        style: {
          width: 230,
          paddingLeft: 20,
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexShrink: 0,
        },
        children: [
          createTextNode({ text: chartLabel(chart), style: { fontSize: 20, fontWeight: 700, color } }),
          createTextNode({
            text: chart.notesDesigner || 'Unknown designer',
            style: {
              width: '100%',
              height: 24,
              marginTop: 8,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 14,
              color: '#657080',
            },
          }),
        ],
      }),
      createContainerNode({
        style: {
          width: 210,
          paddingLeft: 16,
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderLeft: '1px solid #e0e4ea',
          flexShrink: 0,
        },
        children: record ? [
          createTextNode({ text: Rate.toString(record.achievement), style: { fontSize: 26, fontWeight: 700 } }),
          createTextNode({ text: `Rating ${record.rating}`, style: { marginTop: 6, fontSize: 14, color: '#657080' } }),
        ] : [
          createTextNode({ text: 'Not played', style: { fontSize: 22, fontWeight: 700, color: '#8a93a0' } }),
        ],
      }),
      createContainerNode({
        style: {
          width: 282,
          paddingLeft: 16,
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderLeft: '1px solid #e0e4ea',
          flexShrink: 0,
        },
        children: record ? [
          scoreBadge(rateLabels[record.rate] ?? record.rate.toUpperCase(), '#303945'),
          scoreBadge(comboLabels[record.comboStatus.value] ?? '--', '#c3486c'),
          scoreBadge(syncLabels[record.syncStatus.value] ?? '--', '#4f6fc7'),
        ] : [scoreBadge('--', '#98a0aa')],
      }),
      createContainerNode({
        style: {
          width: 390,
          paddingLeft: 20,
          paddingRight: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderLeft: '1px solid #e0e4ea',
          overflow: 'hidden',
        },
        children: record ? [
          createTextNode({
            text: `${record.deluxeScore}/${chart.maxDeluxeScore} · ★${stars}`,
            style: { fontSize: 20, fontWeight: 700, color: '#9a621b' },
          }),
          createTextNode({
            text: chart.notesDesigner || 'Unknown designer',
            style: {
              width: '100%',
              height: 24,
              marginTop: 7,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 14,
              color: '#657080',
            },
          }),
        ] : [
          createTextNode({ text: `0/${chart.maxDeluxeScore} · ★0`, style: { fontSize: 20, color: '#8a93a0' } }),
          createTextNode({ text: chart.notesDesigner || 'Unknown designer', style: { marginTop: 7, fontSize: 14 } }),
        ],
      }),
    ],
  })
}

function musicHeader(music: MusicInfo, cover: Buffer, utageIcon?: Buffer) {
  return createContainerNode({
    id: 'score-header',
    style: {
      width: '100%',
      height: 300,
      display: 'flex',
      flexDirection: 'row',
      gap: 26,
      overflow: 'hidden',
    },
    children: [
      createImageNode({
        className: 'score-cover',
        src: cover,
        width: 280,
        height: 280,
        style: {
          width: 280,
          height: 280,
          objectFit: 'cover',
          borderRadius: 6,
          border: '1px solid #cfd5dd',
          flexShrink: 0,
        },
      }),
      createContainerNode({
        style: {
          width: 846,
          height: 280,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          overflow: 'hidden',
          borderLeft: '8px solid #00a8a8',
          backgroundColor: '#ffffff',
        },
        children: [
          createContainerNode({
            style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
            children: [
              createTextNode({ text: `ID ${music.id}`, style: { fontSize: 18, fontWeight: 700, color: '#657080' } }),
              createContainerNode({
                style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 },
                children: [
                  ...(utageIcon ? [createImageNode({
                    className: 'utage-icon',
                    src: utageIcon,
                    width: 48,
                    height: 48,
                    style: { width: 48, height: 48 },
                  })] : []),
                  scoreBadge(music.type.value, music.type.value === 'DX' ? '#137e91' : '#536170'),
                ],
              }),
            ],
          }),
          createTextNode({
            text: music.name,
            style: {
              width: '100%',
              maxHeight: 92,
              overflow: 'hidden',
              fontSize: 38,
              fontWeight: 700,
              lineHeight: 1.18,
              color: '#20242c',
            },
          }),
          createTextNode({
            text: music.artist || 'Unknown artist',
            style: {
              width: '100%',
              height: 32,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 20,
              color: '#556171',
            },
          }),
          createContainerNode({
            style: { display: 'flex', flexDirection: 'row', gap: 12, alignItems: 'center', overflow: 'hidden' },
            children: [
              scoreBadge(`BPM ${music.bpm}`, '#303945'),
              scoreBadge(music.genre.genreName, '#7c4d91'),
              scoreBadge(music.version.name, '#8c5a24'),
            ],
          }),
        ],
      }),
    ],
  })
}

export async function createScoreRenderPlan(
  input: ScoreRenderInput,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
): Promise<ScoreRenderPlan> {
  const fallbackCover = resolvePackageAssetPath('fallback/cover.png')
  const fallbackAvatar = resolvePackageAssetPath('fallback/avatar.png')
  const utageChart = input.music.charts.find(entry => entry.difficulty === MusicDifficulty.Utage)
  const [cover, utageIcon] = await Promise.all([
    renderService.loadAsset(data.coverPath(input.music.resourceId), fallbackCover),
    utageChart
      ? renderService.loadAsset(resolvePackageAssetPath('generated/utage-icon.png'), fallbackAvatar)
      : Promise.resolve(undefined),
  ])
  const rows = utageChart
    ? [difficultyRow(
        utageChart,
        input.records?.find(entry => entry.music.id === input.music.id
          && entry.chart.difficulty === MusicDifficulty.Utage),
      )]
    : standardDifficulties.map(difficulty => {
        const chart = input.music.charts.find(entry => entry.difficulty === difficulty)
        if (!chart) return missingDifficultyRow(difficulty)
        const record = input.records?.find(entry => entry.music.id === input.music.id
          && entry.chart.difficulty === difficulty)
        return difficultyRow(chart, record)
      })

  return {
    width: SCORE_TEMPLATE_SIZE.width,
    height: SCORE_TEMPLATE_SIZE.height,
    node: createContainerNode({
      id: 'score-template',
      style: {
        width: SCORE_TEMPLATE_SIZE.width,
        height: SCORE_TEMPLATE_SIZE.height,
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
        musicHeader(input.music, cover, utageIcon),
        createContainerNode({
          id: 'score-difficulty-list',
          style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10 },
          children: rows,
        }),
      ],
    }),
  }
}
