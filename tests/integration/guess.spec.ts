import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'
import { Context, Universal } from '@koishijs/core'
import { describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src'

vi.mock('koishi', async () => import('@koishijs/core'))

function createMusic(id = 1001, name = 'Test Song') {
  const music = new plugin.MusicInfo(
    id,
    name,
    plugin.MusicType.Standard,
    '',
    'Test Artist',
    plugin.MusicGenre.Original,
    180,
    { id: 1, name: 'maimai DX 2025', version: 25_000 },
    true,
  )
  music.charts = [
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Basic, '4', 4, new plugin.Notes(100), 'Basic'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Advanced, '8', 8, new plugin.Notes(100), 'Advanced'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Expert, '12', 12, new plugin.Notes(100), 'Expert'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Master, '13+', 13.7, new plugin.Notes(100), 'Master'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.ReMaster, '14', 14, new plugin.Notes(100), 'ReMaster'),
  ]
  return music
}

class ManualTimers {
  now = Date.parse('2026-07-14T12:00:00.000Z')
  private sequence = 0
  private readonly tasks = new Map<number, { at: number, callback: () => void }>()
  readonly cleared = new Map<number, () => void>()

  setTimeout = (callback: () => void, delayMs: number) => {
    const id = ++this.sequence
    this.tasks.set(id, { at: this.now + Math.max(0, delayMs), callback })
    return id
  }

  clearTimeout = (handle: unknown) => {
    const id = Number(handle)
    const task = this.tasks.get(id)
    if (task) this.cleared.set(id, task.callback)
    this.tasks.delete(id)
  }

  get size() {
    return this.tasks.size
  }

  async advanceBy(delayMs: number) {
    const target = this.now + delayMs
    while (true) {
      const next = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      const [id, task] = next
      this.tasks.delete(id)
      this.now = task.at
      await task.callback()
    }
    this.now = target
  }

  async invokeCleared() {
    const callbacks = [...this.cleared.values()]
    this.cleared.clear()
    for (const callback of callbacks) await callback()
  }
}

function clone<T>(value: T): T {
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T
  if (value instanceof Date) return new Date(value) as T
  if (Array.isArray(value)) return value.map(clone) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, clone(nested)]),
    ) as T
  }
  return value
}

function createHarness(options: {
  musics?: plugin.MusicInfo[]
  restored?: any[]
  aliases?: Record<string, number[]>
} = {}) {
  const timers = new ManualTimers()
  const musics = options.musics ?? [createMusic()]
  const rows = new Map<string, any>()
  for (const row of options.restored ?? []) rows.set(row.contextId, clone(row))
  const transitions: any[] = []
  const repository = {
    save: vi.fn(async (game: any, modifiedAt = new Date()) => {
      const row = { ...clone(game), modifiedAt: new Date(modifiedAt) }
      rows.set(game.contextId, row)
      transitions.push(row)
    }),
    restore: vi.fn(async () => [...rows.values()].map(clone)),
    remove: vi.fn(async (contextId: string) => {
      rows.delete(contextId)
    }),
  }
  const aliasService = {
    search: vi.fn(async (query: string) => (
      options.aliases?.[query.trim()] ?? []
    ).map(id => musics.find(music => music.id === id)).filter(Boolean)),
  }
  const renderer = {
    renderCrop: vi.fn(async () => Buffer.from('crop-image')),
    renderFinal: vi.fn(async () => Buffer.from('final-image')),
  }
  const restoredReplies: any[] = []
  const service = new plugin.GuessService({
    musics: new Map(musics.map(music => [music.id, music])),
    repository,
    aliasService,
    renderer,
    now: () => new Date(timers.now),
    random: () => 0,
    timers,
    send: vi.fn(async (_target: unknown, reply: unknown) => {
      restoredReplies.push(clone(reply))
    }),
  } as any)
  const replies: any[] = []
  const interaction = (contextId = 'group:1000') => ({
    contextId,
    platform: 'mock',
    channelId: contextId.replace(/^.*:/, ''),
    guildId: contextId.startsWith('private:') ? null : 'guild-1',
    userId: '10001',
    direct: contextId.startsWith('private:'),
    reply: vi.fn(async (reply: unknown) => {
      replies.push(clone(reply))
    }),
  })
  return {
    service,
    timers,
    repository,
    rows,
    transitions,
    aliasService,
    renderer,
    replies,
    restoredReplies,
    interaction,
  }
}

