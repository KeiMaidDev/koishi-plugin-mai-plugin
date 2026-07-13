import { describe, expect, it } from 'vitest'
import { MaimaiDataStore } from '../../src/data/sync-service'
import { MusicDifficulty, MusicGenre, MusicType } from '../../src/domain/enums'
import { ChartInfo, MusicInfo, Notes, type GameVersion } from '../../src/domain/music'
import type { MaiAlias } from '../../src/database/models'
import { AliasService } from '../../src/services/alias-service'

const version: GameVersion = { id: 1, name: '舞萌DX 2025', version: 22_000 }

function music(id: number, name: string) {
  const result = new MusicInfo(id, name, MusicType.Deluxe, '', 'Artist', MusicGenre.Original, 180, version, true)
  result.charts = [new ChartInfo(result, MusicDifficulty.Master, '14', 14, new Notes(100), 'Designer')]
  return result
}

const musics = [
  music(123, '潘多拉悖论'),
  music(124, '潘多拉之歌'),
  music(300, '测试歌曲 Alpha'),
  music(200, '测试歌曲 Beta'),
  music(500, '完全不同'),
  music(600, 'Panopticon'),
  music(700, 'id999'),
]

const data = new MaimaiDataStore({
  revision: 'alias-test',
  versions: new Map([[version.name, version]]),
  musics: new Map(musics.map(item => [item.id, item])),
  plates: new Map(),
  icons: new Map(),
  courses: new Map(),
}, {
  schemaVersion: 1,
  revision: 'alias-test',
  generatedAt: '2026-07-13T00:00:00.000Z',
  files: {},
}, new Map())

class MemoryAliasRepository {
  private readonly rows = new Map<string, MaiAlias>()
  private readonly voters = new Set<string>()
  allApprovedCalls = 0
  listCalls = 0

  constructor(entries: Array<[number, string, number]> = []) {
    for (const [musicId, name, votes] of entries) this.set(musicId, name, votes)
  }

  async add(musicId: number, name: string) {
    this.set(musicId, name, 0)
  }

  async remove(musicId: number, name: string) {
    this.rows.delete(this.key(musicId, name))
  }

  async exact(name: string) {
    const normalized = name.trim().toLocaleLowerCase()
    return [...this.rows.values()]
      .filter(row => row.votes >= 0 && row.name.toLocaleLowerCase() === normalized)
      .map(row => row.musicId)
  }

  async list(musicId: number) {
    this.listCalls += 1
    return [...this.rows.values()].filter(row => row.musicId === musicId && row.votes >= 0)
  }

  async allApproved() {
    this.allApprovedCalls += 1
    return [...this.rows.values()].filter(row => row.votes >= 0)
  }

  async getVotes(musicId: number, name: string) {
    return this.rows.get(this.key(musicId, name))?.votes ?? null
  }

  async hasVoted(musicId: number, name: string, userId: string) {
    return this.voters.has(`${this.key(musicId, name)}\0${userId}`)
  }

  async vote(musicId: number, name: string, userId: string) {
    const voteKey = `${this.key(musicId, name)}\0${userId}`
    if (this.voters.has(voteKey)) return false
    this.voters.add(voteKey)
    const current = this.rows.get(this.key(musicId, name))
    this.set(musicId, name, current ? current.votes + 1 : -2)
    return true
  }

  private set(musicId: number, name: string, votes: number) {
    this.rows.set(this.key(musicId, name), { musicId, name, votes, createdAt: new Date(0) })
  }

  private key(musicId: number, name: string) {
    return `${musicId}\0${name}`
  }
}

function createService(entries: Array<[number, string, number]> = []) {
  const alias = new MemoryAliasRepository(entries)
  return {
    alias,
    service: new AliasService(data, { alias }),
  }
}

