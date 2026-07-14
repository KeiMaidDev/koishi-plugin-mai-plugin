import server from '@koishijs/plugin-server'
import mock from '@koishijs/plugin-mock'
import memory from '@koishijs/plugin-database-memory'
import { Context, Universal } from '@koishijs/core'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderOAuthRequiredError } from '../../src/providers/errors'
import {
  CallbackStore,
  CallbackTokenError,
  CommandCallbackRouter,
  createDefaultLifecycle,
  createProxyConfig,
  PublicCallbackUnavailableError,
  registerCoreCommands,
  registerUpdateCommands,
  replyQueryError,
  resolveCompatibilityExecution,
  registerMaiServerRoutes,
  UpdateBindingRequiredError,
  UpdateService,
  WahlapRecordFetcher,
} from '../../src'

vi.mock('koishi', async () => import('@koishijs/core'))

describe('callback store', () => {
  it('issues 256-bit opaque tokens and consumes them exactly once', () => {
    const store = new CallbackStore<{ userId: string }>({
      randomBytes: () => Buffer.alloc(32, 0xab),
    })
    const token = store.issue({ userId: 'user-1' })

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(token).not.toContain('user-1')
    expect(store.consume(token)).toEqual({ userId: 'user-1' })
    expect(() => store.consume(token)).toThrowError(CallbackTokenError)
    store.dispose()
  })

  it('rejects expired tokens and clears state on disposal', () => {
    let now = 1_000
    let seed = 0
    const store = new CallbackStore<number>({
      now: () => now,
      ttlMs: 600_000,
      randomBytes: () => Buffer.alloc(32, seed++),
    })
    const expired = store.issue(1)
    const pending = store.issue(2)

    now += 600_001
    try {
      store.consume(expired)
      throw new Error('expected expired token rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: 'expired-token' })
    }
    expect(store.sweep()).toBe(1)
    expect(store.size).toBe(0)
    store.dispose()
    try {
      store.consume(pending)
      throw new Error('expected disposed token rejection')
    } catch (error) {
      expect(error).toMatchObject({ code: 'unknown-token' })
    }
  })
})

describe('proxy configuration', () => {
  it.each(['sing-box', 'throne', 'nekoray', 'nekobox'] as const)(
    'emits parseable and safely escaped %s JSON',
    (type) => {
      const serverName = 'proxy.example"\\\nroute: injected'
      const config = createProxyConfig(type, { server: serverName, port: 8443 })

      expect(config?.contentType).toBe('application/json')
      expect(JSON.parse(config!.body)).toEqual(expect.objectContaining({}))
      expect(config!.body).not.toContain('\nroute: injected')
      expect(config!.body).toContain('proxy.example')
    },
  )

  it('quotes Clash YAML scalars and rejects unsupported types', () => {
    const config = createProxyConfig('clash', {
      server: 'proxy.example\n- MATCH,REJECT',
      port: 8080,
    })

    expect(config?.contentType).toBe('text/yaml')
    expect(config?.body).toContain('server: "proxy.example\\n- MATCH,REJECT"')
    expect(config?.body).not.toContain('\n- MATCH,REJECT\n')
    expect(createProxyConfig('unknown', { server: 'proxy', port: 80 })).toBeNull()
  })
})

describe('update service', () => {
  function session() {
    return {
      userId: 'user-1',
      platform: 'mock',
      channelId: 'channel-1',
      direct: false,
      pendingCommand: 'mai.rating B50',
      send: vi.fn(async () => undefined),
      replay: vi.fn(async () => undefined),
    }
  }

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      publicBaseUrl: 'https://bot.example',
      oauth: { enabled: true, clientId: 'client-id' },
      lxns: { exchangeOAuthCode: vi.fn(async () => undefined) },
      bind: {
        getImportToken: vi.fn(async () => 'import-secret'),
        setImportToken: vi.fn(async () => undefined),
      },
      fetchAuthorizationRedirect: vi.fn(async () => (
        'https://tgk-wcaime.wahlap.com/wc_auth/oauth/authorize/maimai-dx'
        + '?redirect_uri=https%3A%2F%2Ftgk-wcaime.wahlap.com%2Fwc_auth%2Foauth%2Fcallback%2Fmaimai-dx'
      )),
      fetchDivingFishRecords: vi.fn(async () => [{
        title: 'Track',
        achievements: 100,
        dxScore: 1_000,
        fc: 'fc' as const,
        fs: 'fs' as const,
        level_index: 3,
        type: 'DX' as const,
      }]),
      importDivingFishRecords: vi.fn(async () => ({ creates: 2, updates: 3, message: 'ok' })),
      ...overrides,
    }
  }

  it('disables public callback flows when no public URL is configured', async () => {
    const service = new UpdateService(dependencies({ publicBaseUrl: '' }))

    await expect(service.beginLxnsOAuth(session())).rejects.toBeInstanceOf(PublicCallbackUnavailableError)
    await expect(service.beginDivingFishUpdate(session())).rejects.toBeInstanceOf(PublicCallbackUnavailableError)
    service.dispose()
  })

  it('uses opaque state identity, consumes before exchange, and replays only after success', async () => {
    const deps = dependencies()
    const currentSession = session()
    const service = new UpdateService(deps)
    const authorization = new URL(await service.beginLxnsOAuth(currentSession))
    const state = authorization.searchParams.get('state')!

    expect(authorization.origin + authorization.pathname).toBe('https://maimai.lxns.net/api/v0/oauth/authorize')
    expect(authorization.searchParams.get('client_id')).toBe('client-id')
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://bot.example/mai-plugin/lxns/callback')
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(authorization.href).not.toContain('user-1')

    await service.completeLxnsOAuth(state, 'grant-code')
    expect(deps.lxns.exchangeOAuthCode).toHaveBeenCalledWith(
      'user-1',
      'grant-code',
      'https://bot.example/mai-plugin/lxns/callback',
    )
    expect(currentSession.send).toHaveBeenCalledWith('落雪授权绑定成功。')
    expect(currentSession.replay).toHaveBeenCalledWith('mai.rating B50')
    await expect(service.completeLxnsOAuth(state, 'reused')).rejects.toMatchObject({
      code: 'unknown-token',
    })
    service.dispose()
  })

  it('does not restore a consumed LXNS state when token exchange fails', async () => {
    const deps = dependencies({
      lxns: { exchangeOAuthCode: vi.fn(async () => { throw new Error('exchange failed') }) },
    })
    const currentSession = session()
    const service = new UpdateService(deps)
    const state = new URL(await service.beginLxnsOAuth(currentSession)).searchParams.get('state')!

    await expect(service.completeLxnsOAuth(state, 'bad-code')).rejects.toThrow('exchange failed')
    expect(currentSession.send).toHaveBeenCalledWith('落雪授权绑定失败，请重试。')
    await expect(service.completeLxnsOAuth(state, 'second-code')).rejects.toMatchObject({
      code: 'unknown-token',
    })
    service.dispose()
  })

  it('binds Diving Fish tokens and completes a single-use fixed-origin update flow', async () => {
    const deps = dependencies()
    const currentSession = session()
    const service = new UpdateService(deps)

    await service.bindDivingFishToken('user-1', '  bound-token  ')
    expect(deps.bind.setImportToken).toHaveBeenCalledWith('user-1', 'bound-token')

    const updateUrl = new URL(await service.beginDivingFishUpdate(currentSession))
    const token = updateUrl.searchParams.get('token')!
    expect(updateUrl.origin + updateUrl.pathname).toBe('https://bot.example/mai-plugin/update')
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const authorization = new URL(await service.createUpdateRedirect(token))
    expect(authorization.searchParams.get('redirect_uri')).toBe(
      `https://bot.example/wc_auth/oauth/callback/maimai-dx?token=${token}`,
    )

    await service.completeDivingFishUpdate(
      token,
      `/wc_auth/oauth/callback/maimai-dx?token=${token}&r=1`,
    )
    expect(deps.fetchDivingFishRecords).toHaveBeenCalledWith(
      'https://tgk-wcaime.wahlap.com/wc_auth/oauth/callback/maimai-dx?r=1',
    )
    expect(deps.importDivingFishRecords).toHaveBeenCalledWith(
      'user-1',
      expect.any(Array),
      'import-secret',
    )
    expect(currentSession.send).toHaveBeenCalledWith('正在爬取数据中……')
    expect(currentSession.send).toHaveBeenCalledWith('更新成功，已更新5条记录。')
    await expect(service.completeDivingFishUpdate(token, '/wc_auth/oauth/callback/maimai-dx'))
      .rejects.toMatchObject({ code: 'unknown-token' })
    service.dispose()
  })

  it('requires a bound Diving Fish import token before issuing an update token', async () => {
    const deps = dependencies({
      bind: {
        getImportToken: vi.fn(async () => null),
        setImportToken: vi.fn(async () => undefined),
      },
    })
    const service = new UpdateService(deps)

    await expect(service.beginDivingFishUpdate(session())).rejects.toBeInstanceOf(UpdateBindingRequiredError)
    service.dispose()
  })
})

