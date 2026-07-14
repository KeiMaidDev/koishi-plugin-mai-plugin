import { describe, expect, it } from 'vitest'
import * as publicApi from '../../src'
import {
  ComboStatus,
  MusicDifficulty,
  MusicGenre,
  MusicType,
  Rate,
  SyncStatus,
} from '../../src/domain/enums'
import {
  ChartInfo,
  MusicInfo,
  Notes,
  RecordEntry,
  type GameVersion,
} from '../../src/domain/music'
import { PlayerInfo, RatingResponse } from '../../src/domain/player'
import {
  ProviderBindingRequiredError,
  ProviderNoDataError,
  ProviderNotFoundError,
  ProviderOAuthRequiredError,
  ProviderPrivacyError,
  ProviderUnsupportedError,
} from '../../src/providers/errors'

class MemoryBindRepository {
  private readonly values = new Map<string, string>()

  set(userId: string, qq: string) {
    this.values.set(userId, qq)
  }

  async getQq(userId: string) {
    return this.values.get(userId) ?? null
  }
}

class MemorySettingRepository {
  private readonly values = new Map<string, Map<string, string>>()

  async set(userId: string, key: string, value: string) {
    const settings = this.values.get(userId) ?? new Map<string, string>()
    settings.set(key, value)
    this.values.set(userId, settings)
  }

  async get(userId: string, key: string) {
    const value = this.values.get(userId)?.get(key)
    return value?.trim() ? value : null
  }

  async list(userId: string) {
    return Object.fromEntries(this.values.get(userId) ?? [])
  }
}

function task9Api() {
  return publicApi as Record<string, any>
}

const version: GameVersion = { id: 1, name: 'maimai DX 2026', version: 23_000 }

function settingsData() {
  const music = new MusicInfo(
    1,
    'Plate Song',
    MusicType.Deluxe,
    '',
    'Artist',
    MusicGenre.Original,
    180,
    version,
    true,
  )
  const master = new ChartInfo(
    music,
    MusicDifficulty.Master,
    '13',
    13,
    new Notes(100),
    'Designer',
  )
  music.charts = [master]
  return {
    data: {
      versions: new Map([[version.name, version]]),
      musics: new Map([[music.id, music]]),
      icons: new Map([[106103, {
        id: 106103,
        filename: '106103.png',
        name: 'Fixture Icon',
        genre: 'normal',
        hint: '',
      }]]),
      plates: new Map([
        [100501, {
          id: 100501,
          filename: '100501.png',
          name: 'Fixture Plate',
          genre: 'normal',
          hint: '',
          requires: [],
          remasters: [],
        }],
        [100502, {
          id: 100502,
          filename: '100502.png',
          name: '真将',
          genre: '実績',
          hint: '',
          requires: [music.id],
          remasters: [],
        }],
      ]),
      courses: new Map(),
    },
    music,
    master,
  }
}

function plateRecord(music: MusicInfo, chart: ChartInfo, achievement: number) {
  return new RecordEntry(
    music,
    chart,
    achievement,
    ComboStatus.None,
    SyncStatus.None,
    0,
    Rate.get(achievement),
    0,
  )
}

