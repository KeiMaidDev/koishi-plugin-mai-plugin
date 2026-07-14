import type { Node } from '@takumi-rs/helpers'
import type { MaimaiDataStore } from '../data/sync-service'
import type { CourseInfo } from '../data/normalizers'
import { Rate } from '../domain/enums'
import type { ChartInfo, RecordEntry } from '../domain/music'
import { resolvePackageAssetPath } from './assets'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import {
  MAIMAI_DIFFICULTY_COLORS,
  type MaimaiDifficultyName,
} from './rating-template'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const COURSE_TEMPLATE_SIZE = Object.freeze({ width: 1280, height: 760 })

export interface CourseSongRenderInput {
  chart: ChartInfo
  record?: RecordEntry | null
}

export interface CourseRenderInput {
  course: CourseInfo
  songs: readonly CourseSongRenderInput[]
}

export interface CourseRenderPlan {
  node: Node
  width: number
  height: number
}

interface CourseSongResult extends CourseSongRenderInput {
  damage: number
  life: number
}

export function courseBackgroundVariant(courseId: number) {
  const realId = courseId % 10_000
  if (realId <= 1_010) return 1
  if (realId <= 1_112) return 2
  return 3
}

function minimumDamage(chart: ChartInfo, achievement: number, course: CourseInfo) {
  const totalBase = chart.notes.tap
    + chart.notes.touch
    + 2 * chart.notes.hold
    + 3 * chart.notes.slide
    + 5 * chart.notes.break
  if (totalBase <= 0) return 0
  const amount = Math.max(0, 1_010_000 - achievement) / (100_000 / totalBase)
  const candidates = [
    course.damage.great ? course.damage.great * Math.floor(amount / 2) : undefined,
    course.damage.good ? course.damage.good * Math.floor(amount / 5) : undefined,
    course.damage.miss ? course.damage.miss * Math.floor(amount / 10) : undefined,
  ].filter((value): value is number => value !== undefined)
  return candidates.length ? Math.min(...candidates) : 0
}

function courseResults(input: CourseRenderInput) {
  let life = input.course.life
  return input.songs.slice(0, 4).map((song, index): CourseSongResult => {
    if (index > 0 && life > 0) life += input.course.recover
    const damage = song.record?.comboStatus.isAP()
      ? 0
      : minimumDamage(song.chart, song.record?.achievement ?? 0, input.course)
    life = Math.max(0, life - damage)
    return { ...song, damage, life }
  })
}

function courseMetric(label: string, value: string, accent: string) {
  return createContainerNode({
    style: {
      minWidth: 176,
      height: 72,
      paddingLeft: 18,
      paddingRight: 18,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      borderLeft: `8px solid ${accent}`,
      backgroundColor: 'rgba(255,255,255,0.94)',
      color: '#20242c',
    },
    children: [
      createTextNode({ text: label, style: { fontSize: 12, fontWeight: 700, color: '#657080' } }),
      createTextNode({ text: value, style: { fontSize: 28, fontWeight: 700, lineHeight: 1.15 } }),
    ],
  })
}

function finalMarker(finalPlate: Buffer) {
  return createContainerNode({
    id: 'course-final',
    style: {
      position: 'relative',
      width: 220,
      height: 64,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    },
    children: [
      createImageNode({
        src: finalPlate,
        width: 220,
        height: 64,
        style: { position: 'absolute', left: 0, top: 0, width: 220, height: 64 },
      }),
      createTextNode({
        text: 'Final',
        style: { position: 'relative', fontSize: 27, fontWeight: 700, color: '#ffffff' },
      }),
    ],
  })
}

function courseHeader(
  input: CourseRenderInput,
  results: readonly CourseSongResult[],
  finalPlate: Buffer,
) {
  const totalAchievement = results.reduce((sum, song) => sum + (song.record?.achievement ?? 0), 0)
  const average = results.length ? Math.floor(totalAchievement / results.length) : 0
  const finalLife = results.at(-1)?.life ?? input.course.life
  return createContainerNode({
    id: 'course-header',
    style: {
      width: '100%',
      height: 170,
      padding: 20,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      overflow: 'hidden',
      backgroundColor: 'rgba(31, 42, 55, 0.88)',
      color: '#ffffff',
    },
    children: [
      createContainerNode({
        style: {
          width: 470,
          height: 128,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
        },
        children: [
          createTextNode({ text: `COURSE ${input.course.id}`, style: { fontSize: 16, fontWeight: 700, color: '#f4b942' } }),
          createTextNode({
            text: input.course.name,
            style: {
              width: '100%',
              maxHeight: 72,
              overflow: 'hidden',
              fontSize: 34,
              fontWeight: 700,
              lineHeight: 1.15,
            },
          }),
        ],
      }),
      courseMetric('START', `LIFE ${input.course.life}`, '#ff5a66'),
      courseMetric('HEAL', `RECOVER +${input.course.recover}`, '#45c124'),
      courseMetric('AVERAGE', Rate.toString(average), '#00a8a8'),
      ...(finalLife <= 0 ? [finalMarker(finalPlate)] : []),
    ],
  })
}