describe('Wahlap record fetcher', () => {
  const recordHtml = `
    <form action="https://maimai.wahlap.com/maimai-mobile/record/musicDetail/">
      <div class="music_name_block">Track Name</div>
      <div class="music_score_block w_112">100.5000%</div>
      <div class="music_score_block w_190">1,234 / 1,500</div>
      <img class="music_kind_icon" src="/assets/music_dx.png">
      <img src="/assets/music_icon_fs.png">
      <img src="/assets/music_icon_fc.png">
    </form>
  `

  it('follows only the fixed login chain and parses five bounded difficulty pages', async () => {
    const responses = [
      {
        status: 302,
        headers: { location: 'https://maimai.wahlap.com/maimai-mobile/' },
        body: '',
      },
      {
        status: 302,
        headers: { 'set-cookie': ['userId=abc; Path=/; HttpOnly', 'friendCode=123; Path=/'] },
        body: '',
      },
      ...Array.from({ length: 5 }, (_, difficulty) => ({
        status: 200,
        headers: {},
        body: difficulty === 3 ? recordHtml : '<html></html>',
      })),
    ]
    const request = vi.fn(async () => responses.shift()!)
    const fetcher = new WahlapRecordFetcher({ request })

    await expect(fetcher.fetch(
      'https://tgk-wcaime.wahlap.com/wc_auth/oauth/callback/maimai-dx?r=1',
    )).resolves.toEqual([{
      title: 'Track Name',
      achievements: 100.5,
      dxScore: 1_234,
      fc: 'fc',
      fs: 'fs',
      level_index: 3,
      type: 'DX',
    }])
    expect(request).toHaveBeenCalledTimes(7)
    expect(request.mock.calls[0][0]).not.toContain('token=')
    expect(request.mock.calls[2][1]).toMatchObject({
      headers: { Cookie: 'userId=abc; friendCode=123' },
    })
    expect(request.mock.calls.slice(2).map(call => new URL(call[0]).searchParams.get('diff')))
      .toEqual(['0', '1', '2', '3', '4'])
  })

  it('preserves multiple cookies when a runtime combines Set-Cookie headers', async () => {
    const responses = [
      {
        status: 302,
        headers: { location: 'https://maimai.wahlap.com/maimai-mobile/' },
        body: '',
      },
      {
        status: 302,
        headers: {
          'set-cookie': 'userId=abc; Path=/; HttpOnly, friendCode=123; Path=/',
        },
        body: '',
      },
      ...Array.from({ length: 5 }, () => ({
        status: 200,
        headers: {},
        body: '<html></html>',
      })),
    ]
    const request = vi.fn(async () => responses.shift()!)
    const fetcher = new WahlapRecordFetcher({ request })

    await fetcher.fetch(
      'https://tgk-wcaime.wahlap.com/wc_auth/oauth/callback/maimai-dx?r=1',
    )

    expect(request.mock.calls[2][1]).toMatchObject({
      headers: { Cookie: 'userId=abc; friendCode=123' },
    })
  })

  it('rejects redirects outside the fixed Wahlap origins', async () => {
    const request = vi.fn(async () => ({
      status: 302,
      headers: { location: 'https://attacker.example/steal' },
      body: '',
    }))
    const fetcher = new WahlapRecordFetcher({ request })

    await expect(fetcher.fetch(
      'https://tgk-wcaime.wahlap.com/wc_auth/oauth/callback/maimai-dx?r=1',
    )).rejects.toThrow('invalid Wahlap redirect')
    expect(request).toHaveBeenCalledTimes(1)
  })
})

