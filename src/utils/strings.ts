import OpenCC from 'opencc-js'

const toSimplifiedConverter = OpenCC.Converter({ from: 't', to: 'cn' })
const wordSegmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' })

export function toDBC(value: string) {
  return value.normalize('NFKC')
}

export function toSimplified(value: string) {
  return toSimplifiedConverter(value)
    .replaceAll('暁', '晓')
    .replaceAll('菫', '堇')
}

export function normalizeText(value: string) {
  return toSimplified(toDBC(value))
    .toLocaleLowerCase('zh-CN')
    .replace(/[‐‑‒–—―]/g, '-')
    .replace(/[“”„‟「」『』]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
}

export function normalizeSearchText(value: string) {
  return normalizeText(value)
    .replace(/[^\p{L}\p{N}+.%&_'/-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function compactSearchText(value: string) {
  return normalizeSearchText(value).replace(/[^\p{L}\p{N}]+/gu, '')
}

export function tokenizeSearchText(value: string) {
  const normalized = normalizeSearchText(value)
  const tokens = new Set<string>()
  for (const part of normalized.split(' ')) {
    if (!part) continue
    for (const segment of wordSegmenter.segment(part)) {
      if (segment.isWordLike) tokens.add(segment.segment)
    }
  }
  return [...tokens]
}

export function compareText(left: string, right: string) {
  return left.localeCompare(right, 'zh-CN', { sensitivity: 'base', numeric: true })
}