async function createGuessCommandApp() {
  const app = new Context()
  app.plugin(memory)
  app.plugin(mock, { selfId: '514' })
  const harness = createHarness()
  const settings = new Map<string, string>()
  const settingRepository = {
    get: vi.fn(async (id: string, key: string) => settings.get(`${id}:${key}`) ?? null),
    set: vi.fn(async (id: string, key: string, value: string) => {
      settings.set(`${id}:${key}`, value)
    }),
  }
  const dependencies = {
    guessService: harness.service,
    settingRepository,
    settingService: { isCompatibilityMode: vi.fn(async () => false) },
    administrators: ['configured-admin'],
    compatibilityMode: false,
  }
  const registerGuessCommands = Reflect.get(plugin, 'registerGuessCommands')
  expect(registerGuessCommands).toBeTypeOf('function')
  const registration = registerGuessCommands(app, dependencies)
  await app.start()
  await app.mock.initUser('ordinary', 1)
  await app.mock.initUser('authority-admin', 4)
  await app.mock.initUser('configured-admin', 1)
  await app.mock.initUser('role-admin', 1)
  await app.mock.initUser('514', 1)
  return { app, harness, settings, settingRepository, dependencies, registration }
}

function asGroup(client: ReturnType<Context['mock']['client']>, guildId = 'guild-1') {
  client.event.channel.type = Universal.Channel.Type.TEXT
  client.event.guild = { id: guildId } as never
  return client
}

function asPrivate(client: ReturnType<Context['mock']['client']>) {
  client.event.channel.type = Universal.Channel.Type.DIRECT
  client.event.guild = undefined
  return client
}

function createConfig(): plugin.Config {
  return {
    developerTokens: { divingFish: '', lxns: '' },
    oauth: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      tokenCipherKey: 'guess-test-key',
    },
    resourceSync: {
      enabled: false,
      intervalMinutes: 60,
      timeoutMs: 10_000,
      cacheDir: 'data/maimai',
      staticBaseUrl: '',
      allowedHosts: [],
    },
    render: { concurrency: 1, queueLimit: 8, timeoutMs: 30_000 },
    publicBaseUrl: '',
    administrators: ['configured-admin'],
    compatibilityMode: false,
  }
}

function createCoreDependencies(
  harness: ReturnType<typeof createHarness>,
  settingRepository: { get: any, set: any },
) {
  const music = createMusic()
  return {
    data: {
      musics: new Map([[music.id, music]]),
      courses: new Map(),
      icons: new Map(),
      plates: new Map(),
    },
    aliasService: {
      search: vi.fn(async () => []),
      add: vi.fn(),
      remove: vi.fn(),
      vote: vi.fn(),
    },
    queryService: {
      getQueryParams: vi.fn(),
      consumePendingCommand: vi.fn(() => null),
      rating: vi.fn(),
      record: vi.fn(),
      records: vi.fn(),
      recent: vi.fn(),
    },
    settingService: {
      getDefaultGame: vi.fn(async () => 'maimai'),
      isCompatibilityMode: vi.fn(async () => false),
      setProviderPreference: vi.fn(),
      setCompatibilityMode: vi.fn(),
      setAvatar: vi.fn(),
      setPlate: vi.fn(),
      setDefaultGame: vi.fn(),
    },
    bindRepository: { setQq: vi.fn() },
    renderer: {
      renderRating: vi.fn(),
      renderScore: vi.fn(),
      renderLevel: vi.fn(),
      renderCourse: vi.fn(),
      renderRadar: vi.fn(),
    },
    callbackRouter: new plugin.CommandCallbackRouter(),
    guessService: harness.service,
    settingRepository,
    administrators: ['configured-admin'],
    compatibilityMode: false,
    now: () => new Date('2026-07-14T12:00:00.000Z'),
    random: () => 0,
  }
}

