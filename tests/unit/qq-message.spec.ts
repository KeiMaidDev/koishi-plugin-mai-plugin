import h from '@satorijs/element'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src/index'

interface NativeMarkdownFactory {
  (content: string, keyboard?: {
    content: {
      rows: Array<{
        buttons: Array<{
          render_data: { label: string, style: number }
          action: {
            type: number
            permission: { type: number }
            data: string
            enter: boolean
          }
        }>
      }>
    }
  }): h
}

type TestAction = {
  type: number
  permission: { type: number }
  data: string
  enter: boolean
}

type TestButton = {
  render_data: { label: string, style: number }
  action: TestAction
}

type TestRow = { buttons: TestButton[] }
type TestKeyboard = { content: { rows: TestRow[] } }

type TestDispatchContext = {
  userId: string
  channelId: string
  authority?: number
  permissions?: readonly string[]
}

type TestDispatchResult =
  | { ok: true, kind: string, value: unknown }
  | { ok: false, reason: string }

type TestCallbackRegistration = {
  kind: string
  payload: unknown
  expectedUserId: string
  expectedChannelId: string
  ttlMs?: number
  requiredAuthority?: number
  requiredPermission?: string
  handler(payload: any, context: TestDispatchContext): unknown | Promise<unknown>
}

type TestPaginationPayload =
  | { mode: 'search', query: string, page: number }
  | { mode: 'level', filter: string, page: number }
  | { mode: 'score-list', filter: string, page: number }

type TestRouter = {
  readonly size: number
  register(options: TestCallbackRegistration): string
  registerPagination(options: Omit<TestCallbackRegistration, 'kind' | 'payload'> & {
    payload: TestPaginationPayload
  }): string
  dispatch(data: unknown, context: TestDispatchContext): Promise<TestDispatchResult>
  clear(): void
}

function task10Api() {
  return plugin as unknown as {
    createQqNativeMarkdown?: NativeMarkdownFactory
    createQqCommandAction?: (data: string, options?: {
      enter?: boolean
      permissionType?: number
    }) => TestAction
    createQqCallbackAction?: (data: string, options?: {
      permissionType?: number
    }) => TestAction
    createQqButton?: (label: string, action: TestAction, style?: number) => TestButton
    createQqButtonRow?: (buttons: readonly TestButton[]) => TestRow
    createQqKeyboard?: (rows: readonly TestRow[]) => TestKeyboard
    createQqTemplateMarkdown?: (options: {
      templateId?: string
      params: Array<{ key: string, values: string[] }>
      fallbackContent: string
      keyboard?: TestKeyboard
    }) => h
    createInlineCommandLink?: (label: string, command: string, enter?: boolean) => string
    createPagedCallbackButtons?: (options: {
      page: number
      totalPages: number
      callbackData: (page: number) => string
      previousLabel?: string
      nextLabel?: string
    }) => TestRow
    sendReply?: (
      session: { platform: string, send(content: unknown): Promise<unknown> },
      fallback: unknown,
      rich?: h,
      options?: { compatibilityMode?: boolean },
    ) => Promise<unknown>
    CommandCallbackRouter?: new (options?: {
      capacity?: number
      ttlMs?: number
      now?: () => number
      randomBytes?: (size: number) => Uint8Array
    }) => TestRouter
  }
}

function requireFactory<T>(factory: T | undefined, name: string): T {
  expect(factory, `${name} must be exported`).toBeTypeOf('function')
  return factory as T
}

function deterministicRandomBytes() {
  let next = 0
  return (size: number) => Buffer.alloc(size, ++next)
}

function createRouter(options: ConstructorParameters<NonNullable<ReturnType<typeof task10Api>['CommandCallbackRouter']>>[0] = {}) {
  const Router = requireFactory(task10Api().CommandCallbackRouter, 'CommandCallbackRouter')
  return new Router({ randomBytes: deterministicRandomBytes(), ...options })
}

