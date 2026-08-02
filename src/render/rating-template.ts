import type { Node } from '@takumi-rs/helpers'
import type { MaimaiDataStore } from '../data/sync-service'
import { Rate } from '../domain/enums'
import type { RecordEntry } from '../domain/music'
import type { PlayerInfo, PlayerSettings } from '../domain/player'
import { DeluxeScore } from '../domain/rating'
import { resolvePackageAssetPath } from './assets'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const MAIMAI_DIFFICULTY_COLORS = Object.freeze({
  Basic: '#45c124',
  Advanced: '#f8b709',
  Expert: '#ff5a66',
  Master: '#9f51dc',
  ReMaster: '#dbaaff',
  Utage: '#ff6ffd',
} as const)

export type MaimaiDifficultyName = keyof typeof MAIMAI_DIFFICULTY_COLORS

export const RATING_TEMPLATE_SIZE = Object.freeze({ width: 1440, height: 1490 })

export interface RatingRenderInput {
  backend: string
  player: PlayerInfo
  settings?: PlayerSettings | null
  oldRecords: readonly RecordEntry[]
  newRecords: readonly RecordEntry[]
  oldCount?: number
  newCount?: number
  rating?: number
  title?: string
  oldLabel?: string
  newLabel?: string
}

export interface RatingRenderPlan {
  node: Node
  width: number
  height: number
}

const rateLabels = Object.freeze({
  sssp: 'SSS+',
  sss: 'SSS',
  ssp: 'SS+',
  ss: 'SS',
  sp: 'S+',
  s: 'S',
  aaa: 'AAA',
  aa: 'AA',
  a: 'A',
  bbb: 'BBB',
  bb: 'BB',
  b: 'B',
  c: 'C',
  d: 'D',
} as const)

const comboLabels: Readonly<Record<string, string>> = Object.freeze({
  none: '--',
  fc: 'FC',
  fcp: 'FC+',
  ap: 'AP',
  app: 'AP+',
} as const)

const syncLabels: Readonly<Record<string, string>> = Object.freeze({
  none: '--',
  fs: 'FS',
  fsp: 'FS+',
  fsd: 'FSD',
  fsdp: 'FSD+',
  sync: 'SYNC',
} as const)

function positiveCount(value: number | undefined, fallback: number, name: string) {
  const count = value ?? fallback
  if (!Number.isInteger(count) || count < 0) throw new RangeError(`${name} must be a non-negative integer`)
  return count
}

function difficultyColor(record: RecordEntry) {
  return MAIMAI_DIFFICULTY_COLORS[record.chart.difficulty.name as MaimaiDifficultyName]
    ?? MAIMAI_RENDER_THEME.colors.mutedText
}

function ratingSlotBase(index: number, section: 'old' | 'new', empty: boolean) {
  return {
    id: `rating-slot-${section}-${index + 1}`,
    className: 'rating-slot',
    attributes: {
      'data-empty': String(empty),
      'data-section': section,
      'data-index': String(index + 1),
    },
    style: {
      position: 'relative' as const,
      width: 268,
      height: 104,
      overflow: 'hidden' as const,
      display: 'flex' as const,
      flexDirection: 'column' as const,
      flexShrink: 0,
      borderRadius: 5,
      backgroundColor: empty ? '#eaf0f4' : MAIMAI_RENDER_THEME.colors.surface,
      border: empty ? `1px dashed ${MAIMAI_RENDER_THEME.colors.line}` : `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
    },
  }
}

function emptyRatingSlot(index: number, section: 'old' | 'new') {
  return createContainerNode({
    ...ratingSlotBase(index, section, true),
    children: [createContainerNode({
      style: {
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#9aa3b2',
      },
      children: [createTextNode({
        text: `#${index + 1} EMPTY`,
        style: { fontSize: 12, fontWeight: 700 },
      })],
    })],
  })
}

