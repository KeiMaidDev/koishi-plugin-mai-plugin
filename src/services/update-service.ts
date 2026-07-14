import type {
  DivingFishImportRecord,
  DivingFishUpdateResponse,
} from '../providers/diving-fish'
import { LXNS_ENDPOINTS } from '../providers/lxns'
import { CallbackStore } from '../server/callback-store'
import { load } from 'cheerio'
import type { Context } from 'koishi'

const WAHLAP_ORIGIN = 'https://tgk-wcaime.wahlap.com'
const WAHLAP_AUTHORIZE_PATH = '/wc_auth/oauth/authorize/maimai-dx'
const WAHLAP_CALLBACK_PATH = '/wc_auth/oauth/callback/maimai-dx'
const WAHLAP_MOBILE_ORIGIN = 'https://maimai.wahlap.com'
const WAHLAP_RECORD_PATH = '/maimai-mobile/record/musicSort/search/'
const WAHLAP_MAX_RESPONSE_BYTES = 5 * 1024 * 1024
const WAHLAP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/132 Safari/537.36 MicroMessenger/7.0'

export class PublicCallbackUnavailableError extends Error {
  constructor() {
    super('未配置公网回调地址，请设置 publicBaseUrl 或 Koishi Server selfUrl。')
    this.name = 'PublicCallbackUnavailableError'
  }
}

export class UpdateBindingRequiredError extends Error {
  constructor() {
    super('请使用“/绑定水鱼 水鱼成绩导入Token”来设置！')
    this.name = 'UpdateBindingRequiredError'
  }
}

export class UpdateFlowError extends Error {
  constructor(message = '成绩更新流程失败。') {
    super(message)
    this.name = 'UpdateFlowError'
  }
}

export interface UpdateSessionLocator {
  userId: string
  platform: string
  channelId: string
  direct: boolean
  pendingCommand?: string
  send(text: string): Promise<void>
  replay(command: string): Promise<void>
}

interface LxnsState extends UpdateSessionLocator {}
interface DivingFishState extends UpdateSessionLocator {}

export interface UpdateServiceOptions {
  publicBaseUrl: string
  oauth: {
    enabled: boolean
    clientId: string
  }
  lxns: {
    exchangeOAuthCode(userId: string, code: string, redirectUri: string): Promise<unknown>
  }
  bind: {
    getImportToken(userId: string): Promise<string | null>
    setImportToken(userId: string, token: string): Promise<void>
  }
  fetchAuthorizationRedirect(): Promise<string>
  fetchDivingFishRecords(callbackUrl: string): Promise<DivingFishImportRecord[]>
  importDivingFishRecords(
    userId: string,
    records: DivingFishImportRecord[],
    importToken: string,
  ): Promise<DivingFishUpdateResponse>
  lxnsStates?: CallbackStore<LxnsState>
  updateTokens?: CallbackStore<DivingFishState>
}

export interface WahlapResponse {
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}

export interface WahlapRequestOptions {
  headers?: Record<string, string>
  redirect?: 'follow' | 'manual'
}

export interface WahlapRecordFetcherOptions {
  request(url: string, options: WahlapRequestOptions): Promise<WahlapResponse>
}

function safeWahlapUrl(raw: string, allowedOrigins: readonly string[]) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UpdateFlowError('invalid Wahlap redirect')
  }
  if (!allowedOrigins.includes(url.origin) || url.username || url.password) {
    throw new UpdateFlowError('invalid Wahlap redirect')
  }
  return url
}

function headerValues(value: string | string[] | undefined) {
  return Array.isArray(value) ? value : value ? [value] : []
}

