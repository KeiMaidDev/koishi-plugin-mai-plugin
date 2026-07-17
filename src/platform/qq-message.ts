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

export type QqButtonPermission = { type: 2 }

interface QqButtonActionBase {
  permission: QqButtonPermission
  data: string
  unsupport_tips: string
}

export interface QqUrlButtonAction extends QqButtonActionBase {
  type: 0
}

export interface QqCallbackButtonAction extends QqButtonActionBase {
  type: 1
}

export interface QqCommandButtonAction extends QqButtonActionBase {
  type: 2
  reply: false
  enter: boolean
}

export type QqButtonAction =
  | QqUrlButtonAction
  | QqCallbackButtonAction
  | QqCommandButtonAction

export interface QqButtonRenderData {
  label: string
  visited_label: string
  style: 0 | 1
}

export interface QqButton {
  id: string
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
  unsupportTips?: string
}

export interface QqCommandButtonActionOptions extends QqButtonActionOptions {
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
  options: QqCommandButtonActionOptions = {},
): QqCommandButtonAction {
  return {
    type: 2,
    permission: { type: 2 },
    data: commandData(data),
    unsupport_tips: resolveUnsupportTips(
      options.unsupportTips,
      '请在聊天中手动执行正文中的命令。',
    ),
    reply: false,
    enter: options.enter ?? false,
  }
}

export function createQqCallbackAction(
  data: string,
  options: QqButtonActionOptions = {},
): QqCallbackButtonAction {
  return {
    type: 1,
    permission: { type: 2 },
    data: nonEmpty(data, 'QQ callback data'),
    unsupport_tips: resolveUnsupportTips(options.unsupportTips),
  }
}

export function createQqUrlAction(
  target: string,
  options: QqButtonActionOptions = {},
): QqUrlButtonAction {
  let url: URL
  try {
    url = new URL(target)
  } catch {
    throw new TypeError('QQ URL buttons require an absolute HTTPS URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new TypeError('QQ URL buttons require an absolute HTTPS URL.')
  }
  return {
    type: 0,
    permission: { type: 2 },
    data: url.href,
    unsupport_tips: resolveUnsupportTips(
      options.unsupportTips,
      '请复制正文中的 HTTPS 链接后打开。',
    ),
  }
}

export function createQqButton(
  id: string,
  label: string,
  action: QqButtonAction,
  style: 0 | 1 = 1,
  visitedLabel = label,
): QqButton {
  if (style !== 0 && style !== 1) {
    throw new TypeError('QQ button style must be 0 or 1.')
  }
  return {
    id: nonEmpty(id, 'QQ button ID'),
    render_data: {
      label: nonEmpty(label, 'QQ button label'),
      visited_label: nonEmpty(visitedLabel, 'QQ button visited label'),
      style,
    },
    action,
  }
}

export function createQqButtonRow(buttons: readonly QqButton[]): QqButtonRow {
  if (buttons.length < 1 || buttons.length > 5) {
    throw new RangeError('QQ button rows must contain 1 to 5 buttons.')
  }
  return { buttons: [...buttons] }
}

export function createQqKeyboard(rows: readonly QqButtonRow[]): QqKeyboard {
  if (rows.length < 1 || rows.length > 5) {
    throw new RangeError('QQ keyboards must contain 1 to 5 rows.')
  }
  const ids = new Set<string>()
  for (const row of rows) {
    if (row.buttons.length < 1 || row.buttons.length > 5) {
      throw new RangeError('QQ button rows must contain 1 to 5 buttons.')
    }
    for (const button of row.buttons) {
      if (ids.has(button.id)) throw new TypeError('QQ button IDs must be unique within a keyboard.')
      ids.add(button.id)
    }
  }
  return { content: { rows: [...rows] } }
}

export function createQqNativeMarkdown(content: string, keyboard?: QqKeyboard) {
  nonEmpty(content, 'QQ raw markdown content')
  if (!keyboard) {
    return h('qq:rawmarkdown-without-keyboard', { content })
  }
  return h('qq:rawmarkdown', {
    markdown: { content },
    keyboard,
  })
}

function nonEmpty(value: string, field: string) {
  const normalized = value.trim()
  if (!normalized) throw new TypeError(`${field} must be non-empty.`)
  return normalized
}

function commandData(data: string) {
  if (!data.trim()) throw new TypeError('QQ command data must be non-empty.')
  if (data !== data.trimStart()) {
    throw new TypeError('QQ command data must not begin with whitespace.')
  }
  if (/[\r\n]/u.test(data)) throw new TypeError('QQ command data must be a single line.')
  return data
}

function resolveUnsupportTips(
  tips: string | undefined,
  fallback = '当前客户端不支持此按钮。',
) {
  return tips === undefined ? fallback : nonEmpty(tips, 'QQ button unsupported tips')
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
      `page-${options.page - 1}`,
      options.previousLabel ?? '上一页',
      createQqCallbackAction(options.callbackData(options.page - 1)),
      0,
    ))
  }
  if (options.page < options.totalPages) {
    buttons.push(createQqButton(
      `page-${options.page + 1}`,
      options.nextLabel ?? '下一页',
      createQqCallbackAction(options.callbackData(options.page + 1)),
      0,
    ))
  }
  return buttons.length ? createQqButtonRow(buttons) : { buttons }
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