describe('update commands', () => {
  async function commandApp(overrides: Record<string, unknown> = {}) {
    const app = new Context()
    app.plugin(memory)
    app.plugin(mock, { selfId: '514' })
    const updateService = {
      beginDivingFishUpdate: vi.fn(async () => 'https://bot.example/mai-plugin/update?token=opaque'),
      bindDivingFishToken: vi.fn(async () => undefined),
      beginLxnsOAuth: vi.fn(async () => 'https://maimai.lxns.net/api/v0/oauth/authorize?state=opaque'),
      ...overrides,
    }
    const commands = registerUpdateCommands(app, {
      updateService,
      settingService: { isCompatibilityMode: vi.fn(async () => false) },
    })
    await app.start()
    await app.mock.initUser('user-1', 1)
    const client = app.mock.client('user-1', 'channel-1')
    client.event.channel.type = Universal.Channel.Type.TEXT
    client.event.guild = { id: 'guild-1' } as never
    return { app, client, commands, updateService }
  }

  it('starts exact update aliases without exposing stored credentials', async () => {
    const { client, commands, updateService } = await commandApp()
    try {
      await client.shouldReply('/mai 更新', /https:\/\/bot\.example\/mai-plugin\/update\?token=opaque/)
      await client.shouldReply('/mai 导', /请自行确认第三方服务条款与网络合规性/)
      expect(updateService.beginDivingFishUpdate).toHaveBeenCalledTimes(2)
      expect(updateService.beginDivingFishUpdate.mock.calls[0][0]).toMatchObject({
        userId: 'user-1',
        platform: 'mock',
        channelId: 'channel-1',
      })
      await client.shouldNotReply('/mai 更新额外文本')
    } finally {
      for (const command of commands) command.dispose()
    }
  })

  it('binds a Diving Fish token without echoing it', async () => {
    const { client, commands, updateService } = await commandApp()
    try {
      await client.shouldReply('/mai 绑定水鱼 import-token-secret', '水鱼token绑定成功。')
      expect(updateService.bindDivingFishToken).toHaveBeenCalledWith('user-1', 'import-token-secret')
    } finally {
      for (const command of commands) command.dispose()
    }
  })

  it('maps missing public configuration and missing import binding to clear guidance', async () => {
    const unavailable = await commandApp({
      beginDivingFishUpdate: vi.fn(async () => { throw new PublicCallbackUnavailableError() }),
    })
    try {
      await unavailable.client.shouldReply('/mai 更新', /publicBaseUrl.*selfUrl/)
    } finally {
      for (const command of unavailable.commands) command.dispose()
    }

    const unbound = await commandApp({
      beginDivingFishUpdate: vi.fn(async () => { throw new UpdateBindingRequiredError() }),
    })
    try {
      await unbound.client.shouldReply('/mai 更新', /绑定水鱼/)
    } finally {
      for (const command of unbound.commands) command.dispose()
    }
  })
})