const SET_COOKIE_BOUNDARY = /,(?=\s*[!#$%&'*+.^_`|~0-9A-Za-z-]+=)/gu

function splitSetCookie(value: string) {
  if (value.length > 16_384) throw new UpdateFlowError('Wahlap login cookie was unavailable.')
  return value.split(SET_COOKIE_BOUNDARY).map(cookie => cookie.trim())
}

function cookieHeader(headers: WahlapResponse['headers']) {
  const values = headerValues(headers['set-cookie']).flatMap(splitSetCookie)
  if (values.length > 32) throw new UpdateFlowError('Wahlap login cookie was unavailable.')
  const cookies = values.map(value => value.split(';', 1)[0].trim()).filter(value => (
    /^[!#$%&'*+.^_`|~0-9A-Za-z-]+=[^\r\n;]{0,2048}$/.test(value)
  ))
  const result = cookies.join('; ')
  if (!result || result.length > 4_096) throw new UpdateFlowError('Wahlap login cookie was unavailable.')
  return result
}

function iconValue(source: string) {
  const value = source.split('music_icon_').at(-1)?.split('.')[0] ?? ''
  return value === 'back' ? '' : value
}

function parseWahlapRecords(html: string, difficulty: number): DivingFishImportRecord[] {
  if (Buffer.byteLength(html, 'utf8') > WAHLAP_MAX_RESPONSE_BYTES) {
    throw new UpdateFlowError('Wahlap response exceeded the configured size limit.')
  }
  if (html.includes('错误码：')) throw new UpdateFlowError('Wahlap rejected the score request.')
  const $ = load(html)
  const records: DivingFishImportRecord[] = []
  const forms = $("form[action='https://maimai.wahlap.com/maimai-mobile/record/musicDetail/']")
  if (forms.length > 5_000) throw new UpdateFlowError('Wahlap returned too many score records.')
  forms.each((_index, element) => {
    const form = $(element)
    const title = form.find('.music_name_block').first().text().trim()
    const achievements = Number(form.find('.music_score_block.w_112').first().text().replace(/%$/u, '').trim())
    const scoreParts = form.find('.music_score_block.w_190').first().text()
      .split('/')
      .map(value => Number(value.replaceAll(',', '').trim()))
    const kind = form.find('.music_kind_icon').first().attr('src')?.split('/').at(-1)?.split('.')[0]
    const type = kind === 'music_standard' ? 'SD' : kind === 'music_dx' ? 'DX' : null
    const icons = form.find("img[src*='music_icon_']").toArray().map(image => (
      iconValue($(image).attr('src') ?? '')
    ))
    const fs = icons[0] ?? ''
    const fc = icons[1] ?? ''
    if (!title
      || !Number.isFinite(achievements)
      || achievements < 0
      || achievements > 101
      || scoreParts.length !== 2
      || !Number.isSafeInteger(scoreParts[0])
      || scoreParts[0] < 0
      || !type
      || !['', 'fc', 'fcp', 'ap', 'app'].includes(fc)
      || !['', 'sync', 'fs', 'fsp', 'fsd', 'fsdp'].includes(fs)) return
    records.push({
      title,
      achievements,
      dxScore: scoreParts[0],
      fc: fc as DivingFishImportRecord['fc'],
      fs: fs as DivingFishImportRecord['fs'],
      level_index: difficulty,
      type,
    })
  })
  return records
}

export class WahlapRecordFetcher {
  constructor(private readonly options: WahlapRecordFetcherOptions) {}

  async fetch(callbackUrl: string) {
    const callback = safeWahlapUrl(callbackUrl, [WAHLAP_ORIGIN])
    if (callback.pathname !== WAHLAP_CALLBACK_PATH || callback.searchParams.has('token')) {
      throw new UpdateFlowError('invalid Wahlap callback URL')
    }
    const redirect = await this.options.request(callback.href, { redirect: 'manual' })
    const loginLocation = headerValues(redirect.headers.location)[0]
    if (!loginLocation) throw new UpdateFlowError('invalid Wahlap redirect')
    const loginUrl = safeWahlapUrl(loginLocation, [WAHLAP_ORIGIN, WAHLAP_MOBILE_ORIGIN])
    const login = await this.options.request(loginUrl.href, { redirect: 'manual' })
    const cookie = cookieHeader(login.headers)
    const records: DivingFishImportRecord[] = []
    for (let difficulty = 0; difficulty <= 4; difficulty += 1) {
      const page = new URL(WAHLAP_RECORD_PATH, WAHLAP_MOBILE_ORIGIN)
      page.searchParams.set('search', 'A')
      page.searchParams.set('sort', '1')
      page.searchParams.set('playCheck', 'on')
      page.searchParams.set('diff', String(difficulty))
      const response = await this.options.request(page.href, {
        redirect: 'manual',
        headers: { Cookie: cookie, 'User-Agent': WAHLAP_USER_AGENT },
      })
      if (response.status < 200 || response.status >= 300) {
        throw new UpdateFlowError('Wahlap score request failed.')
      }
      records.push(...parseWahlapRecords(response.body, difficulty))
    }
    return records
  }
}

async function boundedResponseText(raw: Response) {
  const declared = Number(raw.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > WAHLAP_MAX_RESPONSE_BYTES) {
    throw new UpdateFlowError('Wahlap response exceeded the configured size limit.')
  }
  if (!raw.body) return ''
  const reader = raw.body.getReader()
  const decoder = new TextDecoder()
  let size = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > WAHLAP_MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new UpdateFlowError('Wahlap response exceeded the configured size limit.')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

function responseCookies(headers: Headers) {
  const extended = headers as Headers & { getSetCookie?: () => string[] }
  const values = extended.getSetCookie?.()
  if (values?.length) return values
  const combined = headers.get('set-cookie')
  return combined ? [combined] : []
}

export function createKoishiWahlapRequester(http: Context['http']) {
  return async (url: string, options: WahlapRequestOptions): Promise<WahlapResponse> => {
    const response = await http<string>(url, {
      method: 'GET',
      headers: options.headers,
      redirect: options.redirect,
      timeout: 60_000,
      validateStatus: () => true,
      responseType: boundedResponseText,
    })
    return {
      status: response.status,
      headers: {
        location: response.headers.get('location') ?? undefined,
        'set-cookie': responseCookies(response.headers),
      },
      body: response.data,
    }
  }
}

function publicBaseUrl(value: string) {
  if (!value) throw new PublicCallbackUnavailableError()
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new PublicCallbackUnavailableError()
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new PublicCallbackUnavailableError()
  }
  url.hash = ''
  url.search = ''
  return url
}

function publicRoute(base: string, path: string) {
  return new URL(path, publicBaseUrl(base)).href
}

function validateCallbackUrl(callbackPath: string) {
  if (!callbackPath.startsWith('/')) throw new UpdateFlowError()
  const callback = new URL(callbackPath, WAHLAP_ORIGIN)
  if (callback.origin !== WAHLAP_ORIGIN || callback.pathname !== WAHLAP_CALLBACK_PATH) {
    throw new UpdateFlowError()
  }
  callback.searchParams.delete('token')
  callback.hash = ''
  return callback.href
}

export class UpdateService {
  private readonly lxnsStates: CallbackStore<LxnsState>
  private readonly updateTokens: CallbackStore<DivingFishState>
  private disposed = false

  constructor(private readonly options: UpdateServiceOptions) {
    this.lxnsStates = options.lxnsStates ?? new CallbackStore<LxnsState>()
    this.updateTokens = options.updateTokens ?? new CallbackStore<DivingFishState>()
  }

  async bindDivingFishToken(userId: string, rawToken: string) {
    const token = rawToken.trim()
    if (!token || token.length > 512) throw new UpdateBindingRequiredError()
    await this.options.bind.setImportToken(userId, token)
  }

  async beginLxnsOAuth(session: UpdateSessionLocator) {
    this.assertActive()
    if (!this.options.oauth.enabled || !this.options.oauth.clientId) {
      throw new PublicCallbackUnavailableError()
    }
    const redirectUri = publicRoute(this.options.publicBaseUrl, '/mai-plugin/lxns/callback')
    const state = this.lxnsStates.issue(session)
    const authorize = new URL(`${LXNS_ENDPOINTS.oauth}/authorize`)
    authorize.searchParams.set('response_type', 'code')
    authorize.searchParams.set('client_id', this.options.oauth.clientId)
    authorize.searchParams.set('redirect_uri', redirectUri)
    authorize.searchParams.set('state', state)
    return authorize.href
  }

  async completeLxnsOAuth(state: string, code: string) {
    this.assertActive()
    const session = this.lxnsStates.consume(state)
    const redirectUri = publicRoute(this.options.publicBaseUrl, '/mai-plugin/lxns/callback')
    try {
      await this.options.lxns.exchangeOAuthCode(session.userId, code, redirectUri)
    } catch (error) {
      await session.send('落雪授权绑定失败，请重试。')
      throw error
    }
    await session.send('落雪授权绑定成功。')
    if (session.pendingCommand) await session.replay(session.pendingCommand)
  }

  async beginDivingFishUpdate(session: UpdateSessionLocator) {
    this.assertActive()
    const updateRoute = publicRoute(this.options.publicBaseUrl, '/mai-plugin/update')
    if (!await this.options.bind.getImportToken(session.userId)) {
      throw new UpdateBindingRequiredError()
    }
    const token = this.updateTokens.issue(session)
    const url = new URL(updateRoute)
    url.searchParams.set('token', token)
    return url.href
  }

  async createUpdateRedirect(token: string) {
    this.assertActive()
    this.updateTokens.peek(token)
    const upstream = new URL(await this.options.fetchAuthorizationRedirect())
    if (upstream.origin !== WAHLAP_ORIGIN || upstream.pathname !== WAHLAP_AUTHORIZE_PATH) {
      throw new UpdateFlowError('授权服务器返回了无效的重定向地址。')
    }
    const callback = new URL(publicRoute(this.options.publicBaseUrl, WAHLAP_CALLBACK_PATH))
    callback.searchParams.set('token', token)
    upstream.searchParams.set('redirect_uri', callback.href)
    return upstream.href
  }

  async completeDivingFishUpdate(token: string, callbackPath: string) {
    this.assertActive()
    const session = this.updateTokens.consume(token)
    const callbackUrl = validateCallbackUrl(callbackPath)
    const importToken = await this.options.bind.getImportToken(session.userId)
    if (!importToken) {
      await session.send('水鱼成绩导入Token已失效，请重新绑定。')
      throw new UpdateBindingRequiredError()
    }
    await session.send('正在爬取数据中……')
    try {
      const records = await this.options.fetchDivingFishRecords(callbackUrl)
      const result = await this.options.importDivingFishRecords(
        session.userId,
        records,
        importToken,
      )
      await session.send(`更新成功，已更新${result.updates + result.creates}条记录。`)
    } catch (error) {
      await session.send('更新失败，请稍后重试。')
      throw error
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.lxnsStates.dispose()
    this.updateTokens.dispose()
  }

  private assertActive() {
    if (this.disposed) throw new UpdateFlowError('成绩更新服务已停止。')
  }
}
