import sharp from 'sharp'

export interface CompareRegion {
  name: string
  left: number
  top: number
  width: number
  height: number
}

export interface CompareImagesOptions {
  threshold?: number
  channelTolerance?: number
  regions?: readonly CompareRegion[]
}

export interface RegionComparison extends CompareRegion {
  changedPixels: number
  totalPixels: number
  changedPixelRatio: number
  pass: boolean
}

export interface ImageComparison {
  pass: boolean
  width: number
  height: number
  changedPixels: number
  totalPixels: number
  changedPixelRatio: number
  threshold: number
  channelTolerance: number
  regions: RegionComparison[]
}

function ratio(value: number, total: number) {
  return Number((value / total).toFixed(8))
}

function validThreshold(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError('Image comparison threshold must be between 0 and 1.')
  }
  return value
}

function validTolerance(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError('Image channel tolerance must be an integer between 0 and 255.')
  }
  return value
}

function validRegion(region: CompareRegion, width: number, height: number) {
  const values = [region.left, region.top, region.width, region.height]
  if (!region.name || values.some(value => !Number.isInteger(value))) {
    throw new RangeError('Image comparison regions require a name and integer coordinates.')
  }
  if (region.left < 0 || region.top < 0 || region.width < 1 || region.height < 1
    || region.left + region.width > width || region.top + region.height > height) {
    throw new RangeError(`Image comparison region "${region.name}" is outside the image.`)
  }
  return region
}

function pixelChanged(
  actual: Buffer,
  expected: Buffer,
  offset: number,
  channels: number,
  tolerance: number,
) {
  for (let channel = 0; channel < channels; channel += 1) {
    if (Math.abs(actual[offset + channel] - expected[offset + channel]) > tolerance) return true
  }
  return false
}

export async function compareImages(
  actualPath: string,
  expectedPath: string,
  options: CompareImagesOptions = {},
): Promise<ImageComparison> {
  const threshold = validThreshold(options.threshold ?? 0.005)
  const channelTolerance = validTolerance(options.channelTolerance ?? 0)
  const [actual, expected] = await Promise.all([
    sharp(actualPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expectedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ])
  if (actual.info.width !== expected.info.width
    || actual.info.height !== expected.info.height
    || actual.info.channels !== expected.info.channels) {
    throw new Error(
      `Image dimensions differ: actual ${actual.info.width}x${actual.info.height}x${actual.info.channels}, `
      + `expected ${expected.info.width}x${expected.info.height}x${expected.info.channels}.`,
    )
  }
  const width = actual.info.width
  const height = actual.info.height
  const channels = actual.info.channels
  const totalPixels = width * height
  let changedPixels = 0
  for (let offset = 0; offset < actual.data.length; offset += channels) {
    if (pixelChanged(actual.data, expected.data, offset, channels, channelTolerance)) changedPixels += 1
  }
  const regions = (options.regions ?? []).map(rawRegion => {
    const region = validRegion(rawRegion, width, height)
    let changed = 0
    for (let y = region.top; y < region.top + region.height; y += 1) {
      for (let x = region.left; x < region.left + region.width; x += 1) {
        const offset = (y * width + x) * channels
        if (pixelChanged(actual.data, expected.data, offset, channels, channelTolerance)) changed += 1
      }
    }
    const total = region.width * region.height
    const exactChangedPixelRatio = changed / total
    const changedPixelRatio = ratio(changed, total)
    return {
      ...region,
      changedPixels: changed,
      totalPixels: total,
      changedPixelRatio,
      pass: exactChangedPixelRatio <= threshold,
    }
  })
  const exactChangedPixelRatio = changedPixels / totalPixels
  const changedPixelRatio = ratio(changedPixels, totalPixels)
  return {
    pass: exactChangedPixelRatio <= threshold && regions.every(region => region.pass),
    width,
    height,
    changedPixels,
    totalPixels,
    changedPixelRatio,
    threshold,
    channelTolerance,
    regions,
  }
}

function optionValue(argumentsList: string[], name: string, fallback: string) {
  const index = argumentsList.indexOf(name)
  if (index < 0) return fallback
  const value = argumentsList[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`)
  argumentsList.splice(index, 2)
  return value
}

function regionValues(argumentsList: string[]) {
  const regions: CompareRegion[] = []
  while (argumentsList.includes('--region')) {
    const index = argumentsList.indexOf('--region')
    const value = argumentsList[index + 1]
    if (!value) throw new Error('--region requires name:left,top,width,height.')
    argumentsList.splice(index, 2)
    const separator = value.indexOf(':')
    const coordinates = value.slice(separator + 1).split(',').map(Number)
    if (separator < 1 || coordinates.length !== 4) {
      throw new Error('--region requires name:left,top,width,height.')
    }
    regions.push({
      name: value.slice(0, separator),
      left: coordinates[0],
      top: coordinates[1],
      width: coordinates[2],
      height: coordinates[3],
    })
  }
  return regions
}

async function main() {
  const argumentsList = process.argv.slice(2)
  const threshold = Number(optionValue(argumentsList, '--threshold', '0.005'))
  const channelTolerance = Number(optionValue(argumentsList, '--channel-tolerance', '0'))
  const regions = regionValues(argumentsList)
  if (argumentsList.length !== 2 || argumentsList.some(value => value.startsWith('--'))) {
    throw new Error(
      'Usage: compare-images <actual.png> <expected.png> '
      + '[--threshold 0.005] [--channel-tolerance 0] '
      + '[--region name:left,top,width,height]',
    )
  }
  const comparison = await compareImages(argumentsList[0], argumentsList[1], {
    threshold,
    channelTolerance,
    regions,
  })
  process.stdout.write(`${JSON.stringify(comparison, null, 2)}\n`)
  if (!comparison.pass) process.exitCode = 1
}

const directExecution = !process.env.VITEST
  && process.argv.some(argument => /(?:^|[\\/])compare-images\.ts$/u.test(argument))

if (directExecution) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
