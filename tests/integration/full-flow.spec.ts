import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'
import server from '@koishijs/plugin-server'
import { Context, Universal } from '@koishijs/core'
import { request } from 'node:http'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src'

vi.mock('koishi', async () => import('@koishijs/core'))

const apps: Context[] = []
const mockApps = new WeakSet<Context>()
const disposers: Array<() => Promise<void> | void> = []

afterEach(async () => {
  await Promise.allSettled(disposers.splice(0).map(dispose => Promise.resolve().then(dispose)))
  await Promise.allSettled(apps.splice(0).filter(app => !mockApps.has(app)).map(app => app.stop()))
  vi.restoreAllMocks()
})

function musicFixture(id: number, isNew = false) {
  const version = { id: isNew ? 2 : 1, name: isNew ? 'maimai DX 2026' : 'maimai DX 2025', version: isNew ? 26_000 : 25_000 }
  const music = new plugin.MusicInfo(
    id,
    `Flow Track ${id}`,
    plugin.MusicType.Deluxe,
    '',
    'Flow Artist',
    plugin.MusicGenre.Original,
    180,
    version,
    isNew,
  )
  music.charts = [new plugin.ChartInfo(
    music,
    plugin.MusicDifficulty.Master,
    '14',
    14.0,
    new plugin.Notes(400, 40, 20, 10, 5),
    'Flow Designer',
  )]
  return music
}

function recordFixture(music: plugin.MusicInfo, rating = 300) {
  return new plugin.RecordEntry(
    music,
    music.charts[0],
    1_005_000,
    plugin.ComboStatus.FullComboPlus,
    plugin.SyncStatus.FullSyncDeluxePlus,
    music.charts[0].maxDeluxeScore,
    plugin.Rate.get(1_005_000),
    rating,
  )
}

function dataFixture(musics: plugin.MusicInfo[]) {
  const versions = new Map(musics.map(music => [music.version.name, music.version]))
  return new plugin.MaimaiDataStore({
    revision: 'full-flow',
    versions,
    musics: new Map(musics.map(music => [music.id, music])),
    plates: new Map(),
    icons: new Map(),
    courses: new Map(),
  }, {
    schemaVersion: 1,
    revision: 'full-flow',
    generatedAt: '2026-07-14T00:00:00.000Z',
    files: {},
  }, new Map())
}

async function databaseApp(options: { withMock?: boolean, withServer?: boolean } = {}) {
  const app = new Context()
  apps.push(app)
  app.plugin(memory)
  if (options.withMock) {
    mockApps.add(app)
    app.plugin(mock, { selfId: '514' })
  }
  if (options.withServer) app.plugin(server, { host: '127.0.0.1', port: 0 })
  plugin.registerMaiDatabaseModels(app)
  await app.start()
  return app
}

