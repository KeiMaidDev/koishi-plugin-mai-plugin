import type {
  ContainerNode,
  ImageNode,
  Node,
  TextNode,
} from '@takumi-rs/helpers'

type ContainerNodeInput = Omit<ContainerNode, 'type'> | ContainerNode
type TextNodeInput = Omit<TextNode, 'type'> | TextNode
type ImageNodeInput = Omit<ImageNode, 'type'> | ImageNode

function cloneValue<T>(value: T): T {
  if (value instanceof ArrayBuffer) return value.slice(0) as T
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    return Uint8Array.from(bytes) as T
  }
  if (Array.isArray(value)) return value.map(cloneValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, cloneValue(nested)]),
    ) as T
  }
  return value
}

function freezeNodeTree<T>(value: T): T {
  if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return value
  }
  for (const nested of Object.values(value)) freezeNodeTree(nested)
  return Object.freeze(value)
}

function finalizeNode<T extends Node>(node: T): T {
  return process.env.NODE_ENV === 'test' ? freezeNodeTree(node) : node
}

export function createContainerNode(input: ContainerNodeInput): ContainerNode {
  const node = cloneValue(input)
  return finalizeNode({ ...node, type: 'container' })
}

export function createTextNode(input: TextNodeInput): TextNode {
  const node = cloneValue(input)
  return finalizeNode({ ...node, type: 'text' })
}

export function createImageNode(input: ImageNodeInput): ImageNode {
  const node = cloneValue(input)
  return finalizeNode({ ...node, type: 'image' })
}
