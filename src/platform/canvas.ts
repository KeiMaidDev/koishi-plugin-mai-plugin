export interface CanvasImageResource {
  readonly naturalWidth: number
  readonly naturalHeight: number
  dispose(): Promise<void>
}

export interface CanvasSurface {
  getContext(type: '2d'): {
    drawImage(
      image: CanvasImageResource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number,
    ): void
  }
  toBuffer(type: 'image/png'): Promise<Buffer>
  dispose(): Promise<void>
}

export interface CanvasService {
  loadImage(source: string | URL | Buffer | ArrayBufferLike): Promise<CanvasImageResource>
  createCanvas(width: number, height: number): Promise<CanvasSurface>
}

function imageDimensions(image: CanvasImageResource) {
  const { naturalWidth: width, naturalHeight: height } = image
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
    throw new RangeError('Canvas image dimensions must be positive integers.')
  }
  return { width, height }
}

export async function readCanvasImageDimensions(
  canvas: Pick<CanvasService, 'loadImage'>,
  source: string | URL | Buffer | ArrayBufferLike,
) {
  const image = await canvas.loadImage(source)
  try {
    return imageDimensions(image)
  } finally {
    await image.dispose()
  }
}

export async function createSquarePngThumbnail(
  canvasService: CanvasService,
  source: string | URL | Buffer | ArrayBufferLike,
  size: number,
) {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError('Canvas thumbnail size must be a positive integer.')
  }
  const image = await canvasService.loadImage(source)
  let canvas: CanvasSurface | undefined
  try {
    const { width, height } = imageDimensions(image)
    const cropSize = Math.min(width, height)
    const sourceX = (width - cropSize) / 2
    const sourceY = (height - cropSize) / 2
    canvas = await canvasService.createCanvas(size, size)
    canvas.getContext('2d').drawImage(
      image,
      sourceX,
      sourceY,
      cropSize,
      cropSize,
      0,
      0,
      size,
      size,
    )
    return await canvas.toBuffer('image/png')
  } finally {
    await Promise.allSettled([
      image.dispose(),
      canvas?.dispose(),
    ])
  }
}