describe('QQ native Markdown elements', () => {
  it('uses the exact no-keyboard element and never enables streaming', () => {
    const createQqNativeMarkdown = requireFactory(
      task10Api().createQqNativeMarkdown,
      'createQqNativeMarkdown',
    )

    const element = createQqNativeMarkdown('# result')

    expect(element.type).toBe('qq:rawmarkdown-without-keyboard')
    expect(element.attrs).toEqual({ content: '# result' })
    expect(element.attrs).not.toHaveProperty('stream')
  })

  it('uses complete markdown and keyboard objects when buttons are present', () => {
    const createQqNativeMarkdown = requireFactory(
      task10Api().createQqNativeMarkdown,
      'createQqNativeMarkdown',
    )
    const keyboard = {
      content: {
        rows: [{
          buttons: [{
            render_data: { label: 'Next', style: 1 },
            action: {
              type: 2,
              permission: { type: 2 },
              data: '/mai search next',
              enter: true,
            },
          }],
        }],
      },
    }

    const element = createQqNativeMarkdown('# result', keyboard)

    expect(element.type).toBe('qq:rawmarkdown')
    expect(element.attrs).toEqual({
      markdown: { content: '# result' },
      keyboard,
    })
    expect(element.attrs).not.toHaveProperty('stream')
    expect(element.attrs.markdown).not.toHaveProperty('stream')
  })

  it('builds exact command, callback, button, row, and keyboard payloads', () => {
    const api = task10Api()
    const createQqCommandAction = requireFactory(api.createQqCommandAction, 'createQqCommandAction')
    const createQqCallbackAction = requireFactory(api.createQqCallbackAction, 'createQqCallbackAction')
    const createQqButton = requireFactory(api.createQqButton, 'createQqButton')
    const createQqButtonRow = requireFactory(api.createQqButtonRow, 'createQqButtonRow')
    const createQqKeyboard = requireFactory(api.createQqKeyboard, 'createQqKeyboard')

    const command = createQqCommandAction('/mai info 123', { enter: true })
    const callback = createQqCallbackAction('mai:opaque-token')
    const row = createQqButtonRow([
      createQqButton('Run', command, 1),
      createQqButton('Next', callback, 0),
    ])

    expect(command).toEqual({
      type: 2,
      permission: { type: 2 },
      data: '/mai info 123',
      enter: true,
    })
    expect(callback).toEqual({
      type: 1,
      permission: { type: 2 },
      data: 'mai:opaque-token',
      enter: false,
    })
    expect(createQqKeyboard([row])).toEqual({
      content: {
        rows: [{
          buttons: [
            { render_data: { label: 'Run', style: 1 }, action: command },
            { render_data: { label: 'Next', style: 0 }, action: callback },
          ],
        }],
      },
    })
  })

  it('uses template Markdown only for a non-empty template ID and otherwise preserves buttons', () => {
    const api = task10Api()
    const createQqTemplateMarkdown = requireFactory(
      api.createQqTemplateMarkdown,
      'createQqTemplateMarkdown',
    )
    const createQqKeyboard = requireFactory(api.createQqKeyboard, 'createQqKeyboard')
    const keyboard = createQqKeyboard([])
    const params = [{ key: 'text1', values: ['result'] }]

    const template = createQqTemplateMarkdown({
      templateId: ' template-1 ',
      params,
      fallbackContent: '# fallback',
      keyboard,
    })
    expect(template.type).toBe('qq:markdown')
    expect(template.attrs).toEqual({
      markdown: {
        custom_template_id: 'template-1',
        params,
      },
      keyboard,
    })
    expect(JSON.stringify(template.attrs)).not.toContain('stream')

    const fallback = createQqTemplateMarkdown({
      templateId: '   ',
      params,
      fallbackContent: '# fallback',
      keyboard,
    })
    expect(fallback.type).toBe('qq:rawmarkdown')
    expect(fallback.attrs).toEqual({
      markdown: { content: '# fallback' },
      keyboard,
    })
  })

  it('encodes the full inline command and escapes Markdown brackets in its label', () => {
    const createInlineCommandLink = requireFactory(
      task10Api().createInlineCommandLink,
      'createInlineCommandLink',
    )

    expect(createInlineCommandLink('Song [DX]', '/mai search A&B [DX]', false)).toBe(
      '[Song \u200B[\u200BDX\u200B]\u200B](mqqapi://aio/inlinecmd?command=%2Fmai%20search%20A%26B%20%5BDX%5D&enter=false&reply=false)',
    )
  })

  it('creates only valid previous and next callback buttons from opaque page data', () => {
    const createPagedCallbackButtons = requireFactory(
      task10Api().createPagedCallbackButtons,
      'createPagedCallbackButtons',
    )
    const requestedPages: number[] = []

    const row = createPagedCallbackButtons({
      page: 2,
      totalPages: 3,
      previousLabel: 'Previous',
      nextLabel: 'Next',
      callbackData(page) {
        requestedPages.push(page)
        return `mai:token-${page}`
      },
    })

    expect(requestedPages).toEqual([1, 3])
    expect(row.buttons).toEqual([
      {
        render_data: { label: 'Previous', style: 0 },
        action: { type: 1, permission: { type: 2 }, data: 'mai:token-1', enter: false },
      },
      {
        render_data: { label: 'Next', style: 0 },
        action: { type: 1, permission: { type: 2 }, data: 'mai:token-3', enter: false },
      },
    ])
  })
})