describe('core update integration', () => {
  function coreDependencies() {
    return {
      data: { musics: new Map(), courses: new Map(), icons: new Map(), plates: new Map() },
      aliasService: {
        search: vi.fn(async () => []),
        add: vi.fn(),
        remove: vi.fn(),
        vote: vi.fn(),
      },
      queryService: {
        getQueryParams: vi.fn(),
        consumePendingCommand: vi.fn(),
        rating: vi.fn(),
        record: vi.fn(),
        records: vi.fn(),
        recent: vi.fn(),
      },
      settingService: {
        isCompatibilityMode: vi.fn(async () => false),
        getDefaultGame: vi.fn(async () => 'maimai'),
        setProviderPreference: vi.fn(),
        setCompatibilityMode: vi.fn(),
        setAvatar: vi.fn(),
        setPlate: vi.fn(),
        setDefaultGame: vi.fn(),
      },
      bindRepository: { setQq: vi.fn() },
      renderer: {} as never,
      callbackRouter: new CommandCallbackRouter(),
      updateService: {
        beginDivingFishUpdate: vi.fn(),
        bindDivingFishToken: vi.fn(),
        beginLxnsOAuth: vi.fn(),
      },
    }
  }

  it('maps only exact prefixless update commands', () => {
    expect(resolveCompatibilityExecution('更新')).toBe('mai.update')
    expect(resolveCompatibilityExecution('导')).toBe('mai.update')
    expect(resolveCompatibilityExecution('绑定水鱼 token')).toBe('mai.bind-diving-fish token')
    expect(resolveCompatibilityExecution('更新额外文本')).toBeNull()
  })

  it('registers and disposes update commands through the core lifecycle', async () => {
    const app = new Context()
    const registration = registerCoreCommands(app, coreDependencies())

    expect(app.$commander.get('mai.update')).toBeDefined()
    expect(app.$commander.get('mai.bind-diving-fish')).toBeDefined()
    await registration.dispose()
    expect(app.$commander.get('mai.update')).toBeUndefined()
    expect(app.$commander.get('mai.bind-diving-fish')).toBeUndefined()
  })

  it('starts LXNS OAuth only for self queries and preserves the pending command', async () => {
    const send = vi.fn(async () => undefined)
    const execute = vi.fn(async () => undefined)
    const beginLxnsOAuth = vi.fn(async () => 'https://lxns.example/authorize')
    const session = {
      userId: 'user-1',
      channelId: 'channel-1',
      platform: 'mock',
      content: 'mai.rating B50',
      isDirect: false,
      send,
      execute,
    } as never
    const dependencies = {
      settingService: { isCompatibilityMode: vi.fn(async () => false) },
      updateService: {
        beginLxnsOAuth,
        beginDivingFishUpdate: vi.fn(),
        bindDivingFishToken: vi.fn(),
      },
    } as never

    await replyQueryError(
      session,
      dependencies,
      new ProviderOAuthRequiredError('lxns'),
      true,
    )
    expect(beginLxnsOAuth).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'user-1',
      platform: 'mock',
      channelId: 'channel-1',
      pendingCommand: 'mai.rating B50',
    }))
    expect(send).toHaveBeenCalled()

    beginLxnsOAuth.mockClear()
    await replyQueryError(
      session,
      dependencies,
      new ProviderOAuthRequiredError('lxns'),
      false,
    )
    expect(beginLxnsOAuth).not.toHaveBeenCalled()
  })
})

