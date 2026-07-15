import h from '@satorijs/element'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src/index'

interface NativeMarkdownFactory {
  (content: string, keyboard?: {
    content: {
      rows: Array<{
        buttons: Array<{
          id: string
          render_data: { label: string, visited_label: string, style: 0 | 1 }
          action: TestAction
        }>
      }>
    }
  }): h
}

type TestPermission =
  | { type: 0, specify_user_ids: string[] }
  | { type: 2 }

type TestAction = {
  type: 0 | 1 | 2
  permission: TestPermission
  data: string
  unsupport_tips: string
  reply?: boolean
  enter?: boolean
}

type TestButton = {
  id: string
  render_data: { label: string, visited_label: string, style: 0 | 1 }
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
      reply?: boolean
      permission?: TestPermission
      unsupportTips?: string
    }) => TestAction
    createQqCallbackAction?: (data: string, options?: {
      permission?: TestPermission
      unsupportTips?: string
    }) => TestAction
    createQqUrlAction?: (url: string, options?: {
      permission?: TestPermission
      unsupportTips?: string
    }) => TestAction
    createQqUserPermission?: (userId: string) => TestPermission
    createQqButton?: (
      id: string,
      label: string,
      action: TestAction,
      style?: 0 | 1,
      visitedLabel?: string,
    ) => TestButton
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
            id: 'next',
            render_data: { label: 'Next', visited_label: 'Next', style: 1 },
            action: {
              type: 2,
              permission: { type: 2 },
              data: '/mai search next',
              unsupport_tips: '请手动执行 /mai search next',
              reply: false,
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

  it('builds exact official command, callback, URL, button, row, and keyboard payloads', () => {
    const api = task10Api()
    const createQqCommandAction = requireFactory(api.createQqCommandAction, 'createQqCommandAction')
    const createQqCallbackAction = requireFactory(api.createQqCallbackAction, 'createQqCallbackAction')
    const createQqUrlAction = requireFactory(api.createQqUrlAction, 'createQqUrlAction')
    const createQqUserPermission = requireFactory(
      api.createQqUserPermission,
      'createQqUserPermission',
    )
    const createQqButton = requireFactory(api.createQqButton, 'createQqButton')
    const createQqButtonRow = requireFactory(api.createQqButtonRow, 'createQqButtonRow')
    const createQqKeyboard = requireFactory(api.createQqKeyboard, 'createQqKeyboard')

    const userPermission = createQqUserPermission('user-1')
    const command = createQqCommandAction('/mai info 123', {
      enter: true,
      reply: true,
      unsupportTips: '请手动执行 /mai info 123',
    })
    const callback = createQqCallbackAction('mai:opaque-token')
    const url = createQqUrlAction('https://maimai.lxns.net/oauth', {
      permission: userPermission,
    })
    const row = createQqButtonRow([
      createQqButton('run', 'Run', command, 1, 'Run again'),
      createQqButton('next', 'Next', callback, 0),
      createQqButton('oauth', 'Authorize', url, 1, 'Authorize again'),
    ])

    expect(command).toEqual({
      type: 2,
      permission: { type: 2 },
      data: '/mai info 123',
      unsupport_tips: '请手动执行 /mai info 123',
      reply: true,
      enter: true,
    })
    expect(callback).toEqual({
      type: 1,
      permission: { type: 2 },
      data: 'mai:opaque-token',
      unsupport_tips: '当前客户端不支持此按钮。',
    })
    expect(userPermission).toEqual({
      type: 0,
      specify_user_ids: ['user-1'],
    })
    expect(url).toEqual({
      type: 0,
      permission: userPermission,
      data: 'https://maimai.lxns.net/oauth',
      unsupport_tips: '请复制正文中的 HTTPS 链接后打开。',
    })
    expect(createQqKeyboard([row])).toEqual({
      content: {
        rows: [{
          buttons: [
            {
              id: 'run',
              render_data: { label: 'Run', visited_label: 'Run again', style: 1 },
              action: command,
            },
            {
              id: 'next',
              render_data: { label: 'Next', visited_label: 'Next', style: 0 },
              action: callback,
            },
            {
              id: 'oauth',
              render_data: {
                label: 'Authorize',
                visited_label: 'Authorize again',
                style: 1,
              },
              action: url,
            },
          ],
        }],
      },
    })
  })

  it.each([
    'http://example.com',
    'javascript:alert(1)',
    'data:text/plain,secret',
    '//example.com/path',
    '/relative/path',
  ])('rejects unsafe URL button target %s', (target) => {
    const createQqUrlAction = requireFactory(task10Api().createQqUrlAction, 'createQqUrlAction')

    expect(() => createQqUrlAction(target)).toThrow(/HTTPS/)
  })

  it('rejects invalid user permissions, blank markdown, oversized keyboards, and duplicate IDs', () => {
    const api = task10Api()
    const createQqUserPermission = requireFactory(
      api.createQqUserPermission,
      'createQqUserPermission',
    )
    const createQqCommandAction = requireFactory(api.createQqCommandAction, 'createQqCommandAction')
    const createQqButton = requireFactory(api.createQqButton, 'createQqButton')
    const createQqButtonRow = requireFactory(api.createQqButtonRow, 'createQqButtonRow')
    const createQqKeyboard = requireFactory(api.createQqKeyboard, 'createQqKeyboard')
    const createQqNativeMarkdown = requireFactory(
      api.createQqNativeMarkdown,
      'createQqNativeMarkdown',
    )
    const action = createQqCommandAction('/mai')
    const buttons = Array.from({ length: 6 }, (_, index) => (
      createQqButton(`button-${index}`, `Button ${index}`, action)
    ))

    expect(() => createQqUserPermission('   ')).toThrow(/user ID/)
    expect(() => createQqButtonRow([])).toThrow(/1.*5/)
    expect(() => createQqButtonRow(buttons)).toThrow(/1.*5/)
    expect(() => createQqKeyboard([])).toThrow(/1.*5/)
    expect(() => createQqKeyboard(Array(6).fill(createQqButtonRow(buttons.slice(0, 1)))))
      .toThrow(/1.*5/)
    expect(() => createQqKeyboard([
      createQqButtonRow([
        createQqButton('duplicate', 'One', action),
        createQqButton('duplicate', 'Two', action),
      ]),
    ])).toThrow(/unique/i)
    expect(() => createQqNativeMarkdown('   ', createQqKeyboard([
      createQqButtonRow(buttons.slice(0, 1)),
    ]))).toThrow(/non-empty/)
  })

  it('uses template Markdown only for a non-empty template ID and otherwise preserves buttons', () => {
    const api = task10Api()
    const createQqTemplateMarkdown = requireFactory(
      api.createQqTemplateMarkdown,
      'createQqTemplateMarkdown',
    )
    const createQqKeyboard = requireFactory(api.createQqKeyboard, 'createQqKeyboard')
    const createQqCommandAction = requireFactory(
      api.createQqCommandAction,
      'createQqCommandAction',
    )
    const createQqButton = requireFactory(api.createQqButton, 'createQqButton')
    const createQqButtonRow = requireFactory(api.createQqButtonRow, 'createQqButtonRow')
    const keyboard = createQqKeyboard([
      createQqButtonRow([
        createQqButton('help', 'Help', createQqCommandAction('/mai')),
      ]),
    ])
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

  it('escapes a trailing backslash before the generated closing label bracket', () => {
    const createInlineCommandLink = requireFactory(
      task10Api().createInlineCommandLink,
      'createInlineCommandLink',
    )

    expect(createInlineCommandLink('Trailing\\', '/mai help')).toBe(
      '[Trailing\\\\](mqqapi://aio/inlinecmd?command=%2Fmai%20help&enter=true&reply=false)',
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
        id: 'page-1',
        render_data: { label: 'Previous', visited_label: 'Previous', style: 0 },
        action: {
          type: 1,
          permission: { type: 2 },
          data: 'mai:token-1',
          unsupport_tips: '当前客户端不支持此按钮。',
        },
      },
      {
        id: 'page-3',
        render_data: { label: 'Next', visited_label: 'Next', style: 0 },
        action: {
          type: 1,
          permission: { type: 2 },
          data: 'mai:token-3',
          unsupport_tips: '当前客户端不支持此按钮。',
        },
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

  it('copies only a sliced Uint8Array fallback image view', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)
    const backing = Uint8Array.from([0xaa, ...Buffer.from('image'), 0xbb])
    const image = backing.subarray(1, backing.length - 1)

    await sendReply(
      { platform: 'discord', send },
      { type: 'image', data: image, mimeType: 'image/png' },
    )

    const [elements] = send.mock.calls[0]
    expect(elements).toEqual([
      expect.objectContaining({
        type: 'img',
        attrs: { src: 'data:image/png;base64,aW1hZ2U=' },
      }),
    ])
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

  it('rejects standard h.text elements on the QQ rich path', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      h.text('# implicit rich text'),
    )).rejects.toThrow('QQ rich replies must use a supported QQ Markdown element')
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

  it('rejects inherited streaming fields on supported QQ Markdown elements', async () => {
    const sendReply = requireFactory(task10Api().sendReply, 'sendReply')
    const send = vi.fn(async () => undefined)
    const rich = h('qq:rawmarkdown-without-keyboard', { content: '# rich' })
    Object.setPrototypeOf(rich.attrs, { stream: true })

    await expect(sendReply(
      { platform: 'qq', send },
      { type: 'text', text: 'fallback' },
      rich,
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

  it('rejects pagination fields inherited from a payload prototype', () => {
    const router = createRouter()
    const handler = vi.fn(async (payload: TestPaginationPayload) => payload)
    const payload = Object.create({
      mode: 'search',
      query: 'inherited query',
      page: 2,
    }) as TestPaginationPayload

    expect(() => router.registerPagination({
      payload,
      expectedUserId: 'user-1',
      expectedChannelId: 'channel-1',
      handler,
    })).toThrow('Pagination payload must contain plain own properties')
    expect(router.size).toBe(0)
    expect(handler).not.toHaveBeenCalled()
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
