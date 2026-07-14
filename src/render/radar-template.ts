import type { Node } from '@takumi-rs/helpers'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const RADAR_TEMPLATE_SIZE = 600

export interface RadarAxisValue {
  label: string
  value: number
  max?: number
}

export type RadarAxes = readonly [
  RadarAxisValue,
  RadarAxisValue,
  RadarAxisValue,
  RadarAxisValue,
  RadarAxisValue,
  RadarAxisValue,
]

export interface RadarRenderInput {
  title?: string
  axes: RadarAxes
  size?: number
  transparent?: boolean
}

export interface RadarRenderPlan {
  node: Node
  width: number
  height: number
}

interface Point {
  x: number
  y: number
}

function coordinate(center: Point, radius: number, index: number): Point {
  const angle = -Math.PI / 2 + index * Math.PI / 3
  return {
    x: center.x + radius * Math.cos(angle),
    y: center.y + radius * Math.sin(angle),
  }
}

function formatPoint(point: Point) {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`
}

function polygon(center: Point, radius: number) {
  return Array.from({ length: 6 }, (_, index) => formatPoint(coordinate(center, radius, index))).join(' ')
}

function normalizedAxis(axis: RadarAxisValue) {
  if (!Number.isFinite(axis.value)) throw new TypeError(`Radar axis ${axis.label} must have a finite value`)
  const max = axis.max ?? 10
  if (!Number.isFinite(max) || max <= 0) throw new RangeError(`Radar axis ${axis.label} must have a positive maximum`)
  const value = Math.min(max, Math.max(0, axis.value))
  return { ...axis, value, max }
}

function radarSvg(size: number, axes: readonly ReturnType<typeof normalizedAxis>[]) {
  const center = { x: size / 2, y: size / 2 + size * 0.025 }
  const radius = size * 0.29
  const guidePolygons = [0.2, 0.4, 0.6, 0.8, 1].map((ratio, index) =>
    `<polygon id="radar-ring-${index + 1}" points="${polygon(center, radius * ratio)}" fill="none" stroke="#ffffff" stroke-opacity="${index === 4 ? '0.62' : '0.24'}" stroke-width="${index === 4 ? '2.5' : '1.5'}"/>`,
  ).join('')
  const spokes = Array.from({ length: 6 }, (_, index) => {
    const point = coordinate(center, radius, index)
    return `<line x1="${center.x.toFixed(2)}" y1="${center.y.toFixed(2)}" x2="${point.x.toFixed(2)}" y2="${point.y.toFixed(2)}" stroke="#ffffff" stroke-opacity="0.32" stroke-width="1.5"/>`
  }).join('')
  const dataPoints = axes.map((axis, index) =>
    formatPoint(coordinate(center, radius * axis.value / axis.max, index)),
  ).join(' ')

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
      + `${guidePolygons}${spokes}`
      + `<polygon id="radar-data" points="${dataPoints}" fill="#9f51dc" fill-opacity="0.58" stroke="#ff6ffd" stroke-width="4" stroke-linejoin="round"/>`
      + axes.map((axis, index) => {
        const point = coordinate(center, radius * axis.value / axis.max, index)
        return `<circle cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="5" fill="#f4b942" stroke="#26313e" stroke-width="2"/>`
      }).join('')
      + '</svg>',
  )
}

function axisLabel(
  axis: ReturnType<typeof normalizedAxis>,
  index: number,
  size: number,
) {
  const center = { x: size / 2, y: size / 2 + size * 0.025 }
  const point = coordinate(center, size * 0.38, index)
  return createContainerNode({
    className: 'radar-axis-label',
    attributes: { 'data-axis': String(index + 1) },
    style: {
      position: 'absolute',
      left: point.x - 66,
      top: point.y - 28,
      width: 132,
      height: 56,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      color: '#ffffff',
    },
    children: [
      createTextNode({
        text: axis.label,
        style: {
          width: '100%',
          height: 25,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: 'center',
          fontSize: 16,
          fontWeight: 700,
        },
      }),
      createTextNode({
        text: axis.value.toFixed(2),
        style: { fontSize: 14, fontWeight: 700, color: '#f4b942' },
      }),
    ],
  })
}

export function createRadarRenderPlan(input: RadarRenderInput): RadarRenderPlan {
  if (input.axes.length !== 6) throw new RangeError('Radar requires exactly six axes')
  const size = input.size ?? RADAR_TEMPLATE_SIZE
  if (!Number.isInteger(size) || size < 320 || size > 1_200) {
    throw new RangeError('Radar size must be an integer from 320 to 1200')
  }
  const axes = input.axes.map(normalizedAxis)
  const svg = radarSvg(size, axes)

  return {
    width: size,
    height: size,
    node: createContainerNode({
      id: 'radar-template',
      style: {
        position: 'relative',
        width: size,
        height: size,
        overflow: 'hidden',
        backgroundColor: input.transparent ? 'rgba(0,0,0,0)' : '#26313e',
        color: '#ffffff',
        fontFamily: MAIMAI_RENDER_THEME.fontFamily,
      },
      children: [
        createImageNode({
          className: 'radar-svg',
          src: svg,
          width: size,
          height: size,
          style: { position: 'absolute', left: 0, top: 0, width: size, height: size },
        }),
        createTextNode({
          text: input.title ?? 'Maimai Radar',
          style: {
            position: 'absolute',
            left: 24,
            top: 20,
            width: size - 48,
            height: 42,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            textAlign: 'center',
            fontSize: 28,
            fontWeight: 700,
          },
        }),
        ...axes.map((axis, index) => axisLabel(axis, index, size)),
      ],
    }),
  }
}

export async function renderRadarPlan(
  input: RadarRenderInput,
  renderService: TakumiRenderService,
  signal?: AbortSignal,
) {
  const plan = createRadarRenderPlan(input)
  return renderService.render(plan.node, {
    width: plan.width,
    height: plan.height,
    format: 'png',
  }, signal)
}
