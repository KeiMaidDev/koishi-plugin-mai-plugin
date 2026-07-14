import memory from '@koishijs/plugin-database-memory'
import mock from '@koishijs/plugin-mock'
import { Context } from '@koishijs/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as plugin from '../../src'

vi.mock('koishi', async () => import('@koishijs/core'))

const apps: Context[] = []

afterEach(() => {
  apps.length = 0
})

function createMusicFixture() {
  const version = { id: 1, name: 'maimai DX 2025', version: 25000 }
  const music = new plugin.MusicInfo(
    1001,
    'Test Song',
    plugin.MusicType.Standard,
    '',
    'Test Artist',
    plugin.MusicGenre.Original,
    180,
    version,
    true,
  )
  music.charts = [
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Basic, '4', 4.0, new plugin.Notes(100), 'Basic Designer'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Advanced, '8', 8.0, new plugin.Notes(100), 'Advanced Designer'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Expert, '12', 12.0, new plugin.Notes(100), 'Expert Designer'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.Master, '13+', 13.7, new plugin.Notes(100, 10, 10, 0, 5), 'Master Designer'),
    new plugin.ChartInfo(music, plugin.MusicDifficulty.ReMaster, '14', 14.0, new plugin.Notes(100), 'ReMaster Designer'),
  ]
  music.charts[3].fitLevelValue = 13.8
  return music
}

function createDependencies() {
  const music = createMusicFixture()
  const records = music.charts.map((chart, index) => new plugin.RecordEntry(
    music,
    chart,
    1_005_000 - index * 4_000,
    plugin.ComboStatus.FullCombo,
    plugin.SyncStatus.FullSync,
    chart.maxDeluxeScore,
    plugin.Rate.get(1_005_000 - index * 4_000),
    300 - index,
  ))
  const player = new plugin.PlayerInfo('Tester', 15_000, 10)
  const provider = { id: 'diving-fish', name: 'Diving Fish' }
  const course = {
    id: 10,
    name: '十段',
    mode: 0,
    random: false,
    lower: 0,
    upper: 0,
    musics: [{ id: music.id, name: music.name, difficulty: plugin.MusicDifficulty.Master.value }],
    life: 100,
    recover: 10,
    damage: { perfect: 0, great: 1, good: 2, miss: 5 },
  }
  let callbackToken = 0
  return {
    data: {
      musics: new Map([[music.id, music]]),
      courses: new Map([[course.id, course]]),
      icons: new Map([[106103, {
        id: 106103,
        filename: '106103.png',
        name: 'Test Avatar',
        genre: '普通',
        hint: '',
      }]]),
      plates: new Map([[100501, {
        id: 100501,
        filename: '100501.png',
        name: 'Test Plate',
        genre: '普通',
        hint: '',
        requires: [],
        remasters: [],
      }]]),
    },
    aliasService: {
      search: vi.fn(async (query: string) => (
        ['1001', 'id1001', 'Test Song', 'test'].includes(query.trim()) ? [music] : []
      )),
      add: vi.fn(),
      remove: vi.fn(),
      vote: vi.fn(async () => true),
    },
    queryService: {
      getQueryParams: vi.fn(async () => ({
        type: 'qq',
        qq: '10001',
        userId: '10001',
        isSelf: true,
        provider: 'auto',
      })),
      consumePendingCommand: vi.fn(() => null),
      rating: vi.fn(async () => ({
        response: new plugin.RatingResponse(player, null, [], [...records]),
        provider,
      })),
      record: vi.fn(async () => ({ response: [...records], provider })),
      records: vi.fn(async () => ({
        response: new plugin.RecordsResponse(player, null, [...records]),
        provider,
      })),
      recent: vi.fn(async () => ({
        response: new plugin.RecordsResponse(player, null, [...records]),
        provider,
      })),
    },
    settingService: {
      getSettings: vi.fn(async () => ({
        provider: 'auto',
        compatibilityMode: false,
        avatar: null,
        plate: null,
        defaultGame: 'maimai',
      })),
      getDefaultGame: vi.fn(async () => 'maimai'),
      isCompatibilityMode: vi.fn(async () => false),
      setProviderPreference: vi.fn(async (_userId: string, provider: string) => provider),
      setCompatibilityMode: vi.fn(async (_userId: string, enabled: boolean) => enabled),
      setAvatar: vi.fn(async () => ({ id: 106103, name: 'Test Avatar' })),
      setPlate: vi.fn(async () => ({ id: 100501, name: 'Test Plate' })),
      setDefaultGame: vi.fn(async () => 'maimai'),
    },
    bindRepository: {
      setQq: vi.fn(),
    },
    renderer: {
      renderRating: vi.fn(async () => Buffer.from('rating')),
      renderScore: vi.fn(async () => Buffer.from('score')),
      renderLevel: vi.fn(async () => Buffer.from('level')),
      renderCourse: vi.fn(async () => Buffer.from('course')),
      renderRadar: vi.fn(async () => Buffer.from('radar')),
    },
    callbackRouter: new plugin.CommandCallbackRouter({
      randomBytes(size) {
        const bytes = new Uint8Array(size)
        bytes.fill(++callbackToken)
        return bytes
      },
    }),
    administrators: ['configured-admin'],
    compatibilityMode: false,
    now: () => new Date(2026, 6, 14, 12, 0, 0),
    random: () => 0,
    previewAudio: vi.fn(async () => Buffer.from('OggS')),
    replayCommand: vi.fn(),
  }
}