async function ratingRecordSlot(
  index: number,
  section: 'old' | 'new',
  record: RecordEntry,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const color = difficultyColor(record)
  const cover = await renderService.loadAsset(
    data.coverPath(record.music.resourceId),
    resolvePackageAssetPath('fallback/cover.png'),
  )
  const stars = DeluxeScore.stars(record.deluxeScore, record.chart.maxDeluxeScore)
  const type = record.music.type.value
  const rank = rateLabels[record.rate]
  const combo = comboLabels[record.comboStatus.value]
  const sync = syncLabels[record.syncStatus.value]

  return createContainerNode({
    ...ratingSlotBase(index, section, false),
    style: {
      ...ratingSlotBase(index, section, false).style,
      border: `2px solid ${color}`,
    },
    attributes: {
      ...ratingSlotBase(index, section, false).attributes,
      'data-difficulty': record.chart.difficulty.name,
    },
    children: [
      createImageNode({
        src: cover,
        width: 264,
        height: 46,
        style: { width: 264, height: 46, objectFit: 'cover', flexShrink: 0 },
      }),
      createContainerNode({
        style: {
          position: 'absolute',
          left: 4,
          top: 4,
          height: 17,
          paddingLeft: 5,
          paddingRight: 5,
          display: 'flex',
          alignItems: 'center',
          borderRadius: 2,
          backgroundColor: 'rgba(38,49,60,0.88)',
          color: '#ffffff',
        },
        children: [createTextNode({
          text: `#${String(index + 1).padStart(2, '0')} · ${record.music.id}`,
          style: { fontSize: 9, fontWeight: 700, lineHeight: 1 },
        })],
      }),
      createContainerNode({
        style: {
          position: 'absolute',
          right: 4,
          top: 4,
          height: 17,
          paddingLeft: 5,
          paddingRight: 5,
          display: 'flex',
          alignItems: 'center',
          borderRadius: 2,
          backgroundColor: MAIMAI_RENDER_THEME.colors.highlight,
          color: MAIMAI_RENDER_THEME.colors.text,
        },
        children: [createTextNode({
          text: type,
          style: { fontSize: 9, fontWeight: 700, lineHeight: 1 },
        })],
      }),
      createContainerNode({
        style: {
          width: '100%',
          height: 54,
          paddingTop: 3,
          paddingLeft: 6,
          paddingRight: 6,
          paddingBottom: 4,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        children: [
          createTextNode({
            text: record.music.name,
            style: {
              width: '100%',
              height: 16,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 11,
              fontWeight: 700,
              lineHeight: 1.25,
              color: MAIMAI_RENDER_THEME.colors.text,
            },
          }),
          createContainerNode({
            style: {
              height: 18,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            },
            children: [
              createTextNode({
                text: Rate.toString(record.achievement),
                style: { fontSize: 14, fontWeight: 700, color, lineHeight: 1 },
              }),
              createTextNode({
                text: `${record.chart.levelValue.toFixed(1)} -> ${record.rating}`,
                style: { fontSize: 9, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText, lineHeight: 1 },
              }),
            ],
          }),
          createContainerNode({
            className: 'rating-status-row',
            style: {
              height: 14,
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              overflow: 'hidden',
            },
            children: [
              createTextNode({
                text: rank,
                style: { fontSize: 9, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.text, lineHeight: 1 },
              }),
              createTextNode({
                text: `${combo} · ${sync} · DX ★${stars}`,
                style: { fontSize: 8, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText, lineHeight: 1 },
              }),
            ],
          }),
        ],
      }),
    ],
  })
}

async function ratingSection(
  title: string,
  section: 'old' | 'new',
  count: number,
  records: readonly RecordEntry[],
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const visibleRecords = records.slice(0, count)
  const slots = await Promise.all(Array.from({ length: count }, (_, index) => {
    const record = visibleRecords[index]
    return record
      ? ratingRecordSlot(index, section, record, renderService, data)
      : emptyRatingSlot(index, section)
  }))

  return createContainerNode({
    id: `rating-section-${section}`,
    style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10 },
    children: [
      createContainerNode({
        style: {
          height: 34,
          paddingLeft: 10,
          paddingRight: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderLeft: `7px solid ${section === 'old'
            ? MAIMAI_RENDER_THEME.colors.accent
            : MAIMAI_RENDER_THEME.colors.secondaryAccent}`,
          backgroundColor: MAIMAI_RENDER_THEME.colors.surface,
        },
        children: [
          createTextNode({
            text: title,
            style: { fontSize: 17, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.text },
          }),
          createTextNode({
            text: `${visibleRecords.length}/${count}`,
            style: { fontSize: 12, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.mutedText },
          }),
        ],
      }),
      createContainerNode({
        className: 'rating-grid',
        style: {
          width: '100%',
          display: 'flex',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 10,
          alignContent: 'flex-start',
        },
        children: slots,
      }),
    ],
  })
}

