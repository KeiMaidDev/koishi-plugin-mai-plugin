import MemoryDriver from '@koishijs/plugin-database-memory'
import { Context } from '@koishijs/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as publicApi from '../../src'
import { initializePlugin, type Config } from '../../src'
import { registerMaiDatabaseModels } from '../../src/database/models'
import {
  GUESS_GAME_TTL_MS,
  MaiRepositories,
  RepositoryCoordinator,
  TokenCipher,
} from '../../src/database/repositories'

const config: Config = {
  developerTokens: {
    divingFish: '',
    lxns: '',
  },
  oauth: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    tokenCipherKey: '',
  },
  resourceSync: {
    enabled: true,
    intervalMinutes: 60,
    timeoutMs: 10_000,
    cacheDir: 'data/maimai',
    staticBaseUrl: '',
    allowedHosts: [],
  },
  render: {
    concurrency: 4,
    queueLimit: 64,
    timeoutMs: 30_000,
  },
  publicBaseUrl: '',
  administrators: [],
  compatibilityMode: false,
}

function createContextSharingDatabase(ctx: Context) {
  return { database: ctx.database, root: ctx.root } as Context
}

describe('maimai database models and repositories', () => {
  let ctx: Context
  let repositories: MaiRepositories

  beforeEach(async () => {
    ctx = new Context()
    ctx.plugin(MemoryDriver)
    registerMaiDatabaseModels(ctx)
    await ctx.start()
    repositories = new MaiRepositories(ctx, 'test-token-cipher-key')
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await ctx.stop()
  })

  it('registers every table with the required primary and unique keys', () => {
    const models = ctx.model.tables

    expect(Object.keys(models).filter(name => name.startsWith('mai_')).sort()).toEqual([
      'mai_alias',
      'mai_alias_vote',
      'mai_arcade',
      'mai_arcade_group',
      'mai_arcade_group_bind',
      'mai_diving_fish_bind',
      'mai_guess_game',
      'mai_oauth_token',
      'mai_qq_bind',
      'mai_setting',
    ])
    expect(models.mai_qq_bind.primary).toBe('id')
    expect(models.mai_diving_fish_bind.primary).toBe('id')
    expect(models.mai_setting.primary).toEqual(['id', 'key'])
    expect(models.mai_alias.primary).toEqual(['musicId', 'name'])
    expect(models.mai_alias_vote.primary).toEqual(['musicId', 'name', 'userId'])
    expect(models.mai_arcade_group.primary).toBe('id')
    expect(models.mai_arcade_group.unique).toContain('name')
    expect(models.mai_arcade_group_bind.primary).toBe('channelId')
    expect(models.mai_arcade.primary).toBe('id')
    expect(models.mai_guess_game.primary).toBe('contextId')
    expect(models.mai_oauth_token.primary).toEqual(['userId', 'provider'])
  })

  it('overwrites QQ bindings for the same user', async () => {
    await repositories.bind.setQq('user-1', '12345678')
    await repositories.bind.setQq('user-1', '87654321')

    expect(await repositories.bind.getQq('user-1')).toBe('87654321')
    expect(await ctx.database.get('mai_qq_bind', { id: 'user-1' })).toHaveLength(1)
  })

  it('overwrites diving fish import tokens for the same user', async () => {
    await repositories.bind.setImportToken('user-1', 'first-token')
    await repositories.bind.setImportToken('user-1', 'second-token')

    expect(await repositories.bind.getImportToken('user-1')).toBe('second-token')
    expect(await ctx.database.get('mai_diving_fish_bind', { id: 'user-1' })).toHaveLength(1)
  })

  it('overwrites and lists settings while treating blank values as unset', async () => {
    await repositories.setting.set('user-1', 'icon', '12')
    await repositories.setting.set('user-1', 'plate', '')
    await repositories.setting.set('user-1', 'icon', '34')

    expect(await repositories.setting.get('user-1', 'icon')).toBe('34')
    expect(await repositories.setting.get('user-1', 'plate')).toBeNull()
    expect(await repositories.setting.list('user-1')).toEqual({ icon: '34', plate: '' })
  })

  it('adds, finds exactly, votes idempotently, and deletes aliases', async () => {
    await repositories.alias.add(10001, 'Test Alias')

    expect(await repositories.alias.exact('  test alias ')).toEqual([10001])
    expect(await repositories.alias.vote(10001, 'Test Alias', 'user-1')).toBe(true)
    expect(await repositories.alias.vote(10001, 'Test Alias', 'user-1')).toBe(false)
    expect(await repositories.alias.getVotes(10001, 'Test Alias')).toBe(1)

    await repositories.alias.remove(10001, 'Test Alias')

    expect(await repositories.alias.exact('test alias')).toEqual([])
    expect(await ctx.database.get('mai_alias_vote', {
      musicId: 10001,
      name: 'Test Alias',
    })).toEqual([])
  })

  it('serializes concurrent duplicate alias votes into one counted vote', async () => {
    await repositories.alias.add(10001, 'Concurrent Alias')

    const results = await Promise.all(Array.from({ length: 20 }, () => (
      repositories.alias.vote(10001, 'Concurrent Alias', 'same-user')
    )))

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(await repositories.alias.getVotes(10001, 'Concurrent Alias')).toBe(1)
    expect(await ctx.database.get('mai_alias_vote', {
      musicId: 10001,
      name: 'Concurrent Alias',
      userId: 'same-user',
    })).toHaveLength(1)
  })

  it('keeps new aliases pending until three distinct votes approve them', async () => {
    expect(await repositories.alias.vote(10002, 'Pending Alias', 'user-1')).toBe(true)
    expect(await repositories.alias.getVotes(10002, 'Pending Alias')).toBe(-2)
    expect(await repositories.alias.exact('pending alias')).toEqual([])
    expect(await repositories.alias.list(10002)).toEqual([])

    expect(await repositories.alias.vote(10002, 'Pending Alias', 'user-2')).toBe(true)
    expect(await repositories.alias.getVotes(10002, 'Pending Alias')).toBe(-1)
    expect(await repositories.alias.list(10002)).toEqual([])

    expect(await repositories.alias.vote(10002, 'Pending Alias', 'user-3')).toBe(true)
    expect(await repositories.alias.getVotes(10002, 'Pending Alias')).toBe(0)
    expect(await repositories.alias.exact(' pending alias ')).toEqual([10002])
    expect(await repositories.alias.list(10002)).toEqual([
      expect.objectContaining({ musicId: 10002, name: 'Pending Alias', votes: 0 }),
    ])
  })

  it('bulk-lists only approved aliases and reflects promotion and deletion immediately', async () => {
    await repositories.alias.add(10001, 'Approved Alias')
    await repositories.alias.vote(10002, 'Pending Alias', 'user-1')
    const get = vi.spyOn(ctx.database, 'get')

    expect(await repositories.alias.allApproved()).toEqual([
      expect.objectContaining({ musicId: 10001, name: 'Approved Alias', votes: 0 }),
    ])
    expect(get).toHaveBeenLastCalledWith('mai_alias', { votes: { $gte: 0 } })

    await repositories.alias.vote(10002, 'Pending Alias', 'user-2')
    await repositories.alias.vote(10002, 'Pending Alias', 'user-3')
    expect(await repositories.alias.allApproved()).toEqual(expect.arrayContaining([
      expect.objectContaining({ musicId: 10001, name: 'Approved Alias', votes: 0 }),
      expect.objectContaining({ musicId: 10002, name: 'Pending Alias', votes: 0 }),
    ]))

    await repositories.alias.remove(10001, 'Approved Alias')
    expect(await repositories.alias.allApproved()).toEqual([
      expect.objectContaining({ musicId: 10002, name: 'Pending Alias', votes: 0 }),
    ])
  })

  it('promotes an existing pending alias when it is added directly', async () => {
    await repositories.alias.vote(10003, 'Promoted Alias', 'user-1')

    await repositories.alias.add(10003, 'Promoted Alias')

    expect(await repositories.alias.getVotes(10003, 'Promoted Alias')).toBe(0)
    expect(await repositories.alias.exact('promoted alias')).toEqual([10003])
  })

  it('rolls back the unique vote when the alias count mutation fails', async () => {
    await repositories.alias.add(10004, 'Atomic Alias')
    vi.spyOn(ctx.database, 'set').mockRejectedValueOnce(new Error('count mutation failed'))

    await expect(repositories.alias.vote(10004, 'Atomic Alias', 'user-1'))
      .rejects.toThrow('count mutation failed')

    expect(await repositories.alias.getVotes(10004, 'Atomic Alias')).toBe(0)
    expect(await ctx.database.get('mai_alias_vote', {
      musicId: 10004,
      name: 'Atomic Alias',
      userId: 'user-1',
    })).toEqual([])
  })

  it('serializes distinct alias votes across repository contexts sharing one database', async () => {
    const forkedRepositories = new MaiRepositories(createContextSharingDatabase(ctx))
    await repositories.alias.add(10005, 'Shared Database Alias')

    const results = await Promise.all([
      repositories.alias.vote(10005, 'Shared Database Alias', 'user-1'),
      forkedRepositories.alias.vote(10005, 'Shared Database Alias', 'user-2'),
    ])

    expect(results).toEqual([true, true])
    expect(await repositories.alias.getVotes(10005, 'Shared Database Alias')).toBe(2)
  })

  it('shares locks through an explicitly supplied repository coordinator', async () => {
    const coordinator = new RepositoryCoordinator()
    const first = new MaiRepositories(
      { database: ctx.database, root: {} as Context } as Context,
      '',
      coordinator,
    )
    const second = new MaiRepositories(
      { database: ctx.database, root: {} as Context } as Context,
      '',
      coordinator,
    )
    await first.alias.add(10006, 'Explicit Coordinator Alias')

    await Promise.all([
      first.alias.vote(10006, 'Explicit Coordinator Alias', 'user-1'),
      second.alias.vote(10006, 'Explicit Coordinator Alias', 'user-2'),
    ])

    expect(await repositories.alias.getVotes(10006, 'Explicit Coordinator Alias')).toBe(2)
  })

  it('shares arcade aliases, count, and modification time across bound channels', async () => {
    await repositories.arcade.getOrCreateGroup('channel-a')
    await repositories.arcade.addArcade('channel-a', 'Downtown')
    await repositories.arcade.addAlias('channel-a', 'Downtown', 'DT')
    await repositories.arcade.bind('channel-b', 'channel-a')

    const modifiedAt = new Date('2026-07-13T08:30:00.000Z')
    const updated = await repositories.arcade.setCount('channel-b', 'dt', 17, modifiedAt)

    expect(updated).toMatchObject({
      name: 'Downtown',
      aliases: ['Downtown', 'DT'],
      value: 17,
      modifiedAt,
    })
    expect(await repositories.arcade.find('channel-a', 'DT')).toEqual(updated)
    expect((await repositories.arcade.list('channel-b'))?.length).toBe(1)
  })

  it('lets an explicit arcade binding win a concurrent automatic channel creation', async () => {
    const target = await repositories.arcade.getOrCreateGroup('target-group')
    let releaseLookup!: () => void
    let lookupEntered!: () => void
    const lookupStarted = new Promise<void>((resolve) => {
      lookupEntered = resolve
    })
    const continueLookup = new Promise<void>((resolve) => {
      releaseLookup = resolve
    })
    const originalGet = ctx.database.get.bind(ctx.database) as any
    vi.spyOn(ctx.database, 'get').mockImplementation(async (...args: any[]) => {
      const [table, query] = args
      if (table === 'mai_arcade_group' && query?.name === 'target-group') {
        lookupEntered()
        await continueLookup
      }
      return originalGet(...args)
    })

    const binding = repositories.arcade.bind('race-channel', 'target-group')
    await lookupStarted
    const automatic = repositories.arcade.getOrCreateGroup('race-channel')
    let automaticCompleted = false
    void automatic.then(() => {
      automaticCompleted = true
    })

    await Promise.resolve()
    expect(automaticCompleted).toBe(false)

    releaseLookup()
    const [bound, created] = await Promise.all([binding, automatic])
    expect(bound).toMatchObject({ id: target.id, name: 'target-group' })
    expect(created).toMatchObject({ id: target.id, name: 'target-group' })
    expect(await repositories.arcade.findGroup('race-channel')).toMatchObject(target)
  })

  it('recovers when another creator wins the arcade group uniqueness race', async () => {
    const create = ctx.database.create.bind(ctx.database) as any
    vi.spyOn(ctx.database, 'create').mockImplementation((async (table: any, data: any) => {
      const row = await create(table, data)
      if (table === 'mai_arcade_group') {
        throw Object.assign(new Error('duplicate entry'), { code: 'duplicate-entry' })
      }
      return row
    }) as any)

    await expect(repositories.arcade.getOrCreateGroup('racing-channel'))
      .resolves.toMatchObject({ name: 'racing-channel' })
    expect(await ctx.database.get('mai_arcade_group', { name: 'racing-channel' }))
      .toHaveLength(1)
  })

  it('serializes arcade alias mutations across contexts sharing one database', async () => {
    const forkedRepositories = new MaiRepositories(createContextSharingDatabase(ctx))
    await repositories.arcade.addArcade('shared-arcade-channel', 'Central')

    await Promise.all([
      repositories.arcade.addAlias('shared-arcade-channel', 'Central', 'A'),
      forkedRepositories.arcade.addAlias('shared-arcade-channel', 'Central', 'B'),
    ])

    expect(await repositories.arcade.aliases('shared-arcade-channel', 'Central'))
      .toEqual(['Central', 'A', 'B'])
  })

  it('serializes concurrent arcade count adjustments without losing increments', async () => {
    const forkedRepositories = new MaiRepositories(createContextSharingDatabase(ctx))
    await repositories.arcade.addArcade('increment-channel', 'North')

    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      (index % 2 ? repositories : forkedRepositories)
        .arcade.adjustCount('increment-channel', 'North', 1)
    )))

    expect((await repositories.arcade.find('increment-channel', 'North'))?.value).toBe(20)
  })

  it('stores arcade counts above fifty while preserving the non-negative floor', async () => {
    await repositories.arcade.addArcade('count-policy-channel', 'West')

    expect((await repositories.arcade.setCount('count-policy-channel', 'West', 75)).value)
      .toBe(75)
    expect((await repositories.arcade.adjustCount('count-policy-channel', 'West', -100)).value)
      .toBe(0)
  })

  it('saves and restores only guess games newer than thirty minutes', async () => {
    const now = new Date('2026-07-13T09:00:00.000Z')
    const baseGame = {
      platform: 'qq',
      channelId: 'channel-1',
      guildId: null,
      userId: 'user-1',
      type: 'classical' as const,
      status: { musicId: 10001, hints: ['artist'] },
    }

    await repositories.guess.save(
      { contextId: 'fresh', ...baseGame },
      new Date(now.getTime() - GUESS_GAME_TTL_MS + 1),
    )
    await repositories.guess.save(
      { contextId: 'expired', ...baseGame },
      new Date(now.getTime() - GUESS_GAME_TTL_MS),
    )

    expect(await repositories.guess.restore(now)).toEqual([
      expect.objectContaining({ contextId: 'fresh', status: baseGame.status }),
    ])
    expect(await ctx.database.get('mai_guess_game', { contextId: 'expired' })).toEqual([])
  })

  it('encrypts OAuth tokens at rest and decrypts them on roundtrip', async () => {
    const expiresAt = new Date('2026-07-14T09:00:00.000Z')
    await repositories.oauth.save({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'access-token-plaintext',
      refreshToken: 'refresh-token-plaintext',
      expiresAt,
    })

    const [stored] = await ctx.database.get('mai_oauth_token', {
      userId: 'user-1',
      provider: 'lxns',
    })
    expect(stored.accessToken).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(stored.refreshToken).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(stored.accessToken).not.toContain('access-token-plaintext')
    expect(stored.refreshToken).not.toContain('refresh-token-plaintext')

    expect(await repositories.oauth.get('user-1', 'lxns')).toMatchObject({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'access-token-plaintext',
      refreshToken: 'refresh-token-plaintext',
      expiresAt,
    })
  })

  it('rejects OAuth persistence clearly when no cipher key is configured', async () => {
    const withoutKey = new MaiRepositories(ctx, '')

    await expect(withoutKey.oauth.save({
      userId: 'user-1',
      provider: 'lxns',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: new Date('2026-07-14T09:00:00.000Z'),
    })).rejects.toThrow('OAuth token persistence requires config.oauth.tokenCipherKey')
    expect(() => new TokenCipher('').encrypt('token'))
      .toThrow('OAuth token persistence requires config.oauth.tokenCipherKey')
  })
})

describe('default lifecycle database integration', () => {
  it('exports database repositories and model registration from the public entrypoint', () => {
    const exports = publicApi as Record<string, unknown>

    expect(exports.MaiRepositories).toBe(MaiRepositories)
    expect(exports.registerMaiDatabaseModels).toBe(registerMaiDatabaseModels)
  })

  it('registers database models without replacing lifecycle diagnostics or cleanup', async () => {
    const ctx = new Context()
    ctx.plugin(MemoryDriver)
    Object.defineProperty(ctx, 'server', {
      configurable: true,
      value: { selfUrl: 'https://server.example' },
    })
    await ctx.start()

    try {
      await initializePlugin(ctx, config)
      expect(ctx.model.tables.mai_oauth_token.primary).toEqual(['userId', 'provider'])
    } finally {
      await ctx.stop()
    }
  })
})