describe('end-to-end compatibility flows', () => {
  it('binds QQ, falls back through the automatic provider chain, renders B50, and sends QQ rich output', async () => {
    const oldMusic = musicFixture(10_001)
    const newMusic = musicFixture(20_001, true)
    const data = dataFixture([oldMusic, newMusic])
    const app = await databaseApp({ withMock: true })
    const repositories = new plugin.MaiRepositories(app, 'full-flow-cipher')
    const divingRating = vi.fn(async () => {
      throw new plugin.ProviderNotFoundError('diving-fish')
    })
    const lxnsRating = vi.fn(async () => new plugin.RatingResponse(
      new plugin.PlayerInfo('Flow User', 600, 1),
      null,
      [recordFixture(oldMusic)],
      [recordFixture(newMusic)],
    ))
    const providerChain = new plugin.ProviderChain({
      data,
      repositories,
      providers: {
        divingFish: {
          id: 'diving-fish',
          name: 'Diving Fish',
          getPlayerRating: divingRating,
        } as never,
        lxns: {
          id: 'lxns',
          name: 'LXNS',
          getPlayerRating: lxnsRating,
        } as never,
      },
    })
    const settings = {
      getSettings: vi.fn(async () => ({
        provider: 'auto' as const,
        compatibilityMode: false,
        avatar: null,
        plate: null,
        defaultGame: 'maimai' as const,
      })),
      getDefaultGame: vi.fn(async () => 'maimai'),
      isCompatibilityMode: vi.fn(async () => false),
      setProviderPreference: vi.fn(),
      setCompatibilityMode: vi.fn(),
      setAvatar: vi.fn(),
      setPlate: vi.fn(),
      setDefaultGame: vi.fn(),
    }
    const queryService = new plugin.QueryService(repositories, { providerChain, settings })
    const renderedPng = await sharp({
      create: { width: 8, height: 8, channels: 4, background: '#00aa66' },
    }).png().toBuffer()
    const renderRating = vi.fn(async () => renderedPng)
    const registration = plugin.registerCoreCommands(app, {
      data,
      queryService,
      settingService: settings,
      bindRepository: repositories.bind,
      aliasService: { search: vi.fn(), add: vi.fn(), remove: vi.fn(), vote: vi.fn() },
      renderer: {
        renderRating,
        renderScore: vi.fn(),
        renderLevel: vi.fn(),
        renderCourse: vi.fn(),
        renderRadar: vi.fn(),
      },
      callbackRouter: new plugin.CommandCallbackRouter(),
    } as never)
    disposers.push(() => registration.dispose())
    await app.mock.initUser('flow-user', 1)
    const client = app.mock.client('flow-user', 'flow-channel')
    client.event.platform = 'qq'
    client.event.channel!.type = Universal.Channel.Type.TEXT
    client.event.guild = { id: 'flow-guild' } as never
    const sendMessage = vi.spyOn(client.bot, 'sendMessage')

    await client.shouldReply('/mai b50', /绑定您的QQ号/)
    await client.receive('/mai bind 12345678')
    await vi.waitFor(() => expect(renderRating).toHaveBeenCalledTimes(1))

    expect(await repositories.bind.getQq('flow-user')).toBe('12345678')
    expect(divingRating).toHaveBeenCalledTimes(1)
    expect(lxnsRating).toHaveBeenCalledTimes(1)
    expect(renderRating).toHaveBeenCalledWith(expect.objectContaining({ backend: 'LXNS' }))
    const output = JSON.stringify(sendMessage.mock.calls)
    expect(output).toContain('"type":"img"')
    expect(output).toContain('qq:rawmarkdown-without-keyboard')
  })

  it('persists encrypted LXNS OAuth tokens and replays the pending command after callback', async () => {
    const app = await databaseApp()
    const repositories = new plugin.MaiRepositories(app, 'oauth-flow-cipher')
    const send = vi.fn(async (_text: string) => undefined)
    const replay = vi.fn(async () => undefined)
    const exchangeOAuthCode = vi.fn(async (userId: string, code: string, redirectUri: string) => {
      expect(code).toBe('grant-code')
      expect(redirectUri).toBe('https://bot.example/mai-plugin/lxns/callback')
      await repositories.oauth.save({
        userId,
        provider: 'lxns',
        accessToken: 'access-secret',
        refreshToken: 'refresh-secret',
        expiresAt: new Date('2026-07-15T00:00:00.000Z'),
      })
    })
    const service = new plugin.UpdateService({
      publicBaseUrl: 'https://bot.example',
      oauth: { enabled: true, clientId: 'client-id' },
      lxns: { exchangeOAuthCode },
      bind: repositories.bind,
      fetchAuthorizationRedirect: vi.fn(),
      fetchDivingFishRecords: vi.fn(),
      importDivingFishRecords: vi.fn(),
    })
    disposers.push(() => service.dispose())

    const authorization = new URL(await service.beginLxnsOAuth({
      userId: 'oauth-user',
      platform: 'qq',
      channelId: 'oauth-channel',
      direct: false,
      pendingCommand: 'mai.rating B50',
      send,
      replay,
    }))
    await service.completeLxnsOAuth(authorization.searchParams.get('state')!, 'grant-code')

    const stored = await repositories.oauth.get('oauth-user')
    expect(stored).toMatchObject({
      accessToken: 'access-secret',
      refreshToken: 'refresh-secret',
    })
    const [raw] = await app.database.get('mai_oauth_token', { userId: 'oauth-user' })
    expect(raw.accessToken).not.toContain('access-secret')
    expect(raw.refreshToken).not.toContain('refresh-secret')
    expect(send).toHaveBeenCalledWith('落雪授权绑定成功。')
    expect(replay).toHaveBeenCalledWith('mai.rating B50')
  })

  it('runs the Diving Fish authorization redirect through the Host callback and reports import completion', async () => {
    const app = await databaseApp({ withServer: true })
    await new Promise<void>((resolve, reject) => {
      app.server._http.once('error', reject)
      app.server._http.listen(0, '127.0.0.1', resolve)
    })
    const address = app.server._http.address()
    if (!address || typeof address === 'string') throw new Error('server did not bind')
    const port = address.port
    const repositories = new plugin.MaiRepositories(app, 'update-flow-cipher')
    await repositories.bind.setImportToken('update-user', 'import-secret')
    const send = vi.fn(async (_text: string) => undefined)
    const fetchRecords = vi.fn(async () => [{
      title: 'Flow Track', achievements: 100.5, dxScore: 1_234,
      fc: 'fc' as const, fs: 'fs' as const, level_index: 3, type: 'DX' as const,
    }])
    const importRecords = vi.fn(async () => ({ creates: 1, updates: 2, message: 'ok' }))
    const publicBaseUrl = `http://tgk-wcaime.wahlap.com:${port}`
    const service = new plugin.UpdateService({
      publicBaseUrl,
      oauth: { enabled: false, clientId: '' },
      lxns: { exchangeOAuthCode: vi.fn() },
      bind: repositories.bind,
      fetchAuthorizationRedirect: vi.fn(async () => (
        'https://tgk-wcaime.wahlap.com/wc_auth/oauth/authorize/maimai-dx'
      )),
      fetchDivingFishRecords: fetchRecords,
      importDivingFishRecords: importRecords,
    })
    const routes = plugin.registerMaiServerRoutes(app, {
      service,
      proxy: { server: 'tgk-wcaime.wahlap.com', port },
      allowedWahlapHost: 'tgk-wcaime.wahlap.com',
    })
    disposers.push(() => routes.dispose(), () => service.dispose())
    const updateUrl = new URL(await service.beginDivingFishUpdate({
      userId: 'update-user', platform: 'qq', channelId: 'update-channel', direct: false,
      send, replay: vi.fn(),
    }))
    const token = updateUrl.searchParams.get('token')!

    const redirect = await fetch(`http://127.0.0.1:${port}/mai-plugin/update?token=${token}`, {
      redirect: 'manual',
    })
    expect(redirect.status).toBe(302)
    expect(new URL(redirect.headers.get('location')!).searchParams.get('redirect_uri')).toBe(
      `${publicBaseUrl}/wc_auth/oauth/callback/maimai-dx?token=${token}`,
    )

    const callbackStatus = await new Promise<number>((resolve, reject) => {
      const outgoing = request({
        hostname: '127.0.0.1',
        port,
        method: 'GET',
        path: `/wc_auth/oauth/callback/maimai-dx?token=${token}&r=1`,
        headers: { Host: `tgk-wcaime.wahlap.com:${port}` },
      }, (incoming) => {
        incoming.resume()
        incoming.on('end', () => resolve(incoming.statusCode ?? 0))
      })
      outgoing.once('error', reject)
      outgoing.end()
    })

    expect(callbackStatus).toBe(200)
    expect(fetchRecords).toHaveBeenCalledWith(
      'https://tgk-wcaime.wahlap.com/wc_auth/oauth/callback/maimai-dx?r=1',
    )
    expect(importRecords).toHaveBeenCalledWith('update-user', expect.any(Array), 'import-secret')
    expect(send.mock.calls.map(call => call[0])).toEqual([
      '正在爬取数据中……',
      '更新成功，已更新3条记录。',
    ])
  })

  it('shares queue updates across channels bound to the same arcade group', async () => {
    const app = await databaseApp()
    const repositories = new plugin.MaiRepositories(app, 'queue-flow-cipher')
    const queue = new plugin.QueueService(repositories.arcade, {
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    })

    await queue.addArcade('shared-group', 'North Arcade')
    await queue.addAlias('shared-group', 'North Arcade', 'north')
    await queue.bindGroup('other-channel', 'shared-group')
    await expect(queue.handleMessage('shared-group', 'north7')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 7 },
    })
    await expect(queue.handleMessage('other-channel', 'north几')).resolves.toMatchObject({
      type: 'query',
      text: expect.stringContaining('North Arcade: 7人'),
    })
  })

  it('starts guessing, emits a hint, clears correct answers, and restores an interrupted game', async () => {
    const music = musicFixture(30_001)
    const rows = new Map<string, any>()
    const repository = {
      save: vi.fn(async (game: any, modifiedAt = new Date()) => {
        rows.set(game.contextId, structuredClone({ ...game, modifiedAt }))
      }),
      restore: vi.fn(async () => [...rows.values()].map(row => structuredClone(row))),
      remove: vi.fn(async (contextId: string) => { rows.delete(contextId) }),
    }
    const timers = {
      setTimeout: vi.fn(() => Symbol('timer')),
      clearTimeout: vi.fn(),
    }
    const replies: plugin.GuessReply[] = []
    const options = {
      musics: new Map([[music.id, music]]),
      repository,
      aliasService: { search: vi.fn(async () => [music]) },
      renderer: {
        renderCrop: vi.fn(async () => Buffer.from('crop')),
        renderFinal: vi.fn(async () => Buffer.from('final')),
      },
      timers,
      random: () => 0,
      now: () => new Date('2026-07-14T12:00:00.000Z'),
    }
    const service = new plugin.GuessService(options)
    const interaction = (contextId: string) => ({
      contextId,
      platform: 'qq',
      channelId: contextId,
      guildId: 'guild',
      userId: 'guess-user',
      direct: false,
      reply: async (reply: plugin.GuessReply) => { replies.push(reply) },
    })
    disposers.push(() => service.dispose())

    await expect(service.startClassical(interaction('guess-live'))).resolves.toMatchObject({ ok: true })
    expect(replies.some(reply => reply.type === 'text' && reply.text.includes('提示1/7'))).toBe(true)
    await expect(service.handleMessage({
      ...interaction('guess-live'),
      content: music.name,
    })).resolves.toMatchObject({ consumed: true, action: 'correct' })
    expect(service.hasActiveGame('guess-live')).toBe(false)

    await service.startClassical(interaction('guess-reload'))
    const restoredReplies: plugin.GuessReply[] = []
    const restored = new plugin.GuessService({
      ...options,
      send: async (_target, reply) => { restoredReplies.push(reply) },
    })
    disposers.push(() => restored.dispose())
    await expect(restored.restore()).resolves.toBe(1)
    expect(restored.hasActiveGame('guess-reload')).toBe(true)
    await expect(restored.handleMessage({
      ...interaction('guess-reload'),
      reply: async reply => { restoredReplies.push(reply) },
      content: music.name,
    })).resolves.toMatchObject({ consumed: true, action: 'correct' })
    expect(restored.hasActiveGame('guess-reload')).toBe(false)
    expect(rows.has('guess-reload')).toBe(false)
  })
})