describe('QueryService query target resolution', () => {
  it('resolves a self query with normalized player and provider settings', async () => {
    const { QueryService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    bind.set('user-1', '123456789')
    await setting.set('user-1', 'icon', '106103')
    await setting.set('user-1', 'plate', '100501')
    await setting.set('user-1', 'prober', 'lxns')
    const service = new QueryService({ bind, setting })

    await expect(service.getQueryParams({
      userId: 'user-1',
      sessionId: 'qq:guild-1:channel-1',
      command: '/mai b50',
    })).resolves.toEqual({
      type: 'qq',
      qq: '123456789',
      userId: 'user-1',
      isSelf: true,
      settings: { avatar: 106103, plate: 100501 },
      provider: 'lxns',
    })
  })

  it('gives a bound non-bot mention priority without leaking self settings', async () => {
    const { QueryService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    bind.set('target-user', '99887766')
    await setting.set('user-1', 'icon', '106103')
    await setting.set('user-1', 'prober', 'diving-fish')
    const service = new QueryService({ bind, setting })

    await expect(service.getQueryParams({
      userId: 'user-1',
      sessionId: 'qq:guild-1:channel-1',
      command: '/mai b50 someone-else',
      mentions: [
        { userId: 'bot', isBot: true },
        { userId: 'target-user' },
      ],
    }, 'someone-else')).resolves.toEqual({
      type: 'qq',
      qq: '99887766',
      userId: 'user-1',
      isSelf: false,
      provider: 'auto',
    })
  })

  it.each([
    ['qq123456', { type: 'qq', qq: '123456', userId: 'user-1', isSelf: false, provider: 'auto' }],
    ['Alice', { type: 'username', username: 'Alice', userId: 'user-1', isSelf: false, provider: 'auto' }],
  ])('resolves the explicit target %s', async (queryArgs, expected) => {
    const { QueryService } = task9Api()
    const service = new QueryService({
      bind: new MemoryBindRepository(),
      setting: new MemorySettingRepository(),
    })

    await expect(service.getQueryParams({
      userId: 'user-1',
      sessionId: 'private:user-1',
      command: `/mai b50 ${queryArgs}`,
    }, queryArgs)).resolves.toEqual(expected)
  })

  it('caches a missing-self-binding command for one user and session, then consumes it once', async () => {
    const { PendingCommandCache, QueryService } = task9Api()
    const cache = new PendingCommandCache({ maxEntries: 8, ttlMs: 60_000 })
    const service = new QueryService({
      bind: new MemoryBindRepository(),
      setting: new MemorySettingRepository(),
    }, { pendingCommands: cache })
    const session = {
      userId: 'user-1',
      sessionId: 'qq:guild-1:channel-1',
      command: '/mai b50',
    }

    await expect(service.getQueryParams(session)).rejects.toMatchObject({
      name: 'QqBindingRequiredError',
    })
    expect(service.consumePendingCommand({ ...session, userId: 'user-2' })).toBeNull()
    expect(service.consumePendingCommand({ ...session, sessionId: 'qq:guild-1:channel-2' })).toBeNull()
    expect(service.consumePendingCommand(session)).toBe('/mai b50')
    expect(service.consumePendingCommand(session)).toBeNull()
  })

  it('rejects a mentioned target whose QQ binding is unavailable', async () => {
    const { QueryService } = task9Api()
    const service = new QueryService({
      bind: new MemoryBindRepository(),
      setting: new MemorySettingRepository(),
    })

    await expect(service.getQueryParams({
      userId: 'user-1',
      sessionId: 'qq:guild-1:channel-1',
      command: '/mai b50 @target',
      mentions: [{ userId: 'target-user' }],
    })).rejects.toMatchObject({
      name: 'QueryTargetBindingRequiredError',
      targetUserId: 'target-user',
    })
  })
})

describe('PendingCommandCache bounds and expiry', () => {
  it('expires entries and evicts the oldest entry when the bound is reached', () => {
    const { PendingCommandCache } = task9Api()
    let now = 1_000
    const cache = new PendingCommandCache({
      maxEntries: 2,
      ttlMs: 100,
      now: () => now,
    })
    const first = { userId: 'user-1', sessionId: 'session-1' }
    const second = { userId: 'user-2', sessionId: 'session-2' }
    const third = { userId: 'user-3', sessionId: 'session-3' }

    cache.set(first, 'first')
    now += 10
    cache.set(second, 'second')
    cache.set(third, 'third')

    expect(cache.size).toBe(2)
    expect(cache.consume(first)).toBeNull()
    expect(cache.consume(second)).toBe('second')
    now += 101
    expect(cache.consume(third)).toBeNull()
    expect(cache.size).toBe(0)
  })
})

describe('provider preference normalization', () => {
  it.each([
    ['auto', 'auto'],
    ['diving-fish', 'diving-fish'],
    ['lxns', 'lxns'],
    ['divingFish', 'auto'],
    ['other-provider', 'auto'],
  ])('uses the stored value %s as %s', async (stored, expected) => {
    const { QueryService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    bind.set('user-1', '123456')
    await setting.set('user-1', 'prober', stored)
    const service = new QueryService({ bind, setting })

    await expect(service.getQueryParams({
      userId: 'user-1',
      sessionId: 'private:user-1',
      command: '/mai b50',
    })).resolves.toMatchObject({ provider: expected })
  })

  it.each([
    ['auto', ['diving-fish', 'lxns'], 'lxns'],
    ['diving-fish', ['diving-fish'], 'diving-fish'],
    ['lxns', ['lxns'], 'lxns'],
  ])('passes %s through to ProviderChain selection', async (stored, expectedOrder, expectedProvider) => {
    const { ProviderChain, QueryService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    const order: string[] = []
    bind.set('user-1', '123456')
    await setting.set('user-1', 'prober', stored)
    const response = new RatingResponse(new PlayerInfo('Player'), null, [{} as RecordEntry], [])
    const provider = (id: 'diving-fish' | 'lxns') => ({
      id,
      name: id,
      getPlayerRating: async () => {
        order.push(id)
        if (stored === 'auto' && id === 'diving-fish') throw new ProviderNoDataError(id)
        return response
      },
      getPlayerRecord: async () => [],
      getPlayerRecords: async () => { throw new ProviderNoDataError(id) },
    })
    const chain = new ProviderChain({
      data,
      repositories: { setting },
      providers: {
        divingFish: provider('diving-fish'),
        lxns: provider('lxns'),
      },
    })
    const service = new QueryService({ bind, setting }, { providerChain: chain })
    const query = await service.getQueryParams({
      userId: 'user-1',
      sessionId: 'private:user-1',
      command: '/mai b50',
    })

    const result = await service.rating(query)

    expect(order).toEqual(expectedOrder)
    expect(result.provider.id).toBe(expectedProvider)
  })

  it('preserves provider cancellation and stops fallback immediately', async () => {
    const { ProviderChain, QueryService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    let lxnsCalls = 0
    bind.set('user-1', '123456')
    await setting.set('user-1', 'prober', 'auto')
    const chain = new ProviderChain({
      data,
      repositories: { setting },
      providers: {
        divingFish: {
          id: 'diving-fish',
          name: 'diving-fish',
          getPlayerRating: async () => { throw abort },
          getPlayerRecord: async () => { throw abort },
          getPlayerRecords: async () => { throw abort },
        },
        lxns: {
          id: 'lxns',
          name: 'lxns',
          getPlayerRating: async () => {
            lxnsCalls += 1
            return new RatingResponse(new PlayerInfo('unexpected'), null, [{} as RecordEntry], [])
          },
          getPlayerRecord: async () => [],
          getPlayerRecords: async () => { throw new ProviderNoDataError('lxns') },
        },
      },
    })
    const service = new QueryService({ bind, setting }, { providerChain: chain })
    const query = await service.getQueryParams({
      userId: 'user-1',
      sessionId: 'private:user-1',
      command: '/mai b50',
    })

    await expect(service.rating(query)).rejects.toBe(abort)
    expect(lxnsCalls).toBe(0)
  })
})

describe('SettingService', () => {
  it('persists every supported setting in normalized repository form', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    const service = new SettingService(data, { setting })

    await service.setProviderPreference('user-1', 'diving-fish')
    await service.setCompatibilityMode('user-1', true)
    await service.setAvatar('user-1', 'Fixture Icon')
    await service.setPlate('user-1', '100501.png')
    await service.setDefaultGame('user-1', 'chunithm')

    expect(await setting.list('user-1')).toEqual({
      prober: 'diving-fish',
      'text-mode': '1',
      icon: '106103',
      plate: '100501',
      'game-prior': 'chunithm',
    })
    await expect(service.getSettings('user-1')).resolves.toEqual({
      provider: 'diving-fish',
      compatibilityMode: true,
      avatar: 106103,
      plate: 100501,
      defaultGame: 'chunithm',
    })
  })

  it('normalizes malformed stored values to safe defaults', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    await setting.set('user-1', 'prober', 'divingFish')
    await setting.set('user-1', 'text-mode', 'true')
    await setting.set('user-1', 'icon', '999999')
    await setting.set('user-1', 'plate', '../plate.png')
    await setting.set('user-1', 'game-prior', 'unknown')
    const service = new SettingService(data, { setting })

    await expect(service.getSettings('user-1')).resolves.toEqual({
      provider: 'auto',
      compatibilityMode: false,
      avatar: null,
      plate: null,
      defaultGame: 'maimai',
    })
  })

  it('feeds validated stored cosmetics into self query parameters', async () => {
    const { QueryService, SettingService } = task9Api()
    const bind = new MemoryBindRepository()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    bind.set('user-1', '123456')
    await setting.set('user-1', 'icon', '999999')
    await setting.set('user-1', 'plate', '888888')
    const settings = new SettingService(data, { setting })
    const query = new QueryService({ bind, setting }, { settings })

    await expect(query.getQueryParams({
      userId: 'user-1',
      sessionId: 'private:user-1',
      command: '/mai b50',
    })).resolves.toMatchObject({
      settings: { avatar: null, plate: null },
      provider: 'auto',
    })
  })

  it.each([
    ['provider', (service: any) => service.setProviderPreference('user-1', 'divingFish')],
    ['compatibility mode', (service: any) => service.setCompatibilityMode('user-1', '1')],
    ['avatar', (service: any) => service.setAvatar('user-1', 'missing-icon')],
    ['plate', (service: any) => service.setPlate('user-1', 'missing-plate')],
    ['default game', (service: any) => service.setDefaultGame('user-1', 'unknown')],
  ])('rejects an invalid %s without persistence', async (_name, operation) => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    const service = new SettingService(data, { setting })

    await expect(operation(service)).rejects.toMatchObject({ name: 'InvalidSettingError' })
    expect(await setting.list('user-1')).toEqual({})
  })

  it('checks an achievement plate against the required charts before persistence', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data, music, master } = settingsData()
    const achievementRecords = async () => [plateRecord(music, master, 1_000_000)]
    const service = new SettingService(data, { setting }, { achievementRecords })

    await expect(service.setPlate('user-1', '真将')).resolves.toMatchObject({ id: 100502 })
    expect(await setting.get('user-1', 'plate')).toBe('100502')
  })

  it('denies an unearned achievement plate and leaves the previous plate unchanged', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data, music, master } = settingsData()
    await setting.set('user-1', 'plate', '100501')
    const achievementRecords = async () => [plateRecord(music, master, 999_999)]
    const service = new SettingService(data, { setting }, { achievementRecords })

    await expect(service.setPlate('user-1', '真将'))
      .rejects.toMatchObject({ name: 'PlateNotAcquiredError' })
    expect(await setting.get('user-1', 'plate')).toBe('100501')
  })

  it('denies an achievement plate when its required charts are missing locally', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    const plate = data.plates.get(100502)!
    data.plates.set(100502, { ...plate, requires: [999999] })
    const service = new SettingService(data, { setting }, {
      achievementRecords: async () => [],
    })

    await expect(service.setPlate('user-1', '真将'))
      .rejects.toMatchObject({ name: 'PlateNotAcquiredError' })
    expect(await setting.get('user-1', 'plate')).toBeNull()
  })

  it('does not query records for an ordinary cosmetic plate', async () => {
    const { SettingService } = task9Api()
    const setting = new MemorySettingRepository()
    const { data } = settingsData()
    let calls = 0
    const service = new SettingService(data, { setting }, {
      achievementRecords: async () => {
        calls += 1
        return []
      },
    })

    await service.setPlate('user-1', 'Fixture Plate')

    expect(calls).toBe(0)
    expect(await setting.get('user-1', 'plate')).toBe('100501')
  })
})