async function ratingHeader(
  input: RatingRenderInput,
  title: string,
  rating: number,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const avatarId = input.settings?.avatar ?? 0
  const plateId = input.settings?.plate ?? 0
  const [avatar, plate] = await Promise.all([
    renderService.loadAsset(data.avatarPath(avatarId), resolvePackageAssetPath('fallback/avatar.png')),
    renderService.loadAsset(data.platePath(plateId), resolvePackageAssetPath('fallback/plate.png')),
  ])

  return createContainerNode({
    id: 'rating-header',
    style: {
      width: '100%',
      height: 176,
      padding: 16,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 18,
      borderRadius: 6,
      border: `1px solid ${MAIMAI_RENDER_THEME.colors.line}`,
      backgroundColor: MAIMAI_RENDER_THEME.colors.surface,
    },
    children: [
      createImageNode({
        src: avatar,
        width: 128,
        height: 128,
        style: {
          width: 128,
          height: 128,
          objectFit: 'cover',
          borderRadius: 64,
          border: `6px solid ${MAIMAI_RENDER_THEME.colors.highlight}`,
          backgroundColor: MAIMAI_RENDER_THEME.colors.accent,
          flexShrink: 0,
        },
      }),
      createContainerNode({
        style: {
          position: 'relative',
          width: 690,
          height: 132,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          borderLeft: `8px solid ${MAIMAI_RENDER_THEME.colors.secondaryAccent}`,
          backgroundColor: '#edf7fa',
          flexShrink: 0,
        },
        children: [
          createImageNode({
            src: plate,
            width: 690,
            height: 132,
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              width: 690,
              height: 132,
              objectFit: 'cover',
              opacity: 0.22,
            },
          }),
          createContainerNode({
            style: {
              position: 'absolute',
              left: 0,
              top: 0,
              width: 690,
              height: 132,
              backgroundColor: 'rgba(237,247,250,0.72)',
            },
          }),
          createContainerNode({
            style: {
              position: 'relative',
              width: '100%',
              height: '100%',
              paddingLeft: 22,
              paddingRight: 22,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              overflow: 'hidden',
              color: MAIMAI_RENDER_THEME.colors.text,
            },
            children: [
              createTextNode({
                text: input.player.nickname || 'maimai player',
                style: {
                  width: '100%',
                  height: 44,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 30,
                  fontWeight: 700,
                  lineHeight: 1.35,
                },
              }),
              createTextNode({
                text: title,
                style: {
                  width: '100%',
                  height: 30,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 16,
                  fontWeight: 700,
                  color: MAIMAI_RENDER_THEME.colors.mutedText,
                },
              }),
            ],
          }),
        ],
      }),
      createContainerNode({
        id: 'rating-number-plate',
        style: {
          width: 300,
          height: 112,
          paddingLeft: 20,
          paddingRight: 20,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          border: `3px solid ${MAIMAI_RENDER_THEME.colors.highlight}`,
          backgroundColor: MAIMAI_RENDER_THEME.colors.darkSurface,
          color: '#ffffff',
          flexShrink: 0,
          overflow: 'hidden',
        },
        children: [
          createTextNode({
            text: 'DELUXE RATING',
            style: { fontSize: 13, fontWeight: 700, color: '#ffffff' },
          }),
          createTextNode({
            text: String(rating),
            style: { fontSize: 46, fontWeight: 700, lineHeight: 1.05, color: '#ffe36b' },
          }),
        ],
      }),
      createContainerNode({
        id: 'rating-course-badge',
        style: {
          width: 150,
          height: 112,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          border: `3px solid ${MAIMAI_RENDER_THEME.colors.highlight}`,
          backgroundColor: MAIMAI_RENDER_THEME.colors.darkSurface,
          color: '#ffffff',
          flexShrink: 0,
          overflow: 'hidden',
        },
        children: [
          createTextNode({
            text: 'DAN',
            style: { fontSize: 13, fontWeight: 700, color: MAIMAI_RENDER_THEME.colors.highlight },
          }),
          createTextNode({
            text: String(input.player.course),
            style: { fontSize: 35, fontWeight: 700, lineHeight: 1.1 },
          }),
        ],
      }),
    ],
  })
}

export async function createRatingRenderPlan(
  input: RatingRenderInput,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
): Promise<RatingRenderPlan> {
  const oldCount = positiveCount(input.oldCount, 35, 'Old rating slot count')
  const newCount = positiveCount(input.newCount, 15, 'New rating slot count')
  const oldRating = input.oldRecords.slice(0, oldCount).reduce((sum, record) => sum + record.rating, 0)
  const newRating = input.newRecords.slice(0, newCount).reduce((sum, record) => sum + record.rating, 0)
  const rating = input.rating ?? oldRating + newRating
  const title = input.title
    ?? `[${input.backend}] B${oldCount} ${oldRating} + B${newCount} ${newRating} = ${rating}`
  const [header, oldSection, newSection] = await Promise.all([
    ratingHeader(input, title, rating, renderService, data),
    ratingSection(input.oldLabel ?? `OLD CHARTS · B${oldCount}`, 'old', oldCount, input.oldRecords, renderService, data),
    ratingSection(input.newLabel ?? `NEW CHARTS · B${newCount}`, 'new', newCount, input.newRecords, renderService, data),
  ])

  return {
    width: RATING_TEMPLATE_SIZE.width,
    height: RATING_TEMPLATE_SIZE.height,
    node: createContainerNode({
      id: 'rating-template',
      style: {
        width: RATING_TEMPLATE_SIZE.width,
        height: RATING_TEMPLATE_SIZE.height,
        overflow: 'hidden',
        padding: 28,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        backgroundColor: MAIMAI_RENDER_THEME.colors.background,
        color: MAIMAI_RENDER_THEME.colors.text,
        fontFamily: MAIMAI_RENDER_THEME.fontFamily,
      },
      children: [header, oldSection, newSection],
    }),
  }
}
