import h from '@satorijs/element'
import {
  sanitizeFallbackMessage,
  type FallbackElement,
  type FallbackMessage,
} from './fallback-message'

const supportedQqMarkdownElementTypes = new Set([
  'qq:rawmarkdown-without-keyboard',
  'qq:rawmarkdown',
  'qq:markdown',
])

export interface QqButtonPermission {
  type: number
}

export interface QqButtonAction {
  type: 1 | 2
  permission: QqButtonPermission
  data: string
  enter: boolean
}

export interface QqButtonRenderData {
  label: string
  style: number
}

export interface QqButton {
  render_data: QqButtonRenderData
  action: QqButtonAction
}

export interface QqButtonRow {
  buttons: QqButton[]
}

export interface QqKeyboard {
  content: {
    rows: QqButtonRow[]
  }
}

export interface QqButtonActionOptions {
  permissionType?: number
  enter?: boolean
}

export interface QqMarkdownParameter {
  key: string
  values: string[]
}

export interface QqTemplateMarkdownOptions {
  templateId?: string
  params: QqMarkdownParameter[]
  fallbackContent: string
  keyboard?: QqKeyboard
}

export interface PagedCallbackButtonOptions {
  page: number
  totalPages: number
  callbackData(page: number): string
  previousLabel?: string
  nextLabel?: string
}

export interface ReplySession {
  platform: string
  send(content: h.Fragment): Promise<unknown>
}

export interface SendReplyOptions {
  compatibilityMode?: boolean
}

export function createQqCommandAction(
  data: string,
  options: QqButtonActionOptions = {},
): QqButtonAction {
  return {
    type: 2,
    permission: { type: options.permissionType ?? 2 },
    data,
    enter: options.enter ?? false,
  }
}

export function createQqCallbackAction(
  data: string,
  options: Omit<QqButtonActionOptions, 'enter'> = {},
): QqButtonAction {
  return {
    type: 1,
    permission: { type: options.permissionType ?? 2 },
    data,
    enter: false,
  }
}

export function createQqButton(
  label: string,
  action: QqButtonAction,
  style = 1,
): QqButton {
  return {
    render_data: { label, style },
    action,
  }
}

export function createQqButtonRow(buttons: readonly QqButton[]): QqButtonRow {
  return { buttons: [...buttons] }
}

export function createQqKeyboard(rows: readonly QqButtonRow[]): QqKeyboard {
  return { content: { rows: [...rows] } }
}

export function createQqNativeMarkdown(content: string, keyboard?: QqKeyboard) {
  if (!keyboard) {
    return h('qq:rawmarkdown-without-keyboard', { content })
  }
  return h('qq:rawmarkdown', {
    markdown: { content },
    keyboard,
  })
}

export function createQqTemplateMarkdown(options: QqTemplateMarkdownOptions) {
  const templateId = options.templateId?.trim()
  if (!templateId) {
    return createQqNativeMarkdown(options.fallbackContent, options.keyboard)
  }
  return h('qq:markdown', {
    markdown: {
      custom_template_id: templateId,
      params: options.params,
    },
    ...(options.keyboard ? { keyboard: options.keyboard } : {}),
  })
}

function escapeInlineCommandLabel(label: string) {
  return label
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\u200B[\u200B')
    .replaceAll(']', '\u200B]\u200B')
}

export function createInlineCommandLink(
  label: string,
  command: string,
  enter = true,
) {
  const url = `mqqapi://aio/inlinecmd?command=${encodeURIComponent(command)}&enter=${enter}&reply=false`
  return `[${escapeInlineCommandLabel(label)}](${url})`
}

export function createPagedCallbackButtons(
  options: PagedCallbackButtonOptions,
): QqButtonRow {
  const buttons: QqButton[] = []
  if (options.page > 1) {
    buttons.push(createQqButton(
      options.previousLabel ?? '上一页',
      createQqCallbackAction(options.callbackData(options.page - 1)),
      0,
    ))
  }
  if (options.page < options.totalPages) {
    buttons.push(createQqButton(
      options.nextLabel ?? '下一页',
      createQqCallbackAction(options.callbackData(options.page + 1)),
      0,
    ))
  }
  return createQqButtonRow(buttons)
}

function createFallbackElement(element: FallbackElement) {
  if (element.type === 'text') return h.text(element.text)
  if (typeof element.data === 'string') return h.image(element.data)
  return h.image(
    Buffer.from(element.data),
    element.mimeType ?? 'application/octet-stream',
  )
}

function containsStreamField(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Reflect.has(value, 'stream')) return true
  if (Array.isArray(value)) return value.some(containsStreamField)
  return Object.values(value).some(containsStreamField)
}

function elementContainsStreamField(element: h): boolean {
  return containsStreamField(element.attrs)
    || element.children.some(elementContainsStreamField)
}

function assertNonStreamingRichElement(rich: unknown): asserts rich is h {
  if (!h.isElement(rich)) {
    throw new TypeError('QQ rich replies must use an explicit Koishi element.')
  }
  if (!supportedQqMarkdownElementTypes.has(rich.type)) {
    throw new TypeError('QQ rich replies must use a supported QQ Markdown element.')
  }
  if (elementContainsStreamField(rich)) {
    throw new TypeError('QQ rich replies must not contain streaming fields.')
  }
}

export async function sendReply(
  session: ReplySession,
  fallback: FallbackElement | FallbackMessage,
  rich?: h,
  options: SendReplyOptions = {},
) {
  const fallbackElements = sanitizeFallbackMessage(fallback)
    .map(createFallbackElement)
  const useRich = session.platform === 'qq'
    && !options.compatibilityMode
    && rich !== undefined
  if (!useRich) return session.send(fallbackElements)
  assertNonStreamingRichElement(rich)
  return session.send(rich)
}