describe('unified query error messages', () => {
  it.each([
    ['qq-unbound', () => new (task9Api().QqBindingRequiredError)({ userId: 'u', sessionId: 's' })],
    ['provider-unbound', () => new ProviderBindingRequiredError('diving-fish')],
    ['player-not-found', () => new ProviderNotFoundError('diving-fish')],
    ['privacy-denied', () => new ProviderPrivacyError('diving-fish')],
    ['no-data', () => new ProviderNoDataError('diving-fish')],
    ['filter-no-result', () => new (task9Api().FilterNoResultError)()],
    ['filter-too-many', () => new (task9Api().FilterTooManyError)()],
    ['unsupported', () => new ProviderUnsupportedError('lxns', 'Recent scores are unsupported.')],
    ['oauth-required', () => new ProviderOAuthRequiredError('lxns')],
    ['unknown', () => new Error('database details must not leak')],
  ])('maps %s without exposing internal error details', (code, createError) => {
    const { mapQueryError } = task9Api()

    const result = mapQueryError(createError(), { isSelf: false })

    expect(result).toMatchObject({ type: 'text', code })
    if (code === 'unknown') expect(result.text).not.toContain('database details')
  })

  it('uses the consent message for a self privacy failure', () => {
    const { mapQueryError } = task9Api()

    expect(mapQueryError(new ProviderPrivacyError('diving-fish'), { isSelf: true }))
      .toMatchObject({ code: 'privacy-consent-required' })
  })

  it('rethrows cancellation instead of turning it into a user message', () => {
    const { mapQueryError } = task9Api()
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })

    expect(() => mapQueryError(abort)).toThrow(abort)
  })
})