describe('platform reply selection', () => {
  it('sends QQ rich output once outside compatibility mode', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const rich = h('qq:rawmarkdown-without-keyboard', { content: '# result' })
    const send = vi.fn(async () => ['message-id'])

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      rich,
    )).resolves.toEqual(['message-id'])

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith(rich)
  })

  it.each([
    ['discord', false],
    ['qq', true],
  ])('uses only standard text/image elements on %s with compatibility=%s', async (
    platform,
    compatibilityMode,
  ) => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)

    await sendReply(
      { platform, send },
      [
        { type: 'text', text: 'plain fallback' },
        { type: 'image', data: Buffer.from('image'), mimeType: 'image/png' },
      ],
      h('qq:rawmarkdown-without-keyboard', { content: '# rich' }),
      { compatibilityMode },
    )

    expect(send).toHaveBeenCalledTimes(1)
    const [elements] = send.mock.calls[0]
    expect(elements).toEqual([
      expect.objectContaining({ type: 'text', attrs: { content: 'plain fallback' } }),
      expect.objectContaining({
        type: 'img',
        attrs: { src: 'data:image/png;base64,aW1hZ2U=' },
      }),
    ])
    expect((elements as h[]).some(element => element.type.startsWith('qq:'))).toBe(false)
  })

  it('rejects QQ-native fallback input before sending', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)

    await expect(sendReply(
      { platform: 'qq', send },
      [{ type: 'qq:markdown', markdown: {} }],
      h('qq:rawmarkdown-without-keyboard', { content: '# rich' }),
    )).rejects.toThrow('Fallback messages may contain only text and image elements')
    expect(send).not.toHaveBeenCalled()
  })

  it('does not retry with fallback after an ambiguous rich-send failure', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const transportError = new Error('transport outcome unknown')
    const send = vi.fn(async () => {
      throw transportError
    })

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      h('qq:rawmarkdown-without-keyboard', { content: '# rich' }),
    )).rejects.toBe(transportError)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('rejects plain rich text so adapter auto-streaming cannot be triggered', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      '# implicit rich text' as unknown as h,
    )).rejects.toThrow('QQ rich replies must use an explicit Koishi element')
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects rich elements containing streaming fields', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      h('qq:rawmarkdown-without-keyboard', { content: '# rich', stream: true }),
    )).rejects.toThrow('QQ rich replies must not contain streaming fields')
    expect(send).not.toHaveBeenCalled()
  })
})