describe('AliasService', () => {
  it('ranks id123 as an exact ID lookup before every text strategy', async () => {
    const { service } = createService([[300, 'id123', 0]])

    expect((await service.search('ｉｄ１２３')).map(item => item.id)).toEqual([123])
  })

  it('ranks normalized exact titles before aliases and fuzzy matches', async () => {
    const { service } = createService([[500, '潘多拉悖论', 0]])

    expect((await service.search(' 潘多拉悖論。 ')).map(item => item.id)).toEqual([123])
  })

  it('continues text ranking when id-prefixed and numeric IDs do not exist', async () => {
    const { service } = createService([[500, '999', 0]])

    expect((await service.search('id999')).map(item => item.id)).toEqual([700])
    expect((await service.search('999')).map(item => item.id)).toEqual([500])
  })

  it('ranks exact aliases after exact titles with deterministic ID ties', async () => {
    const { service } = createService([
      [300, '共同别名', 0],
      [200, '共同別名', 0],
    ])

    expect((await service.search('共同別名')).map(item => item.id)).toEqual([200, 300])
  })

  it('ranks token relevance before contains and breaks equal scores by ID', async () => {
    const { service } = createService([
      [300, '神秘 测试 Alpha', 0],
      [200, '神秘 测试 Beta', 0],
      [500, '前缀神秘测试后缀', 0],
    ])

    expect((await service.search('神秘 测试')).map(item => item.id)).toEqual([200, 300, 500])
  })

  it('ports one-edit fuzzy matching for title typos', async () => {
    const { service } = createService()

    expect((await service.search('Panoptcon')).map(item => item.id)).toEqual([600])
  })

  it.each(['Pnaopticon', 'Panotpicon', 'Panopticno'])(
    'treats adjacent transposition %s as one fuzzy edit',
    async query => {
      const { service } = createService()

      expect((await service.search(query)).map(item => item.id)).toEqual([600])
    },
  )

  it('keeps the one-character prefix guard for long fuzzy terms', async () => {
    const { service } = createService()

    expect(await service.search('Xanopticon')).toEqual([])
  })

  it('counts exact and fuzzy SHOULD clauses like Lucene for four-term queries', async () => {
    const { service } = createService([
      [123, 'alpha unmatched', 0],
      [124, 'alpah unmatched', 0],
      [500, 'alpah beat unmatched', 0],
    ])

    const result = (await service.search('alpha beta gamma delta')).map(item => item.id)
    expect(result).toEqual([123, 300, 500, 200])
    expect(result).not.toContain(124)
  })

  it('applies the 0.45 score threshold after clause admission', async () => {
    const { service } = createService([
      [123, 'extraordinary marker', 0],
      [500, 'tinx marker', 0],
    ])

    expect((await service.search('extraordinary tiny')).map(item => item.id)).toEqual([123])
  })

  it('orders exact token relevance before fuzzy token relevance within the Lucene threshold', async () => {
    const { service } = createService([
      [300, 'Mysterious Test Alpha', 0],
      [200, 'Mysterious Test Beta', 0],
      [500, 'Mysterios Test Gamma', 0],
    ])

    expect((await service.search('Mysterious Test')).map(item => item.id)).toEqual([200, 300, 500])
  })

  it('loads all approved aliases once per non-exact search without per-music reads', async () => {
    const { alias, service } = createService()

    expect((await service.search('lph')).map(item => item.id)).toEqual([300])
    expect(alias.allApprovedCalls).toBe(1)
    expect(alias.listCalls).toBe(0)
  })

  it('falls back to normalized contains matches', async () => {
    const { service } = createService()

    expect((await service.search('lph')).map(item => item.id)).toEqual([300])
  })

  it('returns no results for empty and too-broad non-exact queries', async () => {
    const { service } = createService()

    expect(await service.search('，。！？')).toEqual([])
    expect(await service.search('潘')).toEqual([])
  })

  it('promotes a pending alias exactly at the third distinct vote without stale search state', async () => {
    const { alias, service } = createService()

    await alias.vote(123, '测试别名', 'user-1')
    await alias.vote(123, '测试别名', 'user-2')
    expect((await service.search('测试别名')).map(item => item.id)).not.toContain(123)

    await alias.vote(123, '测试别名', 'user-3')
    expect((await service.search('测试别名')).map(item => item.id)).toEqual([123])
  })

  it('reflects direct admin promotion immediately', async () => {
    const { alias, service } = createService([[124, '候选别名', -2]])

    expect(await service.search('候选别名')).toEqual([])
    await alias.add(124, '候选别名')
    expect((await service.search('候选别名')).map(item => item.id)).toEqual([124])
  })

  it('removes an admin-deleted alias from search immediately', async () => {
    const { alias, service } = createService([[123, '即删别名', 0]])

    expect((await service.search('即删别名')).map(item => item.id)).toEqual([123])
    await alias.remove(123, '即删别名')
    expect(await service.search('即删别名')).toEqual([])
  })
})
