import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'
import { Context, Universal } from '@koishijs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src'

vi.mock('koishi', async () => import('@koishijs/core'))

describe('arcade queue service', () => {
  let app: Context
  let repositories: plugin.MaiRepositories
  let service: plugin.QueueService

  beforeEach(async () => {
    app = new Context()
    app.plugin(memory)
    plugin.registerMaiDatabaseModels(app)
    await app.start()
    repositories = new plugin.MaiRepositories(app, 'queue-test-key')
    service = new plugin.QueueService(repositories.arcade)
  })

  afterEach(async () => {
    await app.stop()
  })

  it('creates an arcade with its name as the initial alias and a zero count', async () => {
    await service.addArcade('channel-a', '测试')

    expect(await repositories.arcade.find('channel-a', '测试')).toMatchObject({
      name: '测试',
      aliases: ['测试'],
      value: 0,
    })
  })

  it('ports alias, deletion, and group-binding management operations', async () => {
    await service.addArcade('shared-group', '测试')
    await service.addAlias('shared-group', '测试', 'test')

    expect(await service.aliases('shared-group', '测试')).toEqual(['测试', 'test'])

    await service.deleteAlias('shared-group', '测试', 'test')
    expect(await service.aliases('shared-group', '测试')).toEqual(['测试'])

    await service.bindGroup('channel-b', 'shared-group')
    expect(await repositories.arcade.find('channel-b', '测试')).toMatchObject({
      groupId: (await repositories.arcade.find('shared-group', '测试'))?.groupId,
    })

    await service.deleteArcade('channel-b', '测试')
    expect(await repositories.arcade.list('shared-group')).toEqual([])
  })

  it('normalizes names and enforces Kotlin arcade, alias, and group limits', async () => {
    await expect(service.addArcade('validation', '   ')).rejects.toMatchObject({
      code: 'invalid-arcade-name',
      message: '请输入正确的机厅名称！',
    })
    await expect(service.addArcade('validation', 'x'.repeat(33))).rejects.toMatchObject({
      code: 'arcade-name-too-long',
      message: '机厅名称过长！',
    })

    await service.addArcade('validation', '  测试  ')
    await expect(service.addAlias('validation', '测试', undefined as never)).rejects.toMatchObject({
      code: 'alias-required',
      message: '请输入别名！',
    })
    await expect(service.addAlias('validation', '测试', ' ,,, ')).rejects.toMatchObject({
      code: 'invalid-alias',
      message: '请输入正确的别名！',
    })
    await expect(service.addAlias('validation', '测试', 'x'.repeat(33))).rejects.toMatchObject({
      code: 'alias-too-long',
      message: '别名长度过长！',
    })

    await service.addAlias('validation', ' 测试 ', ' t,e,s,t ')
    expect(await service.aliases('validation', '测试')).toEqual(['测试', 'test'])

    await expect(service.bindGroup('validation', '   ')).rejects.toMatchObject({
      code: 'invalid-group-name',
      message: '请输入正确的分组名称！',
    })
    await expect(service.bindGroup('validation', 'x'.repeat(33))).rejects.toMatchObject({
      code: 'group-name-too-long',
      message: '分组名称过长！',
    })
  })

  it('rejects case-insensitive conflicts across every arcade name and alias', async () => {
    await service.addArcade('conflicts', 'North')
    await service.addAlias('conflicts', 'North', 'N')

    await expect(service.addArcade('conflicts', 'north')).rejects.toMatchObject({
      code: 'arcade-exists',
      message: '机厅已存在！',
    })
    await expect(service.addArcade('conflicts', 'n')).rejects.toMatchObject({
      code: 'arcade-exists',
      message: '机厅已存在！',
    })

    await service.addArcade('conflicts', 'South')
    for (const alias of ['NORTH', 'n']) {
      await expect(service.addAlias('conflicts', 'South', alias)).rejects.toMatchObject({
        code: 'alias-exists',
        message: '别名已存在！',
      })
    }
  })

  it('maps missing arcade and group operations to exact management errors', async () => {
    await expect(service.deleteArcade('missing', 'North')).rejects.toMatchObject({
      code: 'arcade-not-found',
      message: '机厅不存在！',
    })
    await expect(service.addAlias('missing', 'North', 'N')).rejects.toMatchObject({
      code: 'arcade-not-found',
      message: '机厅不存在！',
    })
    await expect(service.bindGroup('missing', 'unknown')).rejects.toMatchObject({
      code: 'group-not-found',
      message: '该分组不存在。',
    })
  })

  it('supports every exact natural count form with a zero floor and fifty-person cap', async () => {
    const now = new Date('2026-07-14T12:00:00.000Z')
    service = new plugin.QueueService(repositories.arcade, { now: () => now })
    await service.addArcade('updates', 'Test Arcade')
    await service.addAlias('updates', 'Test Arcade', 'jt')

    await expect(service.handleMessage('updates', 'jt+3')).resolves.toMatchObject({
      type: 'updated',
      text: '更新成功，现在Test Arcade人数为3人。',
      arcade: { name: 'Test Arcade', value: 3, modifiedAt: now },
    })
    await expect(service.handleMessage('updates', 'JT-2')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 1 },
    })
    await expect(service.handleMessage('updates', 'jt10')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 10 },
    })
    await expect(service.handleMessage('updates', 'jt=7')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 7 },
    })
    await expect(service.handleMessage('updates', '/mai jt + 2')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 9 },
    })
    await expect(service.handleMessage('updates', '/mai /jt + 1')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 10 },
    })
    await expect(service.handleMessage('updates', 'jt-999999999999999999999')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 0 },
    })

    await expect(service.handleMessage('updates', 'jt51')).resolves.toEqual({
      type: 'too-large',
      text: '机厅很小，请你忍一忍',
    })
    expect((await repositories.arcade.find('updates', 'jt'))?.value).toBe(0)
  })

  it('passes through partial, malformed, and ambiguous alias text without mutation', async () => {
    await service.addArcade('exactness', 'First')
    await service.addAlias('exactness', 'First', 'jt')
    await service.addArcade('exactness', 'Second')
    await service.addAlias('exactness', 'Second', 'jt1')

    for (const content of [
      'prefixjt3',
      'jt3people',
      'jt+',
      'jt++3',
      'jt+3x',
      'jt12',
      'jt1',
    ]) {
      await expect(service.handleMessage('exactness', content)).resolves.toBeNull()
    }

    expect((await repositories.arcade.find('exactness', 'First'))?.value).toBe(0)
    expect((await repositories.arcade.find('exactness', 'Second'))?.value).toBe(0)
  })

  it('rejects oversized numeric messages before reading queue state', async () => {
    const list = vi.spyOn(repositories.arcade, 'list')

    await expect(
      service.handleMessage('oversized', `jt${'9'.repeat(4096)}`),
    ).resolves.toBeNull()
    expect(list).not.toHaveBeenCalled()
  })

  it('formats all and named queue queries with Kotlin relative update times', async () => {
    const now = new Date(2026, 6, 14, 12, 0, 0)
    service = new plugin.QueueService(repositories.arcade, { now: () => now })
    await service.addArcade('queries', 'North')
    await service.addAlias('queries', 'North', 'n')
    await service.addArcade('queries', 'South')
    await repositories.arcade.setCount(
      'queries',
      'North',
      3,
      new Date(2026, 6, 14, 11, 30, 0),
    )
    await repositories.arcade.setCount(
      'queries',
      'South',
      4,
      new Date(2026, 6, 14, 9, 45, 0),
    )

    const expectedText = [
      '机厅排卡人数：',
      '',
      'North: 3人 (更新于 1 小时内)',
      'South: 4人 (更新于 2 小时前)',
      '',
      '更新数据请使用“机厅名+数量”的格式，如 “jt3” 或 “jt+1” 或 “jt-1”。',
    ].join('\n')
    for (const trigger of ['j', '几', '几个', '/j', '/mai 几']) {
      await expect(service.handleMessage('queries', trigger)).resolves.toMatchObject({
        type: 'query',
        text: expectedText,
        arcades: [{ name: 'North', value: 3 }, { name: 'South', value: 4 }],
      })
    }

    await expect(service.handleMessage('queries', 'N几')).resolves.toMatchObject({
      type: 'query',
      text: 'North: 3人 (更新于 1 小时内)',
      arcades: [{ name: 'North', value: 3 }],
    })
    await expect(service.handleMessage('queries', 'unknown几')).resolves.toBeNull()
  })

  it('answers empty-group queries without creating or mutating a group', async () => {
    await expect(service.handleMessage('empty', '几')).resolves.toEqual({
      type: 'empty',
      text: '当前群未设置机厅，请使用“@可怜BOT /排卡管理 添加机厅”来添加机厅。',
    })
    expect(await repositories.arcade.findGroup('empty')).toBeNull()
  })

  it('clears previous-local-day counts before a query or relative update', async () => {
    const now = new Date(2026, 6, 14, 0, 0, 0)
    service = new plugin.QueueService(repositories.arcade, { now: () => now })
    await service.addArcade('rollover', 'North')
    await service.addAlias('rollover', 'North', 'n')
    const previousDay = new Date(2026, 6, 13, 23, 59, 59)
    await repositories.arcade.setCount('rollover', 'North', 5, previousDay)

    await expect(service.handleMessage('rollover', '几')).resolves.toMatchObject({
      type: 'query',
      text: 'North: 0人 (今日未更新数据)',
      arcades: [{ value: 0 }],
    })
    expect((await repositories.arcade.find('rollover', 'North'))?.value).toBe(0)

    await repositories.arcade.setCount('rollover', 'North', 5, previousDay)
    await expect(service.handleMessage('rollover', 'n+2')).resolves.toMatchObject({
      type: 'updated',
      arcade: { value: 2, modifiedAt: now },
    })
  })

  it('shares atomic count state across bound channels without lost updates', async () => {
    const secondRepositories = new plugin.MaiRepositories(app, 'queue-test-key')
    const secondService = new plugin.QueueService(secondRepositories.arcade)
    await service.addArcade('shared', 'North')
    await service.addAlias('shared', 'North', 'n')
    await service.bindGroup('other-channel', 'shared')

    const results = await Promise.all(Array.from({ length: 64 }, (_, index) => (
      (index % 2 ? service : secondService).handleMessage(
        index % 2 ? 'shared' : 'other-channel',
        'n+1',
      )
    )))

    expect(results.filter(result => result?.type === 'updated')).toHaveLength(50)
    expect(results.filter(result => result?.type === 'too-large')).toHaveLength(14)
    expect((await repositories.arcade.find('shared', 'North'))?.value).toBe(50)
    expect((await secondRepositories.arcade.find('other-channel', 'n'))?.value).toBe(50)

    await Promise.all(Array.from({ length: 80 }, (_, index) => (
      (index % 2 ? service : secondService).handleMessage(
        index % 2 ? 'shared' : 'other-channel',
        'n-1',
      )
    )))
    expect((await repositories.arcade.find('shared', 'North'))?.value).toBe(0)
  })

  it('gives duplicate arcade and alias races one deterministic winner', async () => {
    const secondRepositories = new plugin.MaiRepositories(app, 'queue-test-key')
    const secondService = new plugin.QueueService(secondRepositories.arcade)
    const creations = await Promise.allSettled([
      service.addArcade('races', 'North'),
      secondService.addArcade('races', 'north'),
    ])

    expect(creations.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(creations.filter(result => (
      result.status === 'rejected'
      && result.reason instanceof plugin.QueueServiceError
      && result.reason.code === 'arcade-exists'
    ))).toHaveLength(1)

    await service.bindGroup('race-peer', 'races')
    const aliases = await Promise.allSettled([
      service.addAlias('races', 'North', 'N'),
      secondService.addAlias('race-peer', 'north', 'n'),
    ])
    expect(aliases.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(aliases.filter(result => (
      result.status === 'rejected'
      && result.reason instanceof plugin.QueueServiceError
      && result.reason.code === 'alias-exists'
    ))).toHaveLength(1)
  })
})