function createConfig(): plugin.Config {
  return {
    developerTokens: { divingFish: '', lxns: '' },
    oauth: {
      enabled: false,
      clientId: '',
      clientSecret: '',
      tokenCipherKey: '',
    },
    resourceSync: {
      enabled: false,
      intervalMinutes: 60,
      timeoutMs: 10_000,
      cacheDir: 'data/maimai',
      staticBaseUrl: '',
      allowedHosts: [],
    },
    render: { concurrency: 1, queueLimit: 8, timeoutMs: 10_000 },
    publicBaseUrl: '',
    administrators: [],
    compatibilityMode: false,
  }
}

async function createApp(
  dependencies: object = createDependencies(),
  beforeRegister?: (app: Context) => void,
) {
  const app = new Context()
  apps.push(app)
  app.plugin(memory)
  app.plugin(mock, { selfId: '514' })
  beforeRegister?.(app)

  const registerCoreCommands = Reflect.get(plugin, 'registerCoreCommands')
  expect(registerCoreCommands).toBeTypeOf('function')
  Reflect.set(app, '__coreRegistration', registerCoreCommands(app, dependencies))

  await app.start()
  await app.mock.initUser('10001', 1)
  await app.mock.initUser('10002', 4)
  await app.mock.initUser('configured-admin', 1)
  await app.mock.initUser('514', 1)
  return app
}