describe('maimai guessing games', () => {
  it('allows exactly one concurrent start for the same context', async () => {
    const GuessService = Reflect.get(plugin, 'GuessService')
    expect(GuessService).toBeTypeOf('function')

    let releaseSave!: () => void
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    const repository = {
      save: vi.fn(async () => saveGate),
      restore: vi.fn(async () => []),
      remove: vi.fn(async () => undefined),
    }
    const service = new GuessService({
      musics: new Map([[1001, createMusic()]]),
      repository,
      aliasService: { search: vi.fn(async () => []) },
      renderer: {
        renderCrop: vi.fn(async () => Buffer.from('crop')),
        renderFinal: vi.fn(async () => Buffer.from('final')),
      },
      random: () => 0,
      timers: {
        setTimeout: vi.fn(() => 1),
        clearTimeout: vi.fn(),
      },
    })
    const interaction = {
      contextId: 'group:1000',
      platform: 'mock',
      channelId: '1000',
      guildId: '1000',
      userId: '10001',
      direct: false,
      reply: vi.fn(async () => undefined),
    }

    const classical = service.startClassical(interaction)
    await Promise.resolve()
    const opening = service.startOpening(interaction)
    releaseSave()

    const results = await Promise.all([classical, opening])
    expect(results.filter(result => result.ok)).toHaveLength(1)
    expect(results.filter(result => !result.ok)).toEqual([
      { ok: false, reason: 'active' },
    ])
    expect(repository.save).toHaveBeenCalledTimes(1)
  })

  it('runs six classical hints, a deterministic crop, and the timed final transition', async () => {
    const harness = createHarness()

    await expect(harness.service.startClassical(harness.interaction()))
      .resolves.toEqual({ ok: true, type: 'classical' })

    expect(harness.replies).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('maimai 猜歌') }),
      expect.objectContaining({ type: 'text', text: expect.stringContaining('提示1/7') }),
    ])
    expect(harness.transitions.at(-1)?.status).toMatchObject({
      phase: 'hints',
      hintIndex: 1,
      nextAt: harness.timers.now + 10_000,
    })

    for (let index = 2; index <= 6; index++) {
      await harness.timers.advanceBy(10_000)
      expect(harness.replies.at(-1)).toMatchObject({
        type: 'text',
        text: expect.stringContaining(`提示${index}/7`),
      })
    }

    await harness.timers.advanceBy(10_000)
    expect(harness.renderer.renderCrop).toHaveBeenCalledWith(expect.objectContaining({
      contextId: 'group:1000',
      music: expect.objectContaining({ id: 1001 }),
      seed: expect.any(String),
    }))
    expect(harness.replies.at(-1)).toMatchObject({
      type: 'image',
      text: expect.stringContaining('30 秒后'),
      image: Buffer.from('crop-image'),
    })
    expect(harness.transitions.at(-1)?.status).toMatchObject({
      phase: 'crop',
      nextAt: harness.timers.now + 30_000,
    })

    await harness.timers.advanceBy(30_000)
    expect(harness.renderer.renderFinal).toHaveBeenCalledWith(expect.objectContaining({
      music: expect.objectContaining({ id: 1001 }),
      title: '很遗憾，没有人猜中哦',
    }))
    expect(harness.replies.at(-1)).toMatchObject({
      type: 'image',
      text: expect.stringContaining('Test Song'),
      image: Buffer.from('final-image'),
    })
    expect(harness.transitions.map(row => row.status.phase)).toEqual([
      'hints', 'hints', 'hints', 'hints', 'hints', 'hints', 'crop', 'finished',
    ])
    expect(harness.rows.has('group:1000')).toBe(false)
    expect(harness.timers.size).toBe(0)
  })

  it('accepts an alias answer and stop while rejecting a cleared stale timer', async () => {
    const harness = createHarness({ aliases: { alias: [1001] } })
    const interaction = harness.interaction()
    await harness.service.startClassical(interaction)

    await expect(harness.service.handleMessage({ ...interaction, content: 'alias' }))
      .resolves.toMatchObject({ consumed: true, action: 'correct' })
    expect(harness.renderer.renderFinal).toHaveBeenCalledWith(expect.objectContaining({
      title: '恭喜你猜中了哦~',
    }))
    expect(harness.rows.has('group:1000')).toBe(false)

    const savesAfterAnswer = harness.repository.save.mock.calls.length
    const repliesAfterAnswer = harness.replies.length
    await harness.timers.invokeCleared()
    expect(harness.repository.save).toHaveBeenCalledTimes(savesAfterAnswer)
    expect(harness.replies).toHaveLength(repliesAfterAnswer)

    await harness.service.startClassical(interaction)
    await expect(harness.service.handleMessage({ ...interaction, content: '不玩了' }))
      .resolves.toMatchObject({ consumed: true, action: 'stopped' })
    expect(harness.replies.at(-1)).toMatchObject({
      type: 'image',
      text: expect.stringContaining('游戏已结束'),
    })
    expect(harness.rows.has('group:1000')).toBe(false)
  })

  it('persists opening letters and songs with validation, aliases, and free answers', async () => {
    const musics = Array.from({ length: 9 }, (_, index) => (
      createMusic(2001 + index, `Song ${String.fromCharCode(65 + index)}${index}`)
    ))
    const harness = createHarness({
      musics,
      aliases: {
        first: [2001],
        second: [2002],
        missing: [2009],
      },
    })
    const interaction = harness.interaction()

    await expect(harness.service.startOpening(interaction))
      .resolves.toEqual({ ok: true, type: 'opening' })
    expect(harness.replies.at(-1)?.text).toContain('舞萌开字母')
    expect(harness.transitions.at(-1)?.status.musics).toHaveLength(8)

    await harness.service.handleMessage({ ...interaction, content: '开字母 s' })
    expect(harness.transitions.at(-1)?.status.opened).toEqual(['s'])
    expect(harness.replies.at(-1)?.text).toContain('S')

    const transitionsAfterLetter = harness.transitions.length
    await harness.service.handleMessage({ ...interaction, content: '开字母 S' })
    expect(harness.replies.at(-1)?.text).toContain('已经开过')
    expect(harness.transitions).toHaveLength(transitionsAfterLetter)

    await harness.service.handleMessage({ ...interaction, content: '开字母' })
    expect(harness.replies.at(-1)?.text).toContain('一个字符')
    await harness.service.handleMessage({ ...interaction, content: '开字母 ab' })
    expect(harness.replies.at(-1)?.text).toContain('一个字符')

    for (const letter of ['x', 'y', 'z', 'q', 'w', 'e', 'r']) {
      await harness.service.handleMessage({ ...interaction, content: `开字母 ${letter}` })
    }
    expect(harness.transitions.at(-1)?.status.opened).toHaveLength(8)
    const transitionsAtLimit = harness.transitions.length
    await harness.service.handleMessage({ ...interaction, content: '开字母 t' })
    expect(harness.replies.at(-1)?.text).toContain('最多只能开 8 个')
    expect(harness.transitions).toHaveLength(transitionsAtLimit)

    await harness.service.handleMessage({ ...interaction, content: '开歌 first' })
    expect(harness.transitions.at(-1)?.status.musics[0]).toMatchObject({
      musicId: 2001,
      revealed: true,
    })
    await harness.service.handleMessage({ ...interaction, content: 'second' })
    expect(harness.transitions.at(-1)?.status.musics[1]).toMatchObject({
      musicId: 2002,
      revealed: true,
    })
    expect(harness.replies.at(-1)?.text).toContain('恭喜你猜中了')

    await harness.service.handleMessage({ ...interaction, content: '开歌 unknown' })
    expect(harness.replies.at(-1)?.text).toBe('歌曲不存在！')
    await harness.service.handleMessage({ ...interaction, content: '开歌 missing' })
    expect(harness.replies.at(-1)?.text).toBe('歌曲不在题目列表中！')
  })

  it('restores one fresh timer from the persisted phase and replaces it idempotently', async () => {
    const nextAt = Date.parse('2026-07-14T12:00:05.000Z')
    const restored = [{
      contextId: 'group:restored',
      platform: 'mock',
      channelId: 'restored',
      guildId: 'guild-1',
      userId: '10001',
      type: 'classical',
      status: {
        version: 1,
        phase: 'hints',
        gameId: 'restored-game',
        musicId: 1001,
        hints: Array.from({ length: 6 }, (_, index) => `提示${index + 1}/7：hint`),
        hintIndex: 2,
        nextAt,
        seed: 'stable-seed',
      },
      modifiedAt: new Date('2026-07-14T11:45:00.000Z'),
    }]
    const harness = createHarness({
      restored: [
        ...restored,
        {
          ...restored[0],
          contextId: 'group:invalid',
          status: { ...restored[0].status, nextAt: null },
        },
      ],
    })

    await expect(harness.service.restore()).resolves.toBe(1)
    expect(harness.timers.size).toBe(1)
    await expect(harness.service.restore()).resolves.toBe(1)
    expect(harness.timers.size).toBe(1)

    await harness.timers.advanceBy(5_000)
    expect(harness.restoredReplies).toEqual([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('提示3/7') }),
    ])
    expect(harness.transitions.at(-1)?.status).toMatchObject({
      hintIndex: 3,
      seed: 'stable-seed',
    })
    expect(harness.rows.has('group:invalid')).toBe(false)
  })

  it('cleans failed starts, disposal, timers, and persisted rows', async () => {
    const harness = createHarness()
    const interaction = harness.interaction()
    interaction.reply.mockRejectedValueOnce(new Error('send failed'))

    await expect(harness.service.startClassical(interaction)).rejects.toThrow('send failed')
    expect(harness.rows.has('group:1000')).toBe(false)
    expect(harness.timers.size).toBe(0)

    interaction.reply.mockResolvedValue(undefined)
    await harness.service.startClassical(interaction)
    await harness.service.startOpening(harness.interaction('group:2000'))
    expect(harness.timers.size).toBe(1)

    await harness.service.dispose()
    expect(harness.timers.size).toBe(0)
    expect(harness.rows.size).toBe(0)
    await expect(harness.service.startClassical(interaction))
      .resolves.toEqual({ ok: false, reason: 'unavailable' })
    expect(harness.rows.size).toBe(0)
  })

  it('waits for an in-flight start before disposal completes cleanup', async () => {
    const harness = createHarness()
    const originalSave = harness.repository.save.getMockImplementation()!
    let enterSave!: () => void
    let releaseSave!: () => void
    const saveEntered = new Promise<void>((resolve) => {
      enterSave = resolve
    })
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve
    })
    harness.repository.save.mockImplementationOnce(async (...args: any[]) => {
      enterSave()
      await saveGate
      return originalSave(...args)
    })

    const starting = harness.service.startClassical(harness.interaction())
    await saveEntered
    const disposing = harness.service.dispose()
    releaseSave()
    await Promise.all([starting, disposing])

    expect(harness.rows.size).toBe(0)
    expect(harness.timers.size).toBe(0)
    expect(harness.service.hasActiveGame('group:1000')).toBe(false)
  })

  it('keeps the context locked until persisted removal finishes', async () => {
    const harness = createHarness()
    const interaction = harness.interaction()
    await harness.service.startClassical(interaction)
    const originalRemove = harness.repository.remove.getMockImplementation()!
    let enterRemove!: () => void
    let releaseRemove!: () => void
    const removeEntered = new Promise<void>((resolve) => {
      enterRemove = resolve
    })
    const removeGate = new Promise<void>((resolve) => {
      releaseRemove = resolve
    })
    harness.repository.remove.mockImplementationOnce(async (...args: any[]) => {
      enterRemove()
      await removeGate
      return originalRemove(...args)
    })

    const stopping = harness.service.stop('group:1000')
    await removeEntered
    let replacementSettled = false
    const replacement = harness.service.startOpening(interaction).finally(() => {
      replacementSettled = true
    })
    await Promise.resolve()
    expect(replacementSettled).toBe(false)
    releaseRemove()
    const [, result] = await Promise.all([stopping, replacement])

    expect(result).toEqual({ ok: true, type: 'opening' })
    expect(harness.rows.has('group:1000')).toBe(true)
  })

  it('waits out an in-flight timer transition before disposal removes its final row', async () => {
    const harness = createHarness()
    const interaction = harness.interaction()
    let releaseHint!: () => void
    let enterHint!: () => void
    const hintEntered = new Promise<void>((resolve) => {
      enterHint = resolve
    })
    const hintGate = new Promise<void>((resolve) => {
      releaseHint = resolve
    })
    interaction.reply.mockImplementation(async (reply: any) => {
      if (reply.type === 'text' && reply.text.includes('提示2/7')) {
        enterHint()
        await hintGate
      }
    })
    await harness.service.startClassical(interaction)

    const advancing = harness.timers.advanceBy(10_000)
    await hintEntered
    const disposing = harness.service.dispose()
    releaseHint()
    await Promise.all([advancing, disposing])

    expect(harness.rows.size).toBe(0)
    expect(harness.timers.size).toBe(0)
  })

  it('does not retry a failed final image delivery as an ambiguous text send', async () => {
    const harness = createHarness({ aliases: { alias: [1001] } })
    const interaction = harness.interaction()
    await harness.service.startClassical(interaction)
    const callsBeforeAnswer = interaction.reply.mock.calls.length
    interaction.reply.mockRejectedValueOnce(new Error('transport failed'))

    await expect(harness.service.handleMessage({ ...interaction, content: 'alias' }))
      .rejects.toThrow('transport failed')
    expect(interaction.reply).toHaveBeenCalledTimes(callsBeforeAnswer + 1)
    expect(harness.rows.has('group:1000')).toBe(false)
  })

  it('renders deterministic nonblank crop and final PNGs through Takumi fallback assets', async () => {
    const TakumiGuessRenderer = Reflect.get(plugin, 'TakumiGuessRenderer')
    expect(TakumiGuessRenderer).toBeTypeOf('function')

    const renderService = new plugin.TakumiRenderService({
      concurrency: 2,
      queueLimit: 8,
      timeoutMs: 30_000,
    })
    const renderer = new TakumiGuessRenderer(renderService, {
      coverPath: () => 'Z:\\definitely-missing\\cover.png',
    })
    const music = createMusic()

    const [first, second, other, final] = await Promise.all([
      renderer.renderCrop({ contextId: 'group:1000', music, seed: 'stable-seed' }),
      renderer.renderCrop({ contextId: 'group:1000', music, seed: 'stable-seed' }),
      renderer.renderCrop({ contextId: 'group:1000', music, seed: 'other-seed' }),
      renderer.renderFinal({ music, title: '答案揭晓', description: '1001. Test Song' }),
    ])
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    for (const image of [first, second, other, final]) {
      expect(image.subarray(0, 8)).toEqual(pngSignature)
      expect(image.byteLength).toBeGreaterThan(1_000)
      expect(image.subarray(8).some(byte => byte !== 0)).toBe(true)
    }
    expect(first).toEqual(second)
    expect(final).not.toEqual(first)
  }, 60_000)

  it('routes exact starts and active-game messages through one real middleware listener', async () => {
    const { app, registration } = await createGuessCommandApp()
    const downstream = vi.fn(async (_session, next) => next())
    app.middleware(downstream)
    const client = asGroup(app.mock.client('ordinary', 'group-a'))

    try {
      await client.shouldNotReply('开字母 x')
      expect(downstream).toHaveBeenCalledTimes(1)

      const started = await client.receive('猜歌')
      expect(started.join('\n')).toMatch(/maimai 猜歌.*提示1\/7/s)
      expect(downstream).toHaveBeenCalledTimes(1)

      await client.shouldReply('舞萌开字母', /正在进行/)
      await client.shouldNotReply('wrong answer')
      expect(downstream).toHaveBeenCalledTimes(1)

      await client.shouldReply('不玩了', /游戏已结束/)
      expect(app.$commander.get('mai.guess')).toBeDefined()

      await registration.dispose()
      expect(app.$commander.get('mai.guess')).toBeUndefined()
      await client.shouldNotReply('猜歌')
      expect(downstream).toHaveBeenCalledTimes(2)
    } finally {
      await registration.dispose()
    }
  })

  it('persists isolated group settings and accepts authority, configured, or role administrators', async () => {
    const { app, registration, settings } = await createGuessCommandApp()
    const ordinary = asGroup(app.mock.client('ordinary', 'group-a'))
    const authorityAdmin = asGroup(app.mock.client('authority-admin', 'group-a'))
    const configuredAdmin = asGroup(app.mock.client('configured-admin', 'group-a'))
    const roleAdmin = asGroup(app.mock.client('role-admin', 'group-c'))
    roleAdmin.event.member = { roles: [{ id: 'admin' }] } as never
    const otherGroup = asGroup(app.mock.client('ordinary', 'group-b'))
    const privateClient = asPrivate(app.mock.client('ordinary', 'private:ordinary'))

    try {
      await ordinary.shouldReply('禁用猜歌', /权限不足/)
      await authorityAdmin.shouldReply('禁用猜歌', /禁用猜歌成功/)
      expect(settings.get('group-a:guess')).toBe('false')
      await ordinary.shouldReply('猜歌', /已被禁用/)

      await otherGroup.shouldReply('猜歌', [/maimai 猜歌/, /提示1\/7/])
      await configuredAdmin.shouldReply('启用猜歌', /启用猜歌成功/)
      expect(settings.get('group-a:guess')).toBe('true')
      await roleAdmin.shouldReply('关闭猜歌', /禁用猜歌成功/)
      expect(settings.get('group-c:guess')).toBe('false')

      await privateClient.shouldReply('禁用猜歌', /仅支持群聊/)
      await privateClient.shouldReply('猜歌', [/maimai 猜歌/, /提示1\/7/])
    } finally {
      await registration.dispose()
    }
  })

  it('registers and disposes guessing through the core command lifecycle', async () => {
    const app = new Context()
    app.plugin(memory)
    app.plugin(mock, { selfId: '514' })
    const harness = createHarness()
    const settingRepository = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined),
    }
    const disposeGuess = vi.spyOn(harness.service, 'dispose')
    const registration = plugin.registerCoreCommands(
      app,
      createCoreDependencies(harness, settingRepository) as any,
    )
    await app.start()
    await app.mock.initUser('ordinary', 1)
    const client = asGroup(app.mock.client('ordinary', 'core-group'))

    expect(app.$commander.get('mai.guess')).toBeDefined()
    await client.shouldReply('猜歌', [/maimai 猜歌/, /提示1\/7/])

    await registration.dispose()
    expect(app.$commander.get('mai.guess')).toBeUndefined()
    expect(disposeGuess).toHaveBeenCalledTimes(1)
    await client.shouldNotReply('猜歌')
  })

  it('creates and restores the guessing service through default dependencies', async () => {
    const app = new Context()
    app.plugin(memory)
    plugin.registerMaiDatabaseModels(app)
    await app.start()
    const music = createMusic()
    const data = {
      musics: new Map([[music.id, music]]),
      courses: new Map(),
      icons: new Map(),
      plates: new Map(),
      coverPath: () => plugin.resolvePackageAssetPath('fallback/cover.png'),
    }
    const repositories = new plugin.MaiRepositories(app, 'guess-test-key')
    await repositories.guess.save({
      contextId: 'mock:channel:restored',
      platform: 'mock',
      channelId: 'restored',
      guildId: 'guild-1',
      userId: 'ordinary',
      type: 'opening',
      status: {
        version: 1,
        phase: 'playing',
        gameId: 'persisted-opening',
        musics: [{ musicId: music.id, revealed: false }],
        opened: [],
      },
    }, new Date())

    try {
      const dependencies = await plugin.createDefaultCommandDependencies(
        app,
        { config: createConfig(), publicBaseUrl: '' },
        {
          dataSync: { startup: vi.fn(async () => data) } as any,
          renderer: new plugin.TakumiRenderService({ concurrency: 1, queueLimit: 4 }),
        },
      ) as any

      expect(dependencies.guessService).toBeInstanceOf(plugin.GuessService)
      expect(dependencies.settingRepository).toMatchObject({
        get: expect.any(Function),
        set: expect.any(Function),
      })
      expect(dependencies.guessService.hasActiveGame('mock:channel:restored')).toBe(true)
      await dependencies.guessService.dispose()
    } finally {
      await app.stop()
    }
  })

  it('restores only rows newer than thirty minutes and leaves opening games timer-free', async () => {
    const app = new Context()
    app.plugin(memory)
    plugin.registerMaiDatabaseModels(app)
    await app.start()
    const now = new Date('2026-07-14T12:00:00.000Z')
    const music = createMusic()
    const repositories = new plugin.MaiRepositories(app, 'guess-test-key')
    const game = {
      platform: 'mock',
      channelId: 'channel',
      guildId: 'guild-1',
      userId: 'ordinary',
      type: 'opening' as const,
      status: {
        version: 1,
        phase: 'playing',
        gameId: 'boundary-game',
        musics: [{ musicId: music.id, revealed: false }],
        opened: [],
      },
    }
    await repositories.guess.save(
      { contextId: 'fresh', ...game },
      new Date(now.getTime() - plugin.GUESS_GAME_TTL_MS + 1),
    )
    await repositories.guess.save(
      { contextId: 'expired', ...game },
      new Date(now.getTime() - plugin.GUESS_GAME_TTL_MS),
    )
    const timers = new ManualTimers()
    timers.now = now.getTime()
    const service = new plugin.GuessService({
      musics: new Map([[music.id, music]]),
      repository: repositories.guess,
      aliasService: { search: vi.fn(async () => []) },
      renderer: {
        renderCrop: vi.fn(async () => Buffer.from('crop')),
        renderFinal: vi.fn(async () => Buffer.from('final')),
      },
      now: () => new Date(timers.now),
      timers,
    })

    try {
      await expect(service.restore()).resolves.toBe(1)
      expect(service.hasActiveGame('fresh')).toBe(true)
      expect(service.hasActiveGame('expired')).toBe(false)
      expect(timers.size).toBe(0)
      expect(await app.database.get('mai_guess_game', { contextId: 'expired' })).toEqual([])
    } finally {
      await service.dispose()
      await app.stop()
    }
  })

  it('uses QQ rich replies only outside compatibility mode', async () => {
    const { app, registration, dependencies } = await createGuessCommandApp()
    const richClient = asGroup(app.mock.client('ordinary', 'qq-rich'))
    richClient.event.platform = 'qq'
    const fallbackClient = asGroup(app.mock.client('ordinary', 'qq-fallback'))
    fallbackClient.event.platform = 'qq'

    try {
      const rich = await richClient.receive('猜歌')
      expect(rich.join('\n')).toContain('<qq:rawmarkdown-without-keyboard')

      dependencies.settingService.isCompatibilityMode.mockResolvedValue(true)
      const fallback = await fallbackClient.receive('猜歌')
      expect(fallback.join('\n')).toContain('maimai 猜歌')
      expect(fallback.join('\n')).not.toContain('<qq:')
    } finally {
      await registration.dispose()
    }
  })

  it('does not retry an ambiguously failed startup delivery', async () => {
    const harness = createHarness()
    const send = vi.fn(async () => {
      throw new Error('transport failed')
    })
    const middleware = plugin.createGuessMiddleware({
      guessService: harness.service,
      settingRepository: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => undefined),
      },
      settingService: { isCompatibilityMode: vi.fn(async () => false) },
    })
    const session = {
      platform: 'mock',
      userId: 'ordinary',
      channelId: 'failed-start',
      guildId: 'guild-1',
      selfId: '514',
      isDirect: false,
      content: '猜歌',
      event: { user: { id: 'ordinary' } },
      user: { authority: 1 },
      send,
    }

    await expect(middleware(session as any, vi.fn())).resolves.toBeUndefined()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