describe('default update lifecycle', () => {
  it('shares update state between routes and commands and disposes both', async () => {
    const app = new Context()
    app.plugin(server, { host: '127.0.0.1', port: 0 })
    await app.start()
    const updateService = {
      completeLxnsOAuth: vi.fn(async () => undefined),
      createUpdateRedirect: vi.fn(async () => 'https://wahlap.example'),
      completeDivingFishUpdate: vi.fn(async () => undefined),
      beginDivingFishUpdate: vi.fn(),
      beginLxnsOAuth: vi.fn(),
      bindDivingFishToken: vi.fn(),
      dispose: vi.fn(),
    }
    const commandDependencies = {
      data: { musics: new Map(), courses: new Map(), icons: new Map(), plates: new Map() },
      aliasService: { search: vi.fn(), add: vi.fn(), remove: vi.fn(), vote: vi.fn() },
      queryService: {
        getQueryParams: vi.fn(),
        consumePendingCommand: vi.fn(),
        rating: vi.fn(),
        record: vi.fn(),
        records: vi.fn(),
        recent: vi.fn(),
      },
      settingService: {
        isCompatibilityMode: vi.fn(async () => false),
        getDefaultGame: vi.fn(async () => 'maimai'),
        setProviderPreference: vi.fn(),
        setCompatibilityMode: vi.fn(),
        setAvatar: vi.fn(),
        setPlate: vi.fn(),
        setDefaultGame: vi.fn(),
      },
      bindRepository: { setQq: vi.fn() },
      renderer: {} as never,
      callbackRouter: new CommandCallbackRouter(),
      updateService,
    }
    const createCommandDependencies = vi.fn(async () => commandDependencies as never)
    const lifecycle = createDefaultLifecycle(app, {
      createCommandDependencies,
      createDataSync: vi.fn(() => ({}) as never),
    })
    const runtime = {
      publicBaseUrl: 'https://bot.example:8443',
      config: {
        developerTokens: { divingFish: '', lxns: '' },
        oauth: { enabled: true, clientId: 'id', clientSecret: 'secret', tokenCipherKey: 'cipher' },
        resourceSync: {
          enabled: false,
          intervalMinutes: 60,
          timeoutMs: 10_000,
          cacheDir: 'data/maimai',
          staticBaseUrl: '',
          allowedHosts: [],
        },
        render: { concurrency: 1, queueLimit: 4, timeoutMs: 30_000 },
        publicBaseUrl: 'https://bot.example:8443',
        administrators: [],
        compatibilityMode: false,
      },
    }

    try {
      await lifecycle.initializeDataCache(runtime)
      await lifecycle.initializeServices(runtime)
      expect(createCommandDependencies).toHaveBeenCalledTimes(1)
      await lifecycle.initializeRoutes(runtime)
      expect(app.server.stack.some(layer => layer.path === '/mai-plugin/lxns/callback')).toBe(true)
      await lifecycle.initializeCommands(runtime)
      expect(createCommandDependencies).toHaveBeenCalledTimes(1)
      expect(app.$commander.get('mai.update')).toBeDefined()

      await lifecycle.releaseCallbackState()
      expect(updateService.dispose).toHaveBeenCalledTimes(1)
      expect(app.$commander.get('mai.update')).toBeUndefined()
      expect(app.server.stack.some(layer => layer.path === '/mai-plugin/lxns/callback')).toBe(false)
    } finally {
      await app.stop()
    }
  })
})