describe('opaque command callback routing', () => {
  const authorizedContext: TestDispatchContext = {
    userId: 'user-1',
    channelId: 'channel-1',
    authority: 4,
    permissions: ['maimai.bind'],
  }

  it('keeps private callback state opaque and consumes it once', async () => {
    const router = createRouter()
    const handler = vi.fn(async (payload: unknown) => payload)
    const token = router.register({
      kind: 'bind-confirm',
      payload: { qq: '123456789' },
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      handler,
    })

    expect(token).toMatch(/^mai:[A-Za-z0-9_-]{24}$/)
    expect(token).not.toContain('bind')
    expect(token).not.toContain('123456789')
    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: true,
      kind: 'bind-confirm',
      value: { qq: '123456789' },
    })
    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: false,
      reason: 'unknown-token',
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it.each<TestPaginationPayload>([
    { mode: 'search', query: 'A&B [DX]', page: 2 },
    { mode: 'level', filter: '13.0-13.4 dx', page: 3 },
    { mode: 'score-list', filter: 'sssp fc', page: 4 },
  ])('round-trips reusable $mode pagination payloads without parsing display text', async (payload) => {
    const router = createRouter()
    const handler = vi.fn(async (received: TestPaginationPayload) => received)
    const mutablePayload = { ...payload } as TestPaginationPayload
    const token = router.registerPagination({
      payload: mutablePayload,
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      handler,
    })
    mutablePayload.page = 99

    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: true,
      kind: 'pagination',
      value: payload,
    })
    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: true,
      kind: 'pagination',
      value: payload,
    })
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenNthCalledWith(1, payload, authorizedContext)
    expect(handler).toHaveBeenNthCalledWith(2, payload, authorizedContext)
  })

  it('rejects user, channel, authority, and permission mismatches without invoking the handler', async () => {
    const router = createRouter()
    const handler = vi.fn(async () => 'accepted')
    const token = router.register({
      kind: 'private-setting',
      payload: { setting: 'provider' },
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      requiredAuthority: 3,
      requiredPermission: 'maimai.bind',
      handler,
    })

    await expect(router.dispatch(token, { ...authorizedContext, userId: 'user-2' }))
      .resolves.toEqual({ ok: false, reason: 'user-mismatch' })
    await expect(router.dispatch(token, { ...authorizedContext, channelId: 'channel-2' }))
      .resolves.toEqual({ ok: false, reason: 'channel-mismatch' })
    await expect(router.dispatch(token, { ...authorizedContext, authority: 2 }))
      .resolves.toEqual({ ok: false, reason: 'insufficient-authority' })
    await expect(router.dispatch(token, { ...authorizedContext, permissions: [] }))
      .resolves.toEqual({ ok: false, reason: 'missing-permission' })
    expect(handler).not.toHaveBeenCalled()

    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: true,
      kind: 'private-setting',
      value: 'accepted',
    })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('expires callback state and rejects malformed or unknown callback data', async () => {
    let now = 10_000
    const router = createRouter({ now: () => now, ttlMs: 100 })
    const handler = vi.fn(async () => 'accepted')
    const token = router.register({
      kind: 'private-action',
      payload: { secret: true },
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      handler,
    })

    await expect(router.dispatch('search:secret:2', authorizedContext)).resolves.toEqual({
      ok: false,
      reason: 'malformed-token',
    })
    await expect(router.dispatch(`mai:${'A'.repeat(24)}`, authorizedContext)).resolves.toEqual({
      ok: false,
      reason: 'unknown-token',
    })
    now += 100
    await expect(router.dispatch(token, authorizedContext)).resolves.toEqual({
      ok: false,
      reason: 'expired-token',
    })
    expect(handler).not.toHaveBeenCalled()
    expect(router.size).toBe(0)
  })

  it('evicts the oldest callback when capacity is reached', async () => {
    const router = createRouter({ capacity: 2 })
    const handlers = [vi.fn(), vi.fn(), vi.fn()]
    const tokens = handlers.map((handler, index) => router.register({
      kind: `action-${index}`,
      payload: { index },
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      handler,
    }))

    expect(router.size).toBe(2)
    await expect(router.dispatch(tokens[0], authorizedContext)).resolves.toEqual({
      ok: false,
      reason: 'unknown-token',
    })
    expect(handlers[0]).not.toHaveBeenCalled()
    await router.dispatch(tokens[1], authorizedContext)
    await router.dispatch(tokens[2], authorizedContext)
    expect(handlers[1]).toHaveBeenCalledTimes(1)
    expect(handlers[2]).toHaveBeenCalledTimes(1)
  })
})
