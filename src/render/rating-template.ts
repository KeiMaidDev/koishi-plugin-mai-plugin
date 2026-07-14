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
}

export interface RatingRenderPlan {
  node: Node
  width: number
  height: number
}

interface RatingGeneratedAssets {
  numberPlate: Buffer
  danBadge: Buffer
  statusPlate: Buffer
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

function statusBadge(text: string, color: string, statusPlate: Buffer) {
  return createContainerNode({
    className: 'rating-status-badge',
    style: {
      position: 'relative',
      height: 20,
      minWidth: 24,
      paddingLeft: 3,
      paddingRight: 3,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 4,
      borderLeft: `3px solid ${color}`,
      backgroundColor: '#26313e',
      color: '#ffffff',
      flexShrink: 0,
      overflow: 'hidden',
    },
    children: [
      createImageNode({
        className: 'generated-status-plate',
        src: statusPlate,
        width: 120,
        height: 36,
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          objectFit: 'fill',
          opacity: 0.9,
        },
      }),
      createTextNode({
        text,
        style: { position: 'relative', fontSize: 9, fontWeight: 700, lineHeight: 1 },
      }),
    ],
  })
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
      flexDirection: 'row' as const,
      flexShrink: 0,
      borderRadius: 6,
      backgroundColor: empty ? '#edf0f4' : '#ffffff',
      border: empty ? '1px dashed #c8ced8' : '1px solid #d6dbe3',
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
  generatedAssets: RatingGeneratedAssets,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const color = difficultyColor(record)
  const cover = await renderService.loadAsset(
    data.coverPath(record.music.resourceId, true),
    resolvePackageAssetPath('fallback/cover.png'),
  )
  const stars = DeluxeScore.stars(record.deluxeScore, record.chart.maxDeluxeScore)
  const type = record.music.type.value
  const rank = rateLabels[record.rate]
  const combo = comboLabels[record.comboStatus.value]
  const sync = syncLabels[record.syncStatus.value]

