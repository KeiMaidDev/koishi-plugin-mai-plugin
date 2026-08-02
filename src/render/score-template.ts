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
      height: 28,
      minWidth: 50,
      paddingLeft: 9,
      paddingRight: 9,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 3,
      backgroundColor,
      color: '#ffffff',
      flexShrink: 0,
    },
    children: [createTextNode({ text, style: { fontSize: 13, fontWeight: 700 } })],
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
      height: 198,
      display: 'flex',
      alignItems: 'center',
      border: `1px dashed ${MAIMAI_RENDER_THEME.colors.line}`,
      borderLeft: `10px solid ${color}`,
      backgroundColor: '#eaf0f4',
      color: MAIMAI_RENDER_THEME.colors.mutedText,
      overflow: 'hidden',
    },
    children: [createTextNode({
      text: `No ${difficulty.name} chart`,
      style: { marginLeft: 26, fontSize: 21, fontWeight: 700 },
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
      height: 198,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'stretch',
      border: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
      borderLeft: `10px solid ${color}`,
      backgroundColor: MAIMAI_RENDER_THEME.colors.surface,
      overflow: 'hidden',
    },
    children: [
      createContainerNode({
        style: {
          width: 190,
          paddingLeft: 16,
          paddingRight: 16,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          flexShrink: 0,
        },
        children: [
          createContainerNode({
            style: {
              width: '100%',
              height: 72,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: color,
              color: '#ffffff',
            },
            children: [
              createTextNode({
                text: chart.difficulty.name.toUpperCase(),
                style: { fontSize: 17, fontWeight: 700, lineHeight: 1.1 },
              }),
              createTextNode({
                text: `${chart.level} · ${chart.levelValue.toFixed(1)}`,
                style: { marginTop: 5, fontSize: 14, fontWeight: 700, lineHeight: 1 },
              }),
            ],
          }),
          createTextNode({
            text: chart.notesDesigner || 'Unknown designer',
            style: {
              width: '100%',
              height: 22,
              marginTop: 10,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'center',
              fontSize: 12,
              color: MAIMAI_RENDER_THEME.colors.mutedText,
            },
          }),
        ],
      }),
      createContainerNode({
        style: {
          width: 290,
          paddingLeft: 20,
          paddingRight: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderLeft: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
          flexShrink: 0,
        },
        children: record ? [
          createTextNode({
            text: Rate.toString(record.achievement),
            style: { fontSize: 29, fontWeight: 700, color, lineHeight: 1.1 },
          }),
          createContainerNode({
            style: { marginTop: 14, display: 'flex', flexDirection: 'row', gap: 7 },
            children: [
              scoreBadge(rateLabels[record.rate] ?? record.rate.toUpperCase(), MAIMAI_RENDER_THEME.colors.darkSurface),
              scoreBadge(comboLabels[record.comboStatus.value] ?? '--', '#c3486c'),
              scoreBadge(syncLabels[record.syncStatus.value] ?? '--', '#4f6fc7'),
            ],
          }),
          createTextNode({
            text: `RATING ${record.rating}`,
            style: { marginTop: 12, fontSize: 13, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
        ] : [
          createTextNode({
            text: 'Not played',
            style: { fontSize: 22, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
        ],
      }),
      createContainerNode({
        style: {
          width: 254,
          paddingLeft: 20,
          paddingRight: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderLeft: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
          overflow: 'hidden',
        },
        children: record ? [
          createTextNode({
            text: `DX ${record.deluxeScore}/${chart.maxDeluxeScore}`,
            style: { fontSize: 19, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.text },
          }),
          createTextNode({
            text: `DX STAR ${'★'.repeat(stars) || '--'}`,
            style: { marginTop: 12, fontSize: 16, fontWeight: 700, color: '#9a621b' },
          }),
          createTextNode({
            text: chartLabel(chart),
            style: { marginTop: 12, fontSize: 12, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
        ] : [
          createTextNode({
            text: `DX 0/${chart.maxDeluxeScore}`,
            style: { fontSize: 19, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
          createTextNode({
            text: 'DX STAR --',
            style: { marginTop: 12, fontSize: 16, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
        ],
      }),
    ],
  })
}

function musicMetadataRow(label: string, value: string) {
  return createContainerNode({
    style: {
      width: '100%',
      height: 52,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottom: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
    },
    children: [
      createTextNode({
        text: label,
        style: { fontSize: 12, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText },
      }),
      createTextNode({
        text: value,
        style: {
          width: 230,
          height: 24,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'right',
          fontSize: 15,
          fontWeight: 700,
          color: MAIMAI_RENDER_THEME.colors.text,
        },
      }),
    ],
  })
}

function musicPanel(music: MusicInfo, cover: Buffer, utageIcon?: Buffer) {
  return createContainerNode({
    id: 'score-header',
    style: {
      width: 390,
      height: 1032,
      display: 'flex',
      flexDirection: 'column',
      border: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
      backgroundColor: MAIMAI_RENDER_THEME.colors.surface,
      overflow: 'hidden',
      flexShrink: 0,
    },
    children: [
      createImageNode({
        className: 'score-cover',
        src: cover,
        width: 388,
        height: 388,
        style: {
          width: 388,
          height: 388,
          objectFit: 'cover',
          flexShrink: 0,
        },
      }),
      createContainerNode({
        style: {
          width: '100%',
          height: 642,
          padding: 24,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderTop: `8px solid ${MAIMAI_RENDER_THEME.colors.accent}`,
        },
        children: [
          createContainerNode({
            style: {
              height: 36,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            },
            children: [
              createTextNode({
                text: `ID ${music.id}`,
                style: { fontSize: 15, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText },
              }),
              createContainerNode({
                style: { display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10 },
                children: [
                  ...(utageIcon ? [createImageNode({
                    className: 'utage-icon',
                    src: utageIcon,
                    width: 36,
                    height: 36,
                    style: { width: 36, height: 36 },
                  })] : []),
                  scoreBadge(music.type.value, music.type.value === 'DX'
                    ? MAIMAI_RENDER_THEME.colors.accent
                    : '#536170'),
                ],
              }),
            ],
          }),
          createTextNode({
            text: music.name,
            style: {
              width: '100%',
              maxHeight: 112,
              marginTop: 20,
              overflow: 'hidden',
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1.18,
              color: MAIMAI_RENDER_THEME.colors.text,
            },
          }),
          createTextNode({
            text: music.artist || 'Unknown artist',
            style: {
              width: '100%',
              height: 32,
              marginTop: 10,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 18,
              color: MAIMAI_RENDER_THEME.colors.mutedText,
            },
          }),
          createContainerNode({
            style: {
              width: '100%',
              marginTop: 26,
              display: 'flex',
              flexDirection: 'column',
              borderTop: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
            },
            children: [
              musicMetadataRow('ARTIST', music.artist || 'Unknown artist'),
              musicMetadataRow('VERSION', music.version.name),
              musicMetadataRow('GENRE', music.genre.genreName),
              musicMetadataRow('BPM', String(music.bpm)),
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
        flexDirection: 'row',
        gap: 18,
        backgroundColor: MAIMAI_RENDER_THEME.colors.background,
        color: MAIMAI_RENDER_THEME.colors.text,
        fontFamily: MAIMAI_RENDER_THEME.fontFamily,
      },
      children: [
        musicPanel(input.music, cover, utageIcon),
        createContainerNode({
          id: 'score-difficulty-list',
          style: {
            width: 744,
            height: 1032,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflow: 'hidden',
          },
          children: rows,
        }),
      ],
    }),
  }
}
