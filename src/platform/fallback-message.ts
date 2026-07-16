import {
  findCancellationError,
  ProviderBindingRequiredError,
  ProviderNoDataError,
  ProviderNotFoundError,
  ProviderOAuthRequiredError,
  ProviderPrivacyError,
  ProviderUnsupportedError,
} from '../providers/errors'
import {
  QqBindingRequiredError,
  QueryTargetBindingRequiredError,
} from '../services/query-service'

export type QueryErrorCode =
  | 'qq-unbound'
  | 'target-qq-unbound'
  | 'provider-unbound'
  | 'player-not-found'
  | 'privacy-denied'
  | 'privacy-consent-required'
  | 'no-data'
  | 'filter-no-result'
  | 'filter-too-many'
  | 'unsupported'
  | 'oauth-required'
  | 'unknown'

export interface TextFallbackElement {
  type: 'text'
  text: string
}

export interface ImageFallbackElement {
  type: 'image'
  data: string | Buffer | Uint8Array
  mimeType?: string
}

export type FallbackElement = TextFallbackElement | ImageFallbackElement
export type FallbackMessage = readonly FallbackElement[]

export interface QueryErrorMessage extends TextFallbackElement {
  code: QueryErrorCode
}

export interface QueryErrorContext {
  isSelf?: boolean
}

export class FilterNoResultError extends Error {
  constructor(message = 'No records matched the filter.') {
    super(message)
    this.name = 'FilterNoResultError'
  }
}

export class FilterTooManyError extends Error {
  constructor(message = 'Too many records matched the filter.') {
    super(message)
    this.name = 'FilterTooManyError'
  }
}

const messages: Record<QueryErrorCode, string> = {
  'qq-unbound': '为了继续后续查询，请先绑定您的 QQ 号。',
  'target-qq-unbound': '被提及的用户尚未绑定QQ号，无法作为查询目标。',
  'provider-unbound': '您还未绑定查分器。请先绑定查分器。',
  'player-not-found': '您查询的用户不存在。',
  'privacy-denied': '您查询的用户设置了查分器隐私或未同意查分器协议，请检查设置。',
  'privacy-consent-required': '请先前往查分器同意用户协议再进行查询。',
  'no-data': '您似乎尚未导入舞萌DX分数，请查看数据导入教程。',
  'filter-no-result': '在当前筛选条件下未查询到歌曲记录。',
  'filter-too-many': '在当前条件下查询到的曲目过多，请缩小范围。',
  unsupported: '当前查分器不支持该功能。',
  'oauth-required': '该功能需要您在查分器授权BOT访问您的成绩信息。',
  unknown: '查询失败，请重试，或发送“/mai”返回帮助。',
}

function errorMessage(code: QueryErrorCode, text = messages[code]): QueryErrorMessage {
  return { type: 'text', code, text }
}

export function mapQueryError(
  error: unknown,
  context: QueryErrorContext = {},
): QueryErrorMessage {
  const cancellation = findCancellationError(error)
  if (cancellation) throw cancellation
  if (error instanceof QqBindingRequiredError) return errorMessage('qq-unbound')
  if (error instanceof QueryTargetBindingRequiredError) return errorMessage('target-qq-unbound')
  if (error instanceof ProviderBindingRequiredError) return errorMessage('provider-unbound')
  if (error instanceof ProviderNotFoundError) return errorMessage('player-not-found')
  if (error instanceof ProviderPrivacyError) {
    return errorMessage(context.isSelf ? 'privacy-consent-required' : 'privacy-denied')
  }
  if (error instanceof ProviderNoDataError) return errorMessage('no-data')
  if (error instanceof FilterNoResultError) return errorMessage('filter-no-result')
  if (error instanceof FilterTooManyError) return errorMessage('filter-too-many')
  if (error instanceof ProviderUnsupportedError) {
    return errorMessage('unsupported', error.message || messages.unsupported)
  }
  if (error instanceof ProviderOAuthRequiredError) return errorMessage('oauth-required')
  return errorMessage('unknown')
}

function asFallbackElements(message: FallbackElement | FallbackMessage) {
  return Array.isArray(message) ? message : [message]
}

export function sanitizeFallbackMessage(
  message: FallbackElement | FallbackMessage,
): FallbackMessage {
  const elements = asFallbackElements(message)
  for (const element of elements) {
    const validText = element?.type === 'text' && typeof element.text === 'string'
    const validImage = element?.type === 'image' && 'data' in element
    if (!validText && !validImage) {
      throw new TypeError('Fallback messages may contain only text and image elements.')
    }
  }
  return elements as FallbackMessage
}

export interface ReplyPayloadOptions<RichPayload> {
  platform: string
  compatibilityMode: boolean
  fallback: FallbackElement | FallbackMessage
  rich?: RichPayload
}

export function selectReplyPayload<RichPayload>(
  options: ReplyPayloadOptions<RichPayload>,
): FallbackMessage | RichPayload {
  if (options.platform !== 'qq' || options.compatibilityMode || options.rich === undefined) {
    return sanitizeFallbackMessage(options.fallback)
  }
  return options.rich
}

export const resolveReplyPayload = selectReplyPayload