  return createContainerNode({
    ...ratingSlotBase(index, section, false),
    attributes: {
      ...ratingSlotBase(index, section, false).attributes,
      'data-difficulty': record.chart.difficulty.name,
    },
    children: [
      createContainerNode({
        style: { width: 6, height: '100%', backgroundColor: color, flexShrink: 0 },
      }),
      createContainerNode({
        style: {
          width: 82,
          height: '100%',
          padding: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        },
        children: [createImageNode({
          src: cover,
          width: 72,
          height: 72,
          style: { width: 72, height: 72, objectFit: 'cover', borderRadius: 4 },
        })],
      }),
      createContainerNode({
        style: {
          width: 180,
          height: '100%',
          paddingTop: 7,
          paddingRight: 7,
          paddingBottom: 6,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        },
        children: [
          createTextNode({
            text: `#${index + 1} · ID ${record.music.id}`,
            style: { fontSize: 10, color: '#737d8c', lineHeight: 1.15 },
          }),
          createTextNode({
            text: record.music.name,
            style: {
              width: '100%',
              height: 20,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontSize: 14,
              fontWeight: 700,
              lineHeight: 1.35,
              color: MAIMAI_RENDER_THEME.colors.text,
            },
          }),
          createContainerNode({
            style: {
              height: 24,
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
            },
            children: [
              createTextNode({
                text: Rate.toString(record.achievement),
                style: { fontSize: 16, fontWeight: 700, color: '#1c2634', lineHeight: 1 },
              }),
              createTextNode({
                text: `${record.chart.levelValue.toFixed(1)} -> ${record.rating}`,
                style: { fontSize: 10, fontWeight: 700, color, lineHeight: 1 },
              }),
            ],
          }),
          createContainerNode({
            className: 'rating-status-row',
            style: { height: 20, display: 'flex', flexDirection: 'row', gap: 2, overflow: 'hidden' },
            children: [
              statusBadge(type, type === 'DX' ? '#137e91' : '#536170', generatedAssets.statusPlate),
              statusBadge(rank, '#303945', generatedAssets.statusPlate),
              statusBadge(combo, combo === '--' ? '#98a0aa' : '#c3486c', generatedAssets.statusPlate),
              statusBadge(sync, sync === '--' ? '#98a0aa' : '#4f6fc7', generatedAssets.statusPlate),
              statusBadge(`DX ★${stars}`, '#a36517', generatedAssets.statusPlate),
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
  generatedAssets: RatingGeneratedAssets,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const visibleRecords = records.slice(0, count)
  const slots = await Promise.all(Array.from({ length: count }, (_, index) => {
    const record = visibleRecords[index]
    return record
      ? ratingRecordSlot(index, section, record, generatedAssets, renderService, data)
      : emptyRatingSlot(index, section)
  }))

  return createContainerNode({
    id: `rating-section-${section}`,
    style: { width: '100%', display: 'flex', flexDirection: 'column', gap: 10 },
    children: [
      createContainerNode({
        style: {
          height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: `3px solid ${section === 'old' ? '#317a91' : '#bd4f78'}`,
        },
        children: [
          createTextNode({
            text: title,
            style: { fontSize: 20, fontWeight: 700, color: '#26313e' },
          }),
          createTextNode({
            text: `${visibleRecords.length}/${count}`,
            style: { fontSize: 13, fontWeight: 700, color: '#677283' },
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
  generatedAssets: RatingGeneratedAssets,
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
      position: 'relative',
      width: '100%',
      height: 176,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      borderRadius: 6,
      backgroundColor: '#26313e',
    },
    children: [
      createImageNode({
        src: plate,
        width: 1384,
        height: 176,
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1384,
          height: 176,
          objectFit: 'cover',
          opacity: 0.72,
        },
      }),
      createContainerNode({
        style: {
          position: 'absolute',
          left: 0,
          top: 0,
          width: 1384,
          height: 176,
          backgroundColor: 'rgba(20, 30, 42, 0.48)',
        },
      }),
      createContainerNode({
        style: {
          position: 'relative',
          width: '100%',
          height: '100%',
          padding: 20,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 22,
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
              borderRadius: 6,
              border: '4px solid rgba(255,255,255,0.9)',
              flexShrink: 0,
            },
          }),
          createContainerNode({
            style: {
              width: 710,
              height: 128,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              overflow: 'hidden',
              color: '#ffffff',
            },
            children: [
              createTextNode({
                text: input.player.nickname || 'maimai player',
                style: {
                  width: '100%',
                  height: 46,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 31,
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
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#f6f8fb',
                },
              }),
            ],
          }),
          createContainerNode({
            id: 'rating-number-plate',
            style: {
              position: 'relative',
              width: 300,
              height: 104,
              paddingLeft: 20,
              paddingRight: 20,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              borderRadius: 6,
              backgroundColor: 'rgba(255,255,255,0)',
              color: '#1e2733',
              flexShrink: 0,
              overflow: 'hidden',
            },
            children: [
              createImageNode({
                className: 'rating-number-plate-asset',
                src: generatedAssets.numberPlate,
                width: 300,
                height: 104,
                style: { position: 'absolute', left: 0, top: 0, width: 300, height: 104 },
              }),
              createTextNode({ text: 'RATING', style: { position: 'relative', fontSize: 14, fontWeight: 700, color: '#657080' } }),
              createTextNode({ text: String(rating), style: { position: 'relative', fontSize: 48, fontWeight: 700, lineHeight: 1 } }),
            ],
          }),
          createContainerNode({
            id: 'rating-course-badge',
            style: {
              position: 'relative',
              width: 150,
              height: 104,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 6,
              backgroundColor: 'rgba(32,42,54,0)',
              color: '#ffffff',
              flexShrink: 0,
              overflow: 'hidden',
            },
            children: [
              createImageNode({
                className: 'dan-badge-asset',
                src: generatedAssets.danBadge,
                width: 150,
                height: 104,
                style: { position: 'absolute', left: 0, top: 0, width: 150, height: 104 },
              }),
              createTextNode({ text: 'DAN', style: { position: 'relative', fontSize: 14, fontWeight: 700, color: '#f4b942' } }),
              createTextNode({ text: String(input.player.course), style: { position: 'relative', fontSize: 35, fontWeight: 700, lineHeight: 1.1 } }),
            ],
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
  const title = `[${input.backend}] B35 ${oldRating} + B15 ${newRating} = ${rating}`
  const fallbackPlate = resolvePackageAssetPath('fallback/plate.png')
  const fallbackAvatar = resolvePackageAssetPath('fallback/avatar.png')
  const [numberPlate, danBadge, statusPlate] = await Promise.all([
    renderService.loadAsset(resolvePackageAssetPath('generated/rating-number-plate.png'), fallbackPlate),
    renderService.loadAsset(resolvePackageAssetPath('generated/dan-badge.png'), fallbackAvatar),
    renderService.loadAsset(resolvePackageAssetPath('generated/status-plate.png'), fallbackPlate),
  ])
  const generatedAssets = { numberPlate, danBadge, statusPlate }
  const [header, oldSection, newSection] = await Promise.all([
    ratingHeader(input, title, rating, generatedAssets, renderService, data),
    ratingSection(`BEST ${oldCount}`, 'old', oldCount, input.oldRecords, generatedAssets, renderService, data),
    ratingSection(`NEW ${newCount}`, 'new', newCount, input.newRecords, generatedAssets, renderService, data),
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
