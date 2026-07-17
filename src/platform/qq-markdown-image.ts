import h from '@satorijs/element'
import sharp from 'sharp'
import { createQqNativeMarkdown, type QqKeyboard } from './qq-message'

export interface AssetTransformer {
  transform(content: string): Promise<string>
}

export interface QqMarkdownImageOptions {
  image: Buffer | Uint8Array
  alt: string
  keyboard: QqKeyboard
  assets: AssetTransformer
}

function assertDimensions(width: number, height: number) {
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('QQ Markdown image dimensions must be positive integers.')
  }
}

function parsePublicImageUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new TypeError('QQ Markdown images require an absolute HTTP(S) URL.')
  }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new TypeError('QQ Markdown images require an absolute HTTP(S) URL without credentials.')
  }
  return url
}

export function createQqMarkdownImageContent(url: string, width: number, height: number, alt: string) {
  assertDimensions(width, height)
  if (!/^B(?:15|25|35|40|50)$/.test(alt)) {
    throw new TypeError('QQ Markdown image alt text must be a supported Rating label.')
  }
  const serializedUrl = parsePublicImageUrl(url)
    .toString()
    .replaceAll('(', '%28')
    .replaceAll(')', '%29')
  return `![${alt} #${width}px #${height}px](${serializedUrl})`
}

function transformedImageUrl(content: string) {
  const elements = h.parse(content)
  const nonEmptyElements = elements.filter(element => (
    element.type !== 'text' || String(element.attrs.content ?? '').trim()
  ))
  if (nonEmptyElements.length !== 1 || nonEmptyElements[0].type !== 'img') {
    throw new TypeError('Assets transformation must return exactly one image.')
  }
  const image = nonEmptyElements[0]
  if (image.children.length || typeof image.attrs.src !== 'string') {
    throw new TypeError('Assets transformation returned an invalid image.')
  }
  return parsePublicImageUrl(image.attrs.src).toString()
}

export async function createQqMarkdownImage(options: QqMarkdownImageOptions) {
  const image = Buffer.from(options.image)
  const metadata = await sharp(image).metadata()
  const { width, height } = metadata
  assertDimensions(width ?? NaN, height ?? NaN)
  const transformed = await options.assets.transform(h.image(image, 'image/png').toString())
  const content = createQqMarkdownImageContent(
    transformedImageUrl(transformed),
    width as number,
    height as number,
    options.alt,
  )
  return createQqNativeMarkdown(content, options.keyboard)
}
