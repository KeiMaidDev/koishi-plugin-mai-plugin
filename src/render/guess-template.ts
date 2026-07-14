import type { Node } from '@takumi-rs/helpers'
import type { MusicInfo } from '../domain/music'
import { resolvePackageAssetPath } from './assets'
import { createContainerNode, createImageNode, createTextNode } from './nodes'
import type { TakumiRenderService } from './renderer'
import { MAIMAI_RENDER_THEME } from './theme'

export const GUESS_CROP_SIZE = Object.freeze({ width: 420, height: 420 })
export const GUESS_FINAL_SIZE = Object.freeze({ width: 900, height: 520 })

export interface GuessCoverSource {
  coverPath(resourceId: number): string
}

export interface GuessCropRenderInput {
  contextId: string
  music: MusicInfo
  seed: string
}

export interface GuessFinalRenderInput {
  music: MusicInfo
  title: string
  description: string
}

export interface GuessRenderPlan {
  node: Node
  width: number
  height: number
}

const FALLBACK_COVER = resolvePackageAssetPath('fallback/cover.png')
const CROP_IMAGE_SIZE = 900

function hashSeed(value: string) {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function deterministicGuessCrop(seed: string) {
  const maximum = CROP_IMAGE_SIZE - GUESS_CROP_SIZE.width
  const xHash = hashSeed(`${seed}:x`)
  const yHash = hashSeed(`${seed}:y`)
  return {
    x: xHash % (maximum + 1),
    y: yHash % (maximum + 1),
  }
}

function cropNode(cover: Buffer, seed: string) {
  const crop = deterministicGuessCrop(seed)
  return createContainerNode({
    id: 'guess-crop-template',
    attributes: {
      'data-crop-x': String(crop.x),
      'data-crop-y': String(crop.y),
    },
    style: {
      width: GUESS_CROP_SIZE.width,
      height: GUESS_CROP_SIZE.height,
      position: 'relative',
      overflow: 'hidden',
      backgroundColor: '#20252c',
      color: '#ffffff',
      fontFamily: MAIMAI_RENDER_THEME.fontFamily,
    },
    children: [
      createImageNode({
        className: 'guess-crop-cover',
        src: cover,
        width: CROP_IMAGE_SIZE,
        height: CROP_IMAGE_SIZE,
        style: {
          position: 'absolute',
          left: -crop.x,
          top: -crop.y,
          width: CROP_IMAGE_SIZE,
          height: CROP_IMAGE_SIZE,
          objectFit: 'cover',
        },
      }),
      createContainerNode({
        style: {
          position: 'absolute',
          left: 0,
          top: 348,
          width: GUESS_CROP_SIZE.width,
          height: 72,
          paddingLeft: 22,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: 'rgba(20, 25, 31, 0.84)',
          borderTop: '4px solid #00a8a8',
        },
        children: [
          createTextNode({
            text: '舞萌猜歌',
            style: { fontSize: 24, fontWeight: 700, color: '#ffffff' },
          }),
          createTextNode({
            text: '封面局部提示',
            style: { marginTop: 2, fontSize: 15, color: '#d3e7e7' },
          }),
        ],
      }),
    ],
  })
}

function finalNode(input: GuessFinalRenderInput, cover: Buffer) {
  return createContainerNode({
    id: 'guess-final-template',
    style: {
      width: GUESS_FINAL_SIZE.width,
      height: GUESS_FINAL_SIZE.height,
      padding: 36,
      display: 'flex',
      flexDirection: 'row',
      gap: 34,
      overflow: 'hidden',
      backgroundColor: MAIMAI_RENDER_THEME.colors.background,
      color: MAIMAI_RENDER_THEME.colors.text,
      fontFamily: MAIMAI_RENDER_THEME.fontFamily,
    },
    children: [
      createImageNode({
        className: 'guess-final-cover',
        src: cover,
        width: 448,
        height: 448,
        style: {
          width: 448,
          height: 448,
          objectFit: 'cover',
          borderRadius: 6,
          border: '2px solid #cbd4dc',
          flexShrink: 0,
        },
      }),
      createContainerNode({
        style: {
          width: 346,
          height: 448,
          paddingLeft: 24,
          paddingRight: 8,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          overflow: 'hidden',
          borderLeft: '8px solid #00a8a8',
          backgroundColor: '#ffffff',
        },
        children: [
          createTextNode({
            text: input.title,
            style: {
              width: '100%',
              maxHeight: 74,
              overflow: 'hidden',
              fontSize: 28,
              fontWeight: 700,
              lineHeight: 1.2,
              color: '#137e91',
            },
          }),
          createTextNode({
            text: input.music.name,
            style: {
              width: '100%',
              maxHeight: 132,
              marginTop: 28,
              overflow: 'hidden',
              fontSize: 38,
              fontWeight: 700,
              lineHeight: 1.16,
              color: '#20242c',
            },
          }),
          createTextNode({
            text: `ID ${input.music.id}  ·  BPM ${input.music.bpm}`,
            style: { marginTop: 22, fontSize: 18, fontWeight: 700, color: '#596675' },
          }),
          createTextNode({
            text: input.description,
            style: {
              width: '100%',
              maxHeight: 108,
              marginTop: 18,
              overflow: 'hidden',
              fontSize: 18,
              lineHeight: 1.45,
              color: '#596675',
            },
          }),
        ],
      }),
    ],
  })
}

export async function createGuessCropRenderPlan(
  input: GuessCropRenderInput,
  renderService: TakumiRenderService,
  data: GuessCoverSource,
): Promise<GuessRenderPlan> {
  const cover = await renderService.loadAsset(data.coverPath(input.music.resourceId), FALLBACK_COVER)
  return {
    width: GUESS_CROP_SIZE.width,
    height: GUESS_CROP_SIZE.height,
    node: cropNode(cover, `${input.contextId}:${input.music.id}:${input.seed}`),
  }
}

export async function createGuessFinalRenderPlan(
  input: GuessFinalRenderInput,
  renderService: TakumiRenderService,
  data: GuessCoverSource,
): Promise<GuessRenderPlan> {
  const cover = await renderService.loadAsset(data.coverPath(input.music.resourceId), FALLBACK_COVER)
  return {
    width: GUESS_FINAL_SIZE.width,
    height: GUESS_FINAL_SIZE.height,
    node: finalNode(input, cover),
  }
}

export class TakumiGuessRenderer {
  constructor(
    private readonly renderService: TakumiRenderService,
    private readonly data: GuessCoverSource,
  ) {}

  async renderCrop(input: GuessCropRenderInput, signal?: AbortSignal) {
    const plan = await createGuessCropRenderPlan(input, this.renderService, this.data)
    return this.renderService.render(plan.node, {
      width: plan.width,
      height: plan.height,
      format: 'png',
    }, signal)
  }

  async renderFinal(input: GuessFinalRenderInput, signal?: AbortSignal) {
    const plan = await createGuessFinalRenderPlan(input, this.renderService, this.data)
    return this.renderService.render(plan.node, {
      width: plan.width,
      height: plan.height,
      format: 'png',
    }, signal)
  }
}