async function songCard(
  index: number,
  song: CourseSongResult,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
) {
  const cover = await renderService.loadAsset(
    data.coverPath(song.chart.music.resourceId),
    resolvePackageAssetPath('fallback/cover.png'),
  )
  const color = MAIMAI_DIFFICULTY_COLORS[song.chart.difficulty.name as MaimaiDifficultyName]
  const achievement = song.record?.achievement ?? 0
  return createContainerNode({
    className: 'course-song-card',
    attributes: {
      'data-track': String(index + 1),
      'data-difficulty': song.chart.difficulty.name,
      'data-final': String(song.life <= 0),
    },
    style: {
      width: 300,
      height: 514,
      padding: 14,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      overflow: 'hidden',
      borderTop: `10px solid ${color}`,
      backgroundColor: 'rgba(255,255,255,0.96)',
      color: '#20242c',
      flexShrink: 0,
    },
    children: [
      createContainerNode({
        style: { height: 27, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        children: [
          createTextNode({ text: `TRACK ${index + 1}`, style: { fontSize: 16, fontWeight: 700 } }),
          createTextNode({ text: song.chart.music.type.value, style: { fontSize: 14, fontWeight: 700, color: '#137e91' } }),
        ],
      }),
      createImageNode({
        src: cover,
        width: 252,
        height: 252,
        style: { width: 252, height: 252, objectFit: 'cover', borderRadius: 5, alignSelf: 'center' },
      }),
      createTextNode({
        text: song.chart.music.name,
        style: {
          width: '100%',
          height: 48,
          overflow: 'hidden',
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 1.25,
        },
      }),
      createContainerNode({
        style: { height: 28, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
        children: [
          createTextNode({ text: `${song.chart.difficulty.name} ${song.chart.level}`, style: { fontSize: 15, fontWeight: 700, color } }),
          createTextNode({ text: Rate.toString(achievement), style: { fontSize: 16, fontWeight: 700 } }),
        ],
      }),
      createContainerNode({
        style: {
          height: 44,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: 12,
          paddingRight: 12,
          borderRadius: 4,
          backgroundColor: song.life <= 0 ? '#b6293e' : '#26313e',
          color: '#ffffff',
        },
        children: [
          createTextNode({ text: `DAMAGE -${song.damage}`, style: { fontSize: 14, fontWeight: 700 } }),
          createTextNode({ text: song.life <= 0 ? 'FAILED · LIFE 0' : `LIFE ${song.life}`, style: { fontSize: 14, fontWeight: 700 } }),
        ],
      }),
    ],
  })
}

function emptySongCard(index: number) {
  return createContainerNode({
    className: 'course-song-card',
    attributes: { 'data-track': String(index + 1), 'data-empty': 'true' },
    style: {
      width: 300,
      height: 514,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '2px dashed rgba(38,49,62,0.4)',
      backgroundColor: 'rgba(255,255,255,0.72)',
      color: '#657080',
      flexShrink: 0,
    },
    children: [createTextNode({ text: `TRACK ${index + 1} EMPTY`, style: { fontSize: 20, fontWeight: 700 } })],
  })
}

export async function createCourseRenderPlan(
  input: CourseRenderInput,
  renderService: TakumiRenderService,
  data: MaimaiDataStore,
): Promise<CourseRenderPlan> {
  const variant = courseBackgroundVariant(input.course.id)
  const results = courseResults(input)
  const [background, finalPlate, ...cards] = await Promise.all([
    renderService.loadAsset(
      resolvePackageAssetPath(`generated/course-background-${variant}.png`),
      resolvePackageAssetPath('fallback/plate.png'),
    ),
    renderService.loadAsset(
      resolvePackageAssetPath('generated/course-final-plate.png'),
      resolvePackageAssetPath('fallback/plate.png'),
    ),
    ...results.map((song, index) => songCard(index, song, renderService, data)),
  ])
  const stableCards = Array.from({ length: 4 }, (_, index) => cards[index] ?? emptySongCard(index))

  return {
    width: COURSE_TEMPLATE_SIZE.width,
    height: COURSE_TEMPLATE_SIZE.height,
    node: createContainerNode({
      id: 'course-template',
      style: {
        position: 'relative',
        width: COURSE_TEMPLATE_SIZE.width,
        height: COURSE_TEMPLATE_SIZE.height,
        overflow: 'hidden',
        backgroundColor: '#eef1f4',
        color: MAIMAI_RENDER_THEME.colors.text,
        fontFamily: MAIMAI_RENDER_THEME.fontFamily,
      },
      children: [
        createImageNode({
          id: `course-background-${variant}`,
          className: 'course-background',
          src: background,
          width: COURSE_TEMPLATE_SIZE.width,
          height: COURSE_TEMPLATE_SIZE.height,
          style: {
            position: 'absolute',
            left: 0,
            top: 0,
            width: COURSE_TEMPLATE_SIZE.width,
            height: COURSE_TEMPLATE_SIZE.height,
            objectFit: 'cover',
          },
        }),
        createContainerNode({
          style: {
            position: 'relative',
            width: '100%',
            height: '100%',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
          },
          children: [
            courseHeader(input, results, finalPlate),
            createContainerNode({
              id: 'course-songs',
              style: { width: '100%', height: 514, display: 'flex', flexDirection: 'row', gap: 10 },
              children: stableCards,
            }),
          ],
        }),
      ],
    }),
  }
}
