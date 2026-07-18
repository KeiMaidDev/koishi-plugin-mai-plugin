import { lazyDamerauLevenshtein } from '@guswpm/damerau-levenshtein'
import type { MaimaiDataStore } from '../data/sync-service'
import type { AliasRepository } from '../database/repositories'
import type { MusicInfo } from '../domain/music'
import {
  compactSearchText,
  normalizeSearchText,
  tokenizeSearchText,
} from '../utils/strings'

type AliasRepositoryPort = Pick<AliasRepository, 'add' | 'remove' | 'allApproved' | 'vote'>

export interface AliasRepositoriesPort {
  alias: AliasRepositoryPort
}

interface SearchDocument {
  music: MusicInfo
  fields: string[]
}

function byMusicId(left: MusicInfo, right: MusicInfo) {
  return left.id - right.id
}

function analyzedTerms(value: string, limit = Number.POSITIVE_INFINITY) {
  return [...new Set(tokenizeSearchText(value))]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
    .slice(0, limit)
}

function fuzzyDistance(queryTerm: string, fieldTerm: string) {
  if (Math.abs(queryTerm.length - fieldTerm.length) > 1) return 2
  if (queryTerm.length > 4 && queryTerm[0] !== fieldTerm[0]) return 2
  return lazyDamerauLevenshtein(queryTerm, fieldTerm, 1, 2)
}

function tokenScore(queryTokens: string[], fields: string[]) {
  const minimumClauses = queryTokens.length >= 4 ? 2 : 1
  let best = 0
  for (const field of fields) {
    const fieldTokens = analyzedTerms(field)
    let clauses = 0
    let score = 0
    for (const queryToken of queryTokens) {
      const exact = fieldTokens.includes(queryToken)
      if (exact) {
        clauses += 1
        score += queryToken.length
      }
      if (queryToken.length < 2) continue

      const fuzzy = exact || fieldTokens.some(fieldToken => fuzzyDistance(queryToken, fieldToken) === 1)
      if (fuzzy) {
        clauses += 1
        score += queryToken.length
      }
    }
    if (clauses >= minimumClauses) best = Math.max(best, score)
  }
  return best
}

function uniqueSearchFields(fields: string[]) {
  const seen = new Set<string>()
  return fields.filter(field => {
    const normalized = normalizeSearchText(field)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

export class AliasService {
  constructor(
    private readonly data: MaimaiDataStore,
    private readonly repositories: AliasRepositoriesPort,
  ) {}

  async search(rawName: string) {
    const query = normalizeSearchText(rawName)
    if (!query) return []

    const idMatch = query.match(/^id\s*(\d+)$/)
    if (idMatch) {
      const music = this.musicById(Number(idMatch[1]))
      if (music.length) return music
    }
    if (/^\d+$/.test(query)) {
      const music = this.musicById(Number(query))
      if (music.length) return music
    }

    const musics = [...this.data.musics.values()]
    const exactTitles = musics
      .filter(music => normalizeSearchText(music.name) === query)
      .sort(byMusicId)
    if (exactTitles.length) return exactTitles

    const documents = await this.documents(musics)
    const exactAliases = documents
      .filter(document => document.fields.slice(1).some(alias => normalizeSearchText(alias) === query))
      .map(document => document.music)
      .sort(byMusicId)
    if (exactAliases.length) return exactAliases

    const compactQuery = compactSearchText(query)
    if (compactQuery.length < 2) return []

    const queryTokens = analyzedTerms(query, 6)
    const relevant = documents
      .map(document => ({ document, score: tokenScore(queryTokens, document.fields) }))
      .filter(result => result.score > 0)
    if (relevant.length) {
      const maximum = Math.max(...relevant.map(result => result.score))
      return relevant
        .filter(result => result.score >= maximum * 0.45)
        .sort((left, right) => right.score - left.score || left.document.music.id - right.document.music.id)
        .slice(0, 100)
        .map(result => result.document.music)
    }

    return documents
      .filter(document => document.fields.some(field => compactSearchText(field).includes(compactQuery)))
      .map(document => document.music)
      .sort(byMusicId)
  }

  add(musicId: number, alias: string) {
    return this.repositories.alias.add(musicId, alias)
  }

  remove(musicId: number, alias: string) {
    return this.repositories.alias.remove(musicId, alias)
  }

  vote(musicId: number, alias: string, userId: string) {
    return this.repositories.alias.vote(musicId, alias, userId)
  }

  private musicById(id: number) {
    const music = this.data.musics.get(id)
    return music ? [music] : []
  }

  private async documents(musics: MusicInfo[]): Promise<SearchDocument[]> {
    const aliasesByMusic = new Map<number, string[]>()
    for (const alias of await this.repositories.alias.allApproved()) {
      const names = aliasesByMusic.get(alias.musicId) ?? []
      names.push(alias.name)
      aliasesByMusic.set(alias.musicId, names)
    }
    return musics.map(music => ({
      music,
      fields: uniqueSearchFields([
        music.name,
        ...(this.data.remoteAliases.get(music.id) ?? []),
        ...(aliasesByMusic.get(music.id) ?? []),
      ]),
    }))
  }
}