async function createQueueCommandApp() {
  const app = new Context()
  app.plugin(memory)
  app.plugin(mock, { selfId: '514' })
  plugin.registerMaiDatabaseModels(app)
  const repositories = new plugin.MaiRepositories(app, 'queue-command-key')
  const queueService = new plugin.QueueService(repositories.arcade)
  const middleware = vi.spyOn(app, 'middleware')
  const registerQueueCommands = Reflect.get(plugin, 'registerQueueCommands')
  expect(registerQueueCommands).toBeTypeOf('function')
  const registration = registerQueueCommands(app, {
    queueService,
    settingService: { isCompatibilityMode: vi.fn(async () => false) },
    administrators: ['configured-admin'],
  })
  expect(middleware).toHaveBeenCalledTimes(1)
  expect(middleware).toHaveBeenCalledWith(expect.any(Function), false)
  middleware.mockRestore()
  await app.start()
  await app.mock.initUser('ordinary', 1)
  await app.mock.initUser('authority-admin', 4)
  await app.mock.initUser('configured-admin', 1)
  await app.mock.initUser('role-admin', 1)
  await app.mock.initUser('role-owner', 1)
  await app.mock.initUser('514', 1)
  return { app, repositories, queueService, registration }
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

describe('arcade queue commands', () => {
  it('registers one low-priority middleware and restricts management by admin policy', async () => {
    const { app, repositories, registration } = await createQueueCommandApp()
    const ordinary = asGroup(app.mock.client('ordinary', 'management'))
    const admin = asGroup(app.mock.client('authority-admin', 'management'))

    try {
      await ordinary.shouldReply('/mai 排卡管理 添加机厅 North', '权限不足。')
      expect(await repositories.arcade.findGroup('management')).toBeNull()

      await admin.shouldReply('/mai 排卡管理 添加机厅 North', '添加机厅成功。')
      expect(await repositories.arcade.find('management', 'North')).toMatchObject({ value: 0 })
    } finally {
      await registration.dispose()
    }
  })

  it('ports every management operation and exact validation or conflict response', async () => {
    const { app, repositories, registration } = await createQueueCommandApp()
    const admin = asGroup(app.mock.client('authority-admin', 'operations'))
    const target = asGroup(app.mock.client('authority-admin', 'shared-target'))

    try {
      await admin.shouldReply('/mai 排卡管理', /本功能可以提供机厅人数查询/)
      await admin.shouldReply('/mai 排卡管理 添加机厅', '使用方法：/排卡管理 添加机厅 机厅名称')
      await admin.shouldReply('/mai 排卡管理 添加机厅 North', '添加机厅成功。')
      await admin.shouldReply('/mai 排卡管理 添加机厅 north', '机厅已存在！')
      await admin.shouldReply('/mai 排卡管理 添加别名 North', '请输入别名！')
      await admin.shouldReply('/mai 排卡管理 添加别名 North n', '添加机厅别名成功。')
      await admin.shouldReply('/mai 排卡管理 添加别名 North N', '别名已存在！')
      await admin.shouldReply('/mai 排卡管理 查看别名 North', '机厅别名如下：North，n')
      await admin.shouldReply('/mai 排卡管理 删除别名 North n', '删除机厅别名成功。')
      await admin.shouldReply('/mai 排卡管理 删除机厅 North', '删除机厅成功。')
      await admin.shouldReply('/mai 排卡管理 删除机厅 North', '机厅不存在！')

      await target.shouldReply('/mai 排卡管理 添加机厅 South', '添加机厅成功。')
      await admin.shouldReply('/mai 排卡管理 添加分组 missing-group', '该分组不存在。')
      await admin.shouldReply('/mai 排卡管理 添加分组 shared-target', '设置分组成功。')
      expect(await repositories.arcade.find('operations', 'South')).toMatchObject({ name: 'South' })
    } finally {
      await registration.dispose()
    }
  })

  it('accepts configured, group-admin, and group-owner administrators but rejects private management', async () => {
    const { app, repositories, registration } = await createQueueCommandApp()
    const configured = asGroup(app.mock.client('configured-admin', 'configured-group'))
    const roleAdmin = asGroup(app.mock.client('role-admin', 'role-group'))
    roleAdmin.event.member = { roles: [{ id: 'admin' }] } as never
    const roleOwner = asGroup(app.mock.client('role-owner', 'owner-group'))
    roleOwner.event.member = { roles: [{ id: 'owner' }] } as never
    const privateAdmin = asPrivate(app.mock.client('configured-admin', 'private-channel'))

    try {
      await configured.shouldReply('/mai 排卡管理 添加机厅 Configured', '添加机厅成功。')
      await roleAdmin.shouldReply('/mai 排卡管理 添加机厅 Role', '添加机厅成功。')
      await roleOwner.shouldReply('/mai 排卡管理 添加机厅 Owner', '添加机厅成功。')
      await privateAdmin.shouldReply('/mai 排卡管理 添加机厅 Private', '排卡管理仅支持群聊。')
      expect(await repositories.arcade.findGroup('private-channel')).toBeNull()
    } finally {
      await registration.dispose()
    }
  })

  it('lets ordinary group users update and query while exact unknown text reaches next', async () => {
    const { app, repositories, registration } = await createQueueCommandApp()
    const admin = asGroup(app.mock.client('authority-admin', 'natural'))
    const ordinary = asGroup(app.mock.client('ordinary', 'natural'))
    const downstream = vi.fn(async () => undefined)
    app.middleware(downstream)

    try {
      await admin.shouldReply('/mai 排卡管理 添加机厅 North', '添加机厅成功。')
      downstream.mockClear()
      await ordinary.shouldReply('North+3', '更新成功，现在North人数为3人。')
      expect(downstream).not.toHaveBeenCalled()

      await ordinary.shouldReply('几', /North: 3人/)
      expect(downstream).not.toHaveBeenCalled()

      await ordinary.shouldNotReply('North+3 people')
      expect(downstream).toHaveBeenCalledTimes(1)
      expect((await repositories.arcade.find('natural', 'North'))?.value).toBe(3)

      downstream.mockClear()
      const privateUser = asPrivate(app.mock.client('ordinary', 'natural'))
      await privateUser.shouldNotReply('North+1')
      await privateUser.shouldNotReply('几')
      expect(downstream).toHaveBeenCalledTimes(2)
      expect((await repositories.arcade.find('natural', 'North'))?.value).toBe(3)
    } finally {
      await registration.dispose()
    }
  })

  it('disposes its command and middleware idempotently', async () => {
    const { app, repositories, registration } = await createQueueCommandApp()
    const admin = asGroup(app.mock.client('authority-admin', 'dispose'))
    await admin.shouldReply('/mai 排卡管理 添加机厅 North', '添加机厅成功。')

    await registration.dispose()
    await registration.dispose()

    expect(app.$commander.get('mai.queue')).toBeUndefined()
    await admin.shouldNotReply('North+1')
    await admin.shouldNotReply('/mai 排卡管理 删除机厅 North')
    expect((await repositories.arcade.find('dispose', 'North'))?.value).toBe(0)
  })
})

function createQueueCoreDependencies(queueService: plugin.QueueService) {
  return {
    data: {
      musics: new Map(),
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
    callbackRouter: new plugin.CommandCallbackRouter(),
    queueService,
    administrators: ['authority-admin'],
    compatibilityMode: false,
  }
}

function queueConfig(): plugin.Config {
  return {
    developerTokens: { divingFish: '', lxns: '' },
    oauth: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      tokenCipherKey: 'queue-default-key',
    },
    resourceSync: {
      enabled: false,
      intervalMinutes: 60,
      timeoutMs: 10_000,
      cacheDir: 'data/maimai',
      staticBaseUrl: '',
      allowedHosts: [],
    },
    render: { concurrency: 1, queueLimit: 4, timeoutMs: 30_000 },
    publicBaseUrl: '',
    administrators: ['authority-admin'],
    compatibilityMode: false,
  }
}

describe('arcade queue core lifecycle', () => {
  it('registers and disposes queue behavior through the core command lifecycle', async () => {
    const app = new Context()
    app.plugin(memory)
    app.plugin(mock, { selfId: '514' })
    plugin.registerMaiDatabaseModels(app)
    const repositories = new plugin.MaiRepositories(app, 'queue-core-key')
    const queueService = new plugin.QueueService(repositories.arcade)
    const registration = plugin.registerCoreCommands(
      app,
      createQueueCoreDependencies(queueService) as never,
    )
    await app.start()
    await app.mock.initUser('authority-admin', 4)
    const admin = asGroup(app.mock.client('authority-admin', 'core-queue'))

    expect(app.$commander.get('mai.queue')).toBeDefined()
    await admin.shouldReply('/mai 排卡管理 添加机厅 North', '添加机厅成功。')
    await admin.shouldReply('North+1', '更新成功，现在North人数为1人。')

    await registration.dispose()
    expect(app.$commander.get('mai.queue')).toBeUndefined()
    await admin.shouldNotReply('North+1')
    expect((await repositories.arcade.find('core-queue', 'North'))?.value).toBe(1)
  })

  it('constructs a shared queue service in default command dependencies', async () => {
    const app = new Context()
    app.plugin(memory)
    plugin.registerMaiDatabaseModels(app)
    await app.start()
    const data = {
      musics: new Map(),
      courses: new Map(),
      icons: new Map(),
      plates: new Map(),
      coverPath: () => plugin.resolvePackageAssetPath('fallback/cover.png'),
    }

    try {
      const dependencies = await plugin.createDefaultCommandDependencies(
        app,
        { config: queueConfig(), publicBaseUrl: '' },
        {
          dataSync: { startup: vi.fn(async () => data) } as never,
          renderer: new plugin.TakumiRenderService({ concurrency: 1, queueLimit: 4 }),
        },
      ) as unknown as {
        queueService?: unknown
        updateService?: unknown
        guessService: plugin.GuessService
      }

      expect(dependencies.queueService).toBeInstanceOf(plugin.QueueService)
      expect(dependencies.updateService).toBeInstanceOf(plugin.UpdateService)
      ;(dependencies.updateService as plugin.UpdateService).dispose()
      await dependencies.guessService.dispose()
    } finally {
      await app.stop()
    }
  })
})