describe('maimai server routes', () => {
  let app: Context
  let baseUrl: string
  let serverPort: number
  let registration: { dispose(): void }
  const completeLxnsOAuth = vi.fn(async () => undefined)
  const createUpdateRedirect = vi.fn(async () => 'https://wahlap.example/authorize')
  const completeDivingFishUpdate = vi.fn(async () => undefined)

  beforeEach(async () => {
    vi.clearAllMocks()
    app = new Context()
    app.plugin(server, { host: '127.0.0.1', port: 0 })
    await app.start()
    await new Promise<void>((resolve, reject) => {
      app.server._http.once('error', reject)
      app.server._http.listen(0, '127.0.0.1', resolve)
    })
    const address = app.server._http.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    serverPort = address.port
    baseUrl = `http://127.0.0.1:${serverPort}`
    registration = registerMaiServerRoutes(app, {
      service: {
        completeLxnsOAuth,
        createUpdateRedirect,
        completeDivingFishUpdate,
      },
      proxy: { server: 'proxy.example', port: 8080 },
      allowedWahlapHost: 'tgk-wcaime.wahlap.com',
    })
  })

  afterEach(async () => {
    registration?.dispose()
    await app.stop()
  })

  it('validates methods and required LXNS callback parameters', async () => {
    const wrongMethod = await fetch(`${baseUrl}/mai-plugin/lxns/callback`, { method: 'POST' })
    expect(wrongMethod.status).toBe(405)
    expect(wrongMethod.headers.get('allow')).toBe('GET')

    expect((await fetch(`${baseUrl}/mai-plugin/lxns/callback`)).status).toBe(400)
    const response = await fetch(`${baseUrl}/mai-plugin/lxns/callback?state=opaque&code=grant`)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('绑定成功')
    expect(completeLxnsOAuth).toHaveBeenCalledWith('opaque', 'grant')
  })

  it('validates update tokens and redirects only through the service', async () => {
    expect((await fetch(`${baseUrl}/mai-plugin/update`)).status).toBe(400)
    const response = await fetch(`${baseUrl}/mai-plugin/update?token=opaque-update`, {
      redirect: 'manual',
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://wahlap.example/authorize')
    expect(createUpdateRedirect).toHaveBeenCalledWith('opaque-update')
  })

  it('serves safe proxy formats with explicit status codes', async () => {
    const json = await fetch(`${baseUrl}/mai-plugin/proxy-config/sing-box`)
    expect(json.status).toBe(200)
    expect(json.headers.get('content-type')).toContain('application/json')
    expect(JSON.parse(await json.text())).toEqual(expect.objectContaining({}))

    expect((await fetch(`${baseUrl}/mai-plugin/proxy-config/unknown`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/mai-plugin/proxy-config/clash`, { method: 'POST' })).status).toBe(405)
  })

  it('passes through a mismatched parsed Host without consuming the update token', async () => {
    const mismatch = await fetch(`${baseUrl}/wc_auth/oauth/callback/maimai-dx?token=secret`)
    expect(mismatch.status).toBe(404)
    expect(completeDivingFishUpdate).not.toHaveBeenCalled()

    const malformedHost = await new Promise<number>((resolve, reject) => {
      const outbound = request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/wc_auth/oauth/callback/maimai-dx?token=secret',
        method: 'GET',
        headers: { Host: 'attacker@tgk-wcaime.wahlap.com' },
      }, (incoming) => {
        incoming.resume()
        incoming.on('end', () => resolve(incoming.statusCode ?? 0))
      })
      outbound.once('error', reject)
      outbound.end()
    })
    expect(malformedHost).toBe(404)
    expect(completeDivingFishUpdate).not.toHaveBeenCalled()

    app.server._koa.proxy = true
    const forwardedHost = await new Promise<number>((resolve, reject) => {
      const outbound = request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/wc_auth/oauth/callback/maimai-dx?token=secret',
        method: 'GET',
        headers: {
          Host: 'attacker.example',
          'X-Forwarded-Host': 'tgk-wcaime.wahlap.com',
        },
      }, (incoming) => {
        incoming.resume()
        incoming.on('end', () => resolve(incoming.statusCode ?? 0))
      })
      outbound.once('error', reject)
      outbound.end()
    })
    app.server._koa.proxy = false
    expect(forwardedHost).toBe(404)
    expect(completeDivingFishUpdate).not.toHaveBeenCalled()

    const response = await new Promise<{ status: number, body: string }>((resolve, reject) => {
      const outbound = request({
        hostname: '127.0.0.1',
        port: serverPort,
        path: '/wc_auth/oauth/callback/maimai-dx?token=secret',
        method: 'GET',
        headers: { Host: 'tgk-wcaime.wahlap.com' },
      }, (incoming) => {
        const chunks: Buffer[] = []
        incoming.on('data', chunk => chunks.push(Buffer.from(chunk)))
        incoming.on('end', () => resolve({
          status: incoming.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
        }))
      })
      outbound.once('error', reject)
      outbound.end()
    })
    expect(response.status).toBe(200)
    expect(response.body).toContain('BOT正在更新中')
    expect(completeDivingFishUpdate).toHaveBeenCalledWith(
      'secret',
      '/wc_auth/oauth/callback/maimai-dx?token=secret',
    )
  })

  it('removes every route when disposed', async () => {
    registration.dispose()
    expect((await fetch(`${baseUrl}/mai-plugin/lxns/callback?state=a&code=b`)).status).toBe(404)
    expect((await fetch(`${baseUrl}/mai-plugin/proxy-config/clash`)).status).toBe(404)
  })
})