describe('core maimai commands', () => {
  it('registers the mai help command through Koishi command parsing', async () => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply('/mai', /https:\/\/otmdb\.cn\/bot\/maimai/)
  })

  it('resolves direct song IDs and reports missing IDs', async () => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply('/mai id1001', /1001\. Test Song/)
    await client.shouldReply('/mai id9999', /未找到/)
  })

  it.each([
    '绿id1001', '绿谱id1001', 'Basicid1001',
    '黄id1001', '黄谱id1001', 'Advancedid1001',
    '红id1001', '红谱id1001', 'Expertid1001',
    '紫id1001', '紫谱id1001', 'Masterid1001',
    '白id1001', '白谱id1001', 'ReMasterid1001',
  ])('supports the direct difficulty alias %s', async (trigger) => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /1001\. Test Song/)
  })

  it.each([
    ['/mai 随个 舞萌', /1001\. Test Song/],
    ['/mai 查歌 test', /1001\. Test Song/],
    ['/mai 定数查歌 13.7', /1001\. Test Song/],
    ['/mai 定数查歌 13.0-14.0', /1001\. Test Song/],
    ['/mai 拟合定数查歌 13.8', /1001\. Test Song/],
    ['/mai 谱师查歌 Master Designer', /1001\. Test Song/],
    ['/mai 版本查歌 2025', /1001\. Test Song/],
    ['/mai 曲师查歌 Test Artist', /1001\. Test Song/],
    ['/mai 正则查歌 ^Test', /1001\. Test Song/],
    ['/mai BPM查歌 180', /1001\. Test Song/],
    ['/mai bpm查歌 180', /1001\. Test Song/],
    ['/mai 搜索 舞萌', /1001\. Test Song/],
  ])('handles music discovery trigger %s', async (trigger, expected) => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply(trigger, expected)
  })

  it.each([
    ['/mai 随个 不存在', /未找到/],
    ['/mai 查歌 missing', /未找到/],
    ['/mai 定数查歌 nope', /用法/],
    ['/mai 拟合定数查歌 nope', /用法/],
    ['/mai 谱师查歌 missing', /未找到/],
    ['/mai 版本查歌 missing', /未找到/],
    ['/mai 曲师查歌 missing', /未找到/],
    ['/mai 正则查歌 (a+)+$', /不安全/],
    ['/mai BPM查歌 nope', /BPM/],
    ['/mai 搜索 不存在', /未找到/],
  ])('reports music discovery failure for %s', async (trigger, expected) => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply(trigger, expected)
  })

  it('bounds regex input length before compiling it', async () => {
    const app = await createApp()
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai 正则查歌 ${'a'.repeat(plugin.MAX_USER_REGEX_LENGTH + 1)}`, /过长/)
  })

  it('uses opaque scoped Task 10 pagination callbacks', async () => {
    const dependencies = createDependencies()
    const base = createMusicFixture()
    dependencies.data.musics = new Map(Array.from({ length: 12 }, (_, index) => {
      const music = createMusicFixture()
      Object.defineProperties(music, {
        id: { value: base.id + index },
        name: { value: `Test Song ${index + 1}` },
      })
      return [music.id, music]
    }))
    dependencies.aliasService.search.mockResolvedValue([...dependencies.data.musics.values()])
    const registerPagination = vi.spyOn(dependencies.callbackRouter, 'registerPagination')
    const app = await createApp(dependencies)
    const client = app.mock.client('10001', 'channel-a')

    await client.shouldReply('/mai 查歌 test', /1 \/ 2/)
    const token = registerPagination.mock.results[0]?.value
    expect(token).toMatch(/^mai:/)
    await expect(dependencies.callbackRouter.dispatch(token, {
      userId: 'other-user',
      channelId: 'channel-a',
    })).resolves.toEqual({ ok: false, reason: 'user-mismatch' })
    await expect(dependencies.callbackRouter.dispatch(token, {
      userId: '10001',
      channelId: 'other-channel',
    })).resolves.toEqual({ ok: false, reason: 'channel-mismatch' })
    await expect(dependencies.callbackRouter.dispatch(token, {
      userId: '10001',
      channelId: 'channel-a',
    })).resolves.toMatchObject({ ok: true, kind: 'pagination' })
  })

  it('votes aliases and restricts deletion to administrators', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const user = app.mock.client('10001')
    const admin = app.mock.client('10002')

    await user.shouldReply('/mai 添加别名 1001 测试别名', /投票成功/)
    expect(dependencies.aliasService.vote).toHaveBeenCalledWith(1001, '测试别名', '10001')
    await user.shouldReply('/mai 添加别名 1001', /用法/)
    await user.shouldReply('/mai 删除别名 1001 测试别名', /权限不足/)
    expect(dependencies.aliasService.remove).not.toHaveBeenCalled()
    await admin.shouldReply('/mai 删除别名 1001 测试别名', /删除成功/)
    expect(dependencies.aliasService.remove).toHaveBeenCalledWith(1001, '测试别名')
  })

  it('keeps daily recommendations stable for user and local date', async () => {
    const app = await createApp()
    const client = app.mock.client('10001')

    const first = await client.receive('/mai 今日舞萌')
    const second = await client.receive('/mai 今日舞萌')
    expect(first).toEqual(second)
    expect(first[0]).toMatch(/1001\. Test Song/)
  })

  it('reports daily recommendation failure when local music data is empty', async () => {
    const dependencies = createDependencies()
    dependencies.data.musics = new Map()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 今日舞萌', /暂无可推荐/)
  })

  it('sends only non-empty preview audio and fails explicitly otherwise', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 预览 test', /<audio/)
    dependencies.previewAudio.mockResolvedValueOnce(null)
    await client.shouldReply('/mai 预览 test', /预览不可用/)
    dependencies.previewAudio.mockResolvedValueOnce(Buffer.alloc(0))
    await client.shouldReply('/mai 预览 test', /预览不可用/)
    await client.shouldReply('/mai 预览 missing', /未找到/)
  })

  it.each([
    'b15', 'b25', 'b35', 'b40', 'b50',
    '舞萌b15', '舞萌b25', '舞萌b35', '舞萌b40', '舞萌b50',
  ])('renders rating trigger %s', async (trigger) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /<img/)
    expect(dependencies.renderer.renderRating).toHaveBeenCalled()
  })

  it('maps rating query failures without invoking the renderer', async () => {
    const dependencies = createDependencies()
    dependencies.queryService.rating.mockRejectedValueOnce(new Error('provider failed'))
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    expect(await client.receive('/mai b50')).toHaveLength(1)
    expect(dependencies.renderer.renderRating).not.toHaveBeenCalled()
  })

  it('reports a filtered rating with no matching songs', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 不存在b50', /未找到/)
    expect(dependencies.queryService.records).not.toHaveBeenCalled()
    expect(dependencies.renderer.renderRating).not.toHaveBeenCalled()
  })

  it.each(['分数列表', '分数表', '成绩列表', '成绩表'])(
    'renders score-list alias %s',
    async (trigger) => {
      const dependencies = createDependencies()
      const app = await createApp(dependencies)
      const client = app.mock.client('10001')

      await client.shouldReply(`/mai ${trigger}`, /<img/)
      expect(dependencies.queryService.records).toHaveBeenCalled()
      expect(dependencies.renderer.renderRating).toHaveBeenCalled()
    },
  )

  it.each(['分数列表', '分数表', '成绩列表', '成绩表'])(
    'reports an empty score-list alias %s',
    async (trigger) => {
    const dependencies = createDependencies()
    dependencies.queryService.records.mockResolvedValueOnce({
      response: new plugin.RecordsResponse(new plugin.PlayerInfo('Tester'), null, []),
      provider: { id: 'diving-fish', name: 'Diving Fish' },
    })
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /没有成绩/)
    expect(dependencies.renderer.renderRating).not.toHaveBeenCalled()
    },
  )

  it.each([
    '定数表',
    '舞萌定数表',
    '完成表',
    '进度表',
    '舞萌SSS完成表',
    '舞萌SSS进度表',
    '未完成表',
    '未完成列表',
    '舞萌SSS未完成表',
    '舞萌SSS未完成列表',
  ])('renders table trigger %s', async (trigger) => {
    const dependencies = createDependencies()
    if (trigger === '未完成表' || trigger === '未完成列表') {
      dependencies.queryService.records.mockResolvedValue({
        response: new plugin.RecordsResponse(new plugin.PlayerInfo('Tester'), null, []),
        provider: { id: 'diving-fish', name: 'Diving Fish' },
      })
    }
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /<img/)
    expect(dependencies.renderer.renderLevel).toHaveBeenCalled()
  })

  it.each([
    '不存在定数表',
    '不存在完成表',
    '不存在进度表',
    '不存在未完成表',
    '不存在未完成列表',
  ])('reports an invalid table filter for %s', async (trigger) => {
      const dependencies = createDependencies()
      const app = await createApp(dependencies)
      const client = app.mock.client('10001')

      await client.shouldReply(`/mai ${trigger}`, /未找到/)
      expect(dependencies.renderer.renderLevel).not.toHaveBeenCalled()
    })

  it.each([
    'info test',
    'minfo test',
    '绿成绩 test',
    '黄成绩 test',
    '红成绩 test',
    '紫成绩 test',
    '白成绩 test',
  ])('renders single-song score trigger %s', async (trigger) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /<img/)
    expect(dependencies.renderer.renderScore).toHaveBeenCalled()
  })

  it.each([
    'info missing',
    'minfo missing',
    '绿成绩 missing',
    '黄成绩 missing',
    '红成绩 missing',
    '紫成绩 missing',
    '白成绩 missing',
  ])('reports a missing song for score-image alias %s', async (trigger) => {
      const dependencies = createDependencies()
      const app = await createApp(dependencies)
      const client = app.mock.client('10001')

      await client.shouldReply(`/mai ${trigger}`, /未找到/)
      expect(dependencies.renderer.renderScore).not.toHaveBeenCalled()
    })

  it('renders course tables and rejects unknown courses', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 段位表 十段', /<img/)
    expect(dependencies.renderer.renderCourse).toHaveBeenCalled()
    await client.shouldReply('/mai 段位表 不存在', /未找到/)
  })

  it('reports text progress and invalid progress filters', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 舞萌SSS进度', /进度|达成/)
    await client.shouldReply('/mai 不存在进度', /未找到/)
  })

  it.each(['/mai bind 123456789', '/mai 绑定 123456789', '/bind 123456789'])(
    'binds QQ through %s',
    async (trigger) => {
      const dependencies = createDependencies()
      const app = await createApp(dependencies)
      const client = app.mock.client('10001')

      await client.shouldReply(trigger, /绑定成功/)
      expect(dependencies.bindRepository.setQq).toHaveBeenCalledWith('10001', '123456789')
    },
  )

  it('rejects invalid QQ bindings and replays a pending command once', async () => {
    const dependencies = createDependencies()
    dependencies.queryService.consumePendingCommand
      .mockReturnValueOnce('/mai b50')
      .mockReturnValue(null)
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai bind nope', /QQ/)
    await client.shouldReply('/mai bind 123456789', /绑定成功/)
    expect(dependencies.replayCommand).toHaveBeenCalledTimes(1)
    expect(dependencies.replayCommand).toHaveBeenCalledWith(
      expect.objectContaining({ userId: '10001' }),
      '/mai b50',
    )
    await client.shouldReply('/mai bind 123456789', /绑定成功/)
    expect(dependencies.replayCommand).toHaveBeenCalledTimes(1)
  })

  it.each(['/mai bind nope', '/mai 绑定 nope', '/bind nope'])(
    'rejects invalid QQ binding alias %s',
    async (trigger) => {
      const dependencies = createDependencies()
      const app = await createApp(dependencies)
      const client = app.mock.client('10001')

      await client.shouldReply(trigger, /QQ/)
      expect(dependencies.bindRepository.setQq).not.toHaveBeenCalled()
    },
  )

  it.each([
    ['设置查分器 自动', 'auto'],
    ['设置查分器 auto', 'auto'],
    ['设置查分器 水鱼', 'diving-fish'],
    ['设置查分器 diving-fish', 'diving-fish'],
    ['设置水鱼', 'diving-fish'],
    ['水鱼', 'diving-fish'],
    ['设置查分器 落雪', 'lxns'],
    ['设置查分器 lxns', 'lxns'],
    ['设置落雪', 'lxns'],
    ['落雪', 'lxns'],
  ])('selects provider through %s', async (trigger, provider) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /设置查分器成功/)
    expect(dependencies.settingService.setProviderPreference)
      .toHaveBeenCalledWith('10001', provider)
  })

  it('rejects an unknown provider name', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 设置查分器 unknown', /用法/)
    expect(dependencies.settingService.setProviderPreference).not.toHaveBeenCalled()
  })

  it('reports provider persistence failure', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.setProviderPreference.mockRejectedValueOnce(
      new Error('database failed'),
    )
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 设置查分器 水鱼', /设置失败/)
  })

  it.each([
    ['兼容模式', true],
    ['兼容模式 关闭', false],
    ['取消兼容模式', false],
    ['关闭兼容模式', false],
    ['禁用兼容模式', false],
    ['打开兼容模式', true],
    ['启用兼容模式', true],
  ])('changes compatibility mode through %s', async (trigger, enabled) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, enabled ? /启用成功/ : /禁用成功/)
    expect(dependencies.settingService.setCompatibilityMode)
      .toHaveBeenCalledWith('10001', enabled)
  })

  it('reports compatibility-mode persistence failure', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.setCompatibilityMode.mockRejectedValueOnce(
      new Error('database failed'),
    )
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 兼容模式', /设置失败/)
  })

  it.each([
    ['设置头像 106103', 'setAvatar'],
    ['设置牌子 100501', 'setPlate'],
    ['设置姓名框 100501', 'setPlate'],
  ])('updates collection setting through %s', async (trigger, method) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /设置成功/)
    expect(dependencies.settingService[method]).toHaveBeenCalled()
  })

  it('reports collection validation failures', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.setAvatar.mockRejectedValueOnce(
      new plugin.InvalidSettingError('avatar', 'missing'),
    )
    dependencies.settingService.setPlate.mockRejectedValueOnce(
      new plugin.PlateNotAcquiredError(dependencies.data.plates.get(100501)),
    ).mockRejectedValueOnce(
      new plugin.PlateNotAcquiredError(dependencies.data.plates.get(100501)),
    )
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 设置头像 missing', /设置失败/)
    await client.shouldReply('/mai 设置牌子 100501', /未达成/)
    await client.shouldReply('/mai 设置姓名框 100501', /未达成/)
  })

  it.each(['设置mai', '设置b50'])(
    'shows settings help through %s',
    async (trigger) => {
      const app = await createApp()
      const client = app.mock.client('10001')

      await client.shouldReply(`/mai ${trigger}`, /设置头像.*设置牌子.*设置查分器/s)
    },
  )

  it.each(['默认', '设为默认'])('sets maimai as default through %s', async (trigger) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(`/mai ${trigger}`, /设置成功/)
    expect(dependencies.settingService.setDefaultGame).toHaveBeenCalledWith('10001', 'maimai')
  })

  it('reports default-game persistence failure', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.setDefaultGame.mockRejectedValueOnce(new Error('database failed'))
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 默认', /设置失败/)
  })

  it('calculates score lines and rejects invalid chart inputs', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply('/mai 分数线 紫test 100.5', /TAP GREAT/)
    await client.shouldReply('/mai 分数线', /用法/)
    await client.shouldReply('/mai 分数线 紫missing 100.5', /未找到/)
    await client.shouldReply('/mai 分数线 紫test nope', /用法/)
    await client.shouldReply('/mai 分数线 宴test 100.5', /难度/)
  })

  it('registers documented commands with Koishi metadata', async () => {
    const app = await createApp()
    const help = app.$commander.get('mai')
    const bind = app.$commander.get('mai.bind')
    const aliasRemove = app.$commander.get('mai.alias-remove')

    expect(help).toBeDefined()
    expect(help.config.permissions).toContain('authority:1')
    expect(bind?._arguments.map(argument => argument.name)).toContain('qq')
    expect(aliasRemove).toBeDefined()
  })

  it('runs exact prefixless commands at low priority for maimai users', async () => {
    const order: string[] = []
    const dependencies = createDependencies()
    dependencies.settingService.getDefaultGame.mockImplementation(async () => {
      order.push('compatibility')
      return 'maimai'
    })
    const app = await createApp(dependencies, app => {
      app.middleware(async (_session, next) => {
        order.push('high-priority')
        return next()
      }, true)
    })
    const downstream = vi.fn(async (_session, next) => next())
    app.middleware(downstream)
    const client = app.mock.client('10001')

    await client.shouldReply('查歌 test', /1001\. Test Song/)
    expect(order.slice(0, 2)).toEqual(['high-priority', 'compatibility'])
    expect(downstream).not.toHaveBeenCalled()

    await client.shouldNotReply('完全未知的消息')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['b50', /<img/],
    ['分数列表', /<img/],
    ['定数表', /<img/],
    ['完成表', /<img/],
    ['未完成表', /已完成|<img/],
    ['info test', /<img/],
    ['段位表 十段', /<img/],
    ['舞萌SSS进度', /进度|达成/],
    ['分数线 紫test 100.5', /TAP GREAT/],
    ['bind 123456789', /绑定成功/],
    ['设置查分器 水鱼', /设置查分器成功/],
    ['兼容模式 关闭', /禁用成功/],
    ['设置头像 106103', /设置成功/],
    ['设置牌子 100501', /设置成功/],
    ['设置mai', /支持以下设置/],
    ['默认', /设置成功/],
  ])('executes remaining prefixless family %s', async (content, expected) => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')

    await client.shouldReply(content, expected)
  })

  it.each(['查', 'id', 'id1001 extra', 'b5', '设置', '分数']) (
    'does not consume partial compatibility text %s',
    async (content) => {
      const app = await createApp()
      const downstream = vi.fn(async (_session, next) => next())
      app.middleware(downstream)
      const client = app.mock.client('10001')

      await client.shouldNotReply(content)
      expect(downstream).toHaveBeenCalledTimes(1)
    },
  )

  it('passes through another default game, self events, and unsupported platforms', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.getDefaultGame.mockResolvedValue('chunithm')
    const app = await createApp(dependencies)
    const downstream = vi.fn(async (_session, next) => next())
    app.middleware(downstream)

    await app.mock.client('10001').shouldNotReply('查歌 test')
    expect(downstream).toHaveBeenCalledTimes(1)

    const createCompatibilityMiddleware = Reflect.get(plugin, 'createCompatibilityMiddleware')
    expect(createCompatibilityMiddleware).toBeTypeOf('function')
    const middleware = createCompatibilityMiddleware(dependencies)
    const next = vi.fn(async () => 'next')
    await middleware({
      platform: 'mock',
      userId: '514',
      selfId: '514',
      content: '查歌 test',
    }, next)
    await middleware({
      platform: 'unsupported',
      userId: '10001',
      selfId: '514',
      content: '查歌 test',
    }, next)
    expect(next).toHaveBeenCalledTimes(2)
  })

  it('passes through when default-game lookup fails', async () => {
    const dependencies = createDependencies()
    dependencies.settingService.getDefaultGame.mockRejectedValueOnce(
      new Error('database failed'),
    )
    const app = await createApp(dependencies)
    const downstream = vi.fn(async (_session, next) => next())
    app.middleware(downstream)
    const client = app.mock.client('10001')

    await client.shouldNotReply('b50')
    expect(downstream).toHaveBeenCalledTimes(1)
  })

  it('uses Task 10 rich replies only when QQ compatibility mode is off', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')
    client.event.platform = 'qq'

    await client.shouldReply('/mai', /<qq:rawmarkdown-without-keyboard/)
    dependencies.settingService.isCompatibilityMode.mockResolvedValue(true)
    await client.shouldReply('/mai', /https:\/\/otmdb\.cn\/bot\/maimai/)
  })

  it('disposes commands, compatibility middleware, and callback state', async () => {
    const dependencies = createDependencies()
    const app = await createApp(dependencies)
    const client = app.mock.client('10001')
    const registration = Reflect.get(app, '__coreRegistration')
    const token = dependencies.callbackRouter.register({
      kind: 'test',
      payload: {},
      expectedUserId: '10001',
      expectedChannelId: 'private:10001',
      handler: () => 'ok',
    })

    expect(registration?.dispose).toBeTypeOf('function')
    expect(token).toMatch(/^mai:/)
    expect(dependencies.callbackRouter.size).toBe(1)
    registration.dispose()

    expect(dependencies.callbackRouter.size).toBe(0)
    expect(app.$commander.get('mai')).toBeUndefined()
    await client.shouldNotReply('/mai')
    await client.shouldNotReply('查歌 test')

    const replacement = plugin.registerCoreCommands(app, dependencies)
    expect(app.$commander.get('mai')).toBeDefined()
    replacement.dispose()
  })

  it('wires command dependencies through the default lifecycle and releases them', async () => {
    const app = new Context()
    const dependencies = createDependencies()
    const createCommandDependencies = vi.fn(async () => dependencies)
    const lifecycle = plugin.createDefaultLifecycle(app, {
      initializeDatabaseModels: () => undefined,
      createCommandDependencies,
    })
    const runtime = { config: createConfig(), publicBaseUrl: '' }

    await lifecycle.initializeCommands(runtime)
    await lifecycle.initializeCommands(runtime)
    dependencies.callbackRouter.register({
      kind: 'lifecycle-test',
      payload: {},
      expectedUserId: '10001',
      expectedChannelId: 'channel',
      handler: () => undefined,
    })

    expect(createCommandDependencies).toHaveBeenCalledTimes(1)
    expect(app.$commander.get('mai')).toBeDefined()
    expect(dependencies.callbackRouter.size).toBe(1)

    await lifecycle.releaseCallbackState()

    expect(app.$commander.get('mai')).toBeUndefined()
    expect(dependencies.callbackRouter.size).toBe(0)
  })
})