describe('compatibility fallback payloads', () => {
  it('never returns QQ-native Markdown in compatibility mode or on non-QQ platforms', () => {
    const { selectReplyPayload } = task9Api()
    const fallback = [
      { type: 'text', text: 'plain fallback' },
      { type: 'image', data: Buffer.from('image'), mimeType: 'image/png' },
    ]
    const rich = { type: 'qq:rawmarkdown', markdown: { content: '# result' } }

    expect(selectReplyPayload({ platform: 'qq', compatibilityMode: true, fallback, rich }))
      .toEqual(fallback)
    expect(selectReplyPayload({ platform: 'discord', compatibilityMode: false, fallback, rich }))
      .toEqual(fallback)
    expect(selectReplyPayload({ platform: 'qq', compatibilityMode: false, fallback, rich }))
      .toBe(rich)
  })

  it('rejects QQ-native elements disguised as fallback content', () => {
    const { sanitizeFallbackMessage } = task9Api()

    expect(() => sanitizeFallbackMessage([
      { type: 'text', text: 'safe' },
      { type: 'qq:markdown', markdown: {} },
    ])).toThrow('Fallback messages may contain only text and image elements')
  })
})

describe('platform-neutral administrator checks', () => {
  it('accepts self-service, configured administrators, authority, and group roles only as requested', () => {
    const { canManageSettings, hasAuthority, isAdministrator } = task9Api()
    const policy = { administrators: ['configured-admin'], minimumAuthority: 4 }

    expect(canManageSettings({ userId: 'user-1' }, 'user-1', policy)).toBe(true)
    expect(isAdministrator({ userId: 'configured-admin' }, policy)).toBe(true)
    expect(isAdministrator({ userId: 'authority-admin', authority: 4 }, policy)).toBe(true)
    expect(isAdministrator({ userId: 'group-admin', roles: ['admin'] }, policy)).toBe(true)
    expect(hasAuthority({ userId: 'user-1', authority: 2 }, 3)).toBe(false)
    expect(canManageSettings({ userId: 'user-1', authority: 2 }, 'other-user', policy)).toBe(false)
  })
})
