import { MusicDifficulty, MusicGenre, MusicType } from '../domain/enums'
import type { MusicInfo } from '../domain/music'
import type { Awaitable } from '../types'

export const CLASSICAL_HINT_COUNT = 6
export const CLASSICAL_HINT_COOLDOWN_MS = 10_000
export const CLASSICAL_REVEAL_DELAY_MS = 30_000
export const OPENING_MAX_SONGS = 8
export const OPENING_MAX_LETTERS = 8

export type GuessGameType = 'classical' | 'opening'

export interface GuessTarget {
  contextId: string
  platform: string
  channelId: string
  guildId: string | null
  userId: string
  direct: boolean
}

export interface GuessInteraction extends GuessTarget {
  reply(message: GuessReply): Awaitable<void>
}

export interface GuessMessage extends GuessInteraction {
  content: string
}

export type GuessReply =
  | { type: 'text', text: string }
  | { type: 'image', text: string, image: Buffer }

export interface ClassicalGuessStatus {
  version: 1
  phase: 'hints' | 'crop' | 'finished'
  gameId: string
  musicId: number
  hints: string[]
  hintIndex: number
  nextAt: number | null
  seed: string
}

export interface OpeningGuessMusicStatus {
  musicId: number
  revealed: boolean
}

export interface OpeningGuessStatus {
  version: 1
  phase: 'playing' | 'finished'
  gameId: string
  musics: OpeningGuessMusicStatus[]
  opened: string[]
}

export type GuessGameStatus = ClassicalGuessStatus | OpeningGuessStatus

export interface PersistedGuessGame extends GuessTarget {
  type: GuessGameType
  status: GuessGameStatus
  modifiedAt: Date
}

export interface GuessRepositoryPort {
  save(game: Omit<PersistedGuessGame, 'direct' | 'modifiedAt'>, modifiedAt?: Date): Promise<void>
  restore(now?: Date): Promise<Array<Omit<PersistedGuessGame, 'direct' | 'status'> & { status: unknown }>>
  remove(contextId: string): Promise<void>
}

export interface GuessAliasServicePort {
  search(query: string): Promise<readonly MusicInfo[]>
}

export interface GuessRendererPort {
  renderCrop(input: { contextId: string, music: MusicInfo, seed: string }): Promise<Buffer>
  renderFinal(input: { music: MusicInfo, title: string, description: string }): Promise<Buffer>
}

export interface GuessTimerPort {
  setTimeout(callback: () => void, delayMs: number): unknown
  clearTimeout(handle: unknown): void
}

export interface GuessLogger {
  warn(message: string): void
}

export interface GuessServiceOptions {
  musics: ReadonlyMap<number, MusicInfo>
  repository: GuessRepositoryPort
  aliasService: GuessAliasServicePort
  renderer: GuessRendererPort
  send?: (target: GuessTarget, reply: GuessReply) => Awaitable<void>
  random?: () => number
  now?: () => Date
  timers?: GuessTimerPort
  logger?: GuessLogger
}

export type GuessStartResult =
  | { ok: true, type: GuessGameType }
  | { ok: false, reason: 'active' | 'unavailable' }

export type GuessHandleResult =
  | { consumed: false, action: 'inactive' }
  | {
      consumed: true
      action: 'ignored' | 'updated' | 'correct' | 'stopped' | 'invalid'
    }

export class GuessDeliveryError extends Error {
  constructor(readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'GuessDeliveryError'
  }
}

interface ActiveGuessGame {
  token: object
  target: GuessTarget
  type: GuessGameType
  status: GuessGameStatus
  reply: (reply: GuessReply) => Awaitable<void>
  timer?: unknown
}

const defaultTimers: GuessTimerPort = {
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs)
    timer.unref?.()
    return timer
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  },
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isClassicalStatus(value: unknown): value is ClassicalGuessStatus {
  if (!isPlainObject(value)) return false
  const phase = String(value.phase)
  const validDeadline = phase === 'finished'
    ? value.nextAt === null
    : finiteNumber(value.nextAt)
  return value.version === 1
    && ['hints', 'crop', 'finished'].includes(phase)
    && typeof value.gameId === 'string'
    && Number.isSafeInteger(value.musicId)
    && Array.isArray(value.hints)
    && value.hints.length === CLASSICAL_HINT_COUNT
    && value.hints.every(hint => typeof hint === 'string')
    && Number.isSafeInteger(value.hintIndex)
    && Number(value.hintIndex) >= 0
    && Number(value.hintIndex) <= CLASSICAL_HINT_COUNT
    && validDeadline
    && typeof value.seed === 'string'
}

function isOpeningStatus(value: unknown): value is OpeningGuessStatus {
  if (!isPlainObject(value)) return false
  return value.version === 1
    && ['playing', 'finished'].includes(String(value.phase))
    && typeof value.gameId === 'string'
    && Array.isArray(value.musics)
    && value.musics.length > 0
    && value.musics.length <= OPENING_MAX_SONGS
    && value.musics.every(item => (
      isPlainObject(item)
      && Number.isSafeInteger(item.musicId)
      && typeof item.revealed === 'boolean'
    ))
    && Array.isArray(value.opened)
    && value.opened.length <= OPENING_MAX_LETTERS
    && value.opened.every(character => typeof character === 'string' && Array.from(character).length === 1)
}

function normalizeCharacter(character: string) {
  const codePoint = character.codePointAt(0)
  if (codePoint === undefined) return ''
  if (codePoint === 0x3000) return ' '
  if (codePoint >= 0xff01 && codePoint <= 0xff5e) {
    return String.fromCodePoint(codePoint - 0xfee0).toLocaleLowerCase()
  }
  return character.toLocaleLowerCase()
}

function shuffleStable<T>(values: readonly T[], random: () => number) {
  return values
    .map((value, index) => ({ value, index, order: random() }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(entry => entry.value)
}

function textReply(text: string): GuessReply {
  return { type: 'text', text }
}

function copyTarget(target: GuessTarget): GuessTarget {
  return {
    contextId: target.contextId,
    platform: target.platform,
    channelId: target.channelId,
    guildId: target.guildId,
    userId: target.userId,
    direct: target.direct,
  }
}

function songDescription(music: MusicInfo) {
  return `${music.id}. ${music.name}\n曲师：${music.artist || '未知'}\nBPM：${music.bpm}`
}

export class GuessService {
  private readonly active = new Map<string, ActiveGuessGame>()
  private readonly starting = new Set<string>()
  private readonly operationTails = new Map<string, Promise<void>>()
  private readonly random: () => number
  private readonly now: () => Date
  private readonly timers: GuessTimerPort
  private readonly logger: GuessLogger
  private disposed = false

  constructor(private readonly options: GuessServiceOptions) {
    this.random = options.random ?? Math.random
    this.now = options.now ?? (() => new Date())
    this.timers = options.timers ?? defaultTimers
    this.logger = options.logger ?? console
  }

  hasActiveGame(contextId: string) {
    return this.active.has(contextId) || this.starting.has(contextId)
  }

  startClassical(interaction: GuessInteraction) {
    return this.start('classical', interaction)
  }

  startOpening(interaction: GuessInteraction) {
    return this.start('opening', interaction)
  }

  async handleMessage(message: GuessMessage): Promise<GuessHandleResult> {
    const runtime = this.active.get(message.contextId)
    if (!runtime) return { consumed: false, action: 'inactive' }
    return this.serialized(message.contextId, async () => {
      const current = this.active.get(message.contextId)
      if (!current || current.token !== runtime.token) {
        return { consumed: false, action: 'inactive' }
      }
      this.updateInteraction(current, message)
      const content = message.content.trim()
      if (content.startsWith('不玩了')) {
        await this.stopForUser(current)
        return { consumed: true, action: 'stopped' }
      }
      if (current.type === 'classical') return this.handleClassical(current, content)
      return this.handleOpening(current, content)
    })
  }

  async stop(contextId: string): Promise<boolean> {
    return this.serialized(contextId, async () => {
      const runtime = this.active.get(contextId)
      if (!runtime) return false
      await this.removeRuntime(runtime)
      return true
    })
  }

  async restore() {
    this.disposed = false
    const activeContexts = [...this.active.keys()]
    await Promise.all(activeContexts.map(contextId => this.serialized(contextId, async () => {
      const runtime = this.active.get(contextId)
      if (!runtime) return
      this.active.delete(contextId)
      this.detachRuntime(runtime)
    })))

    const rows = await this.options.repository.restore(this.now())
    let restored = 0
    for (const row of rows) {
      const target: GuessTarget = {
        contextId: row.contextId,
        platform: row.platform,
        channelId: row.channelId,
        guildId: row.guildId,
        userId: row.userId,
        direct: row.guildId === null,
      }
      const reply = async (output: GuessReply) => {
        await this.options.send?.(target, output)
      }
      if (row.type === 'classical' && isClassicalStatus(row.status)) {
        if (!this.options.musics.has(row.status.musicId) || row.status.phase === 'finished') {
          await this.options.repository.remove(row.contextId)
          continue
        }
        const runtime: ActiveGuessGame = {
          token: {},
          target,
          type: 'classical',
          status: { ...row.status, hints: [...row.status.hints] },
          reply,
        }
        this.active.set(row.contextId, runtime)
        this.scheduleClassical(runtime)
        restored += 1
        continue
      }
      if (row.type === 'opening' && isOpeningStatus(row.status)) {
        const validMusics = row.status.musics.every(item => this.options.musics.has(item.musicId))
        if (!validMusics || row.status.phase === 'finished') {
          await this.options.repository.remove(row.contextId)
          continue
        }
        this.active.set(row.contextId, {
          token: {},
          target,
          type: 'opening',
          status: {
            ...row.status,
            musics: row.status.musics.map(item => ({ ...item })),
            opened: [...row.status.opened],
          },
          reply,
        })
        restored += 1
        continue
      }
      await this.options.repository.remove(row.contextId)
    }
    return restored
  }

  async dispose() {
    this.disposed = true
    const ownedContexts = [...new Set([...this.active.keys(), ...this.starting])]
    await Promise.all(ownedContexts.map(contextId => this.serialized(contextId, async () => {
      const runtime = this.active.get(contextId)
      if (!runtime) return
      this.active.delete(contextId)
      this.detachRuntime(runtime)
      await this.options.repository.remove(contextId)
    })))
    this.starting.clear()
  }

  private async start(
    type: GuessGameType,
    interaction: GuessInteraction,
  ): Promise<GuessStartResult> {
    if (this.disposed) return { ok: false, reason: 'unavailable' }
    if (this.active.has(interaction.contextId) || this.starting.has(interaction.contextId)) {
      return { ok: false, reason: 'active' }
    }
    this.starting.add(interaction.contextId)
    return this.serialized(interaction.contextId, async () => {
      try {
        if (this.disposed) return { ok: false, reason: 'unavailable' }
        return type === 'classical'
          ? await this.startClassicalGame(interaction)
          : await this.startOpeningGame(interaction)
      } finally {
        this.starting.delete(interaction.contextId)
      }
    })
  }

  private async startClassicalGame(interaction: GuessInteraction): Promise<GuessStartResult> {
    const candidates = [...this.options.musics.values()]
      .filter(music => music.genre !== MusicGenre.Utage)
    const music = shuffleStable(candidates, this.random)[0]
    if (!music) return { ok: false, reason: 'unavailable' }

    const startedAt = this.now().getTime()
    const gameId = this.createGameId(interaction.contextId, 'classical', startedAt)
    const hints = shuffleStable(this.classicalDescriptions(music), this.random)
      .slice(0, CLASSICAL_HINT_COUNT)
      .map((description, index) => `提示${index + 1}/${CLASSICAL_HINT_COUNT + 1}：这首歌${description}`)
    const status: ClassicalGuessStatus = {
      version: 1,
      phase: 'hints',
      gameId,
      musicId: music.id,
      hints,
      hintIndex: 1,
      nextAt: startedAt + CLASSICAL_HINT_COOLDOWN_MS,
      seed: `${interaction.contextId}:${music.id}:${gameId}`,
    }
    const runtime = this.createRuntime(interaction, 'classical', status)
    await this.persist(runtime, status)
    this.active.set(interaction.contextId, runtime)
    try {
      await runtime.reply(textReply([
        '这是一个 maimai 猜歌小游戏~',
        '你需要根据接下来的提示猜出歌曲名称。',
        '回复歌曲名作答，说“不玩了”可以结束游戏。',
      ].join('\n')))
      await runtime.reply(textReply(hints[0]))
      this.scheduleClassical(runtime)
      return { ok: true, type: 'classical' }
    } catch (error) {
      await this.removeRuntime(runtime)
      throw new GuessDeliveryError(error)
    }
  }

  private async startOpeningGame(interaction: GuessInteraction): Promise<GuessStartResult> {
    const candidates = [...this.options.musics.values()]
      .filter(music => (
        music.genre !== MusicGenre.Utage
        && /[A-Za-z0-9\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/u.test(music.name)
      ))
    const selected = shuffleStable(candidates, this.random).slice(0, OPENING_MAX_SONGS)
    if (!selected.length) return { ok: false, reason: 'unavailable' }

    const startedAt = this.now().getTime()
    const status: OpeningGuessStatus = {
      version: 1,
      phase: 'playing',
      gameId: this.createGameId(interaction.contextId, 'opening', startedAt),
      musics: selected.map(music => ({ musicId: music.id, revealed: false })),
      opened: [],
    }
    const runtime = this.createRuntime(interaction, 'opening', status)
    await this.persist(runtime, status)
    this.active.set(interaction.contextId, runtime)
    try {
      await runtime.reply(textReply([
        '这是一个 maimai 猜歌小游戏~',
        `你需要猜出 ${selected.length} 首来自 maimai 的歌曲曲名！`,
        '发送“开字母 X”开出字符，发送“开歌 曲名”直接开歌，说“不玩了”结束游戏。',
      ].join('\n')))
      await runtime.reply(textReply(this.openingBoard(status)))
      return { ok: true, type: 'opening' }
    } catch (error) {
      await this.removeRuntime(runtime)
      throw new GuessDeliveryError(error)
    }
  }

  private createRuntime(
    interaction: GuessInteraction,
    type: GuessGameType,
    status: GuessGameStatus,
  ): ActiveGuessGame {
    return {
      token: {},
      target: copyTarget(interaction),
      type,
      status,
      reply: interaction.reply,
    }
  }

  private updateInteraction(runtime: ActiveGuessGame, interaction: GuessInteraction) {
    runtime.target = copyTarget(interaction)
    runtime.reply = interaction.reply
  }

  private createGameId(contextId: string, type: GuessGameType, now: number) {
    const random = Math.floor(Math.max(0, Math.min(0.999999999999, this.random())) * 0x100000000)
    return `${type}:${contextId}:${now.toString(36)}:${random.toString(36)}`
  }

  private classicalDescriptions(music: MusicInfo) {
    const expert = music.charts.find(chart => chart.difficulty === MusicDifficulty.Expert)
    const master = music.charts.find(chart => chart.difficulty === MusicDifficulty.Master)
    const hasReMaster = music.charts.some(chart => chart.difficulty === MusicDifficulty.ReMaster)
    const typeDescription = music.type === MusicType.Deluxe
      ? '是 DX 谱面'
      : this.options.musics.has(music.id + 10_000)
        ? '既有 DX 谱面也有标准谱面'
        : '没有 DX 谱面'
    return [
      `的版本为 ${music.version.name}${music.isNew ? '（计入 b15）' : ''}`,
      typeDescription,
      `的艺术家为 ${music.artist || '未知'}`,
      `的分类为 ${music.genre.genreName}`,
      `的 BPM 为 ${music.bpm}`,
      `的红谱等级为 ${expert?.levelValue ?? '未知'}`,
      `的紫谱等级为 ${master?.levelValue ?? '未知'}`,
      `的紫谱谱师为 ${master?.notesDesigner || '未知'}`,
      `${hasReMaster ? '有' : '没有'}白谱`,
    ]
  }

  private async handleClassical(
    runtime: ActiveGuessGame,
    content: string,
  ): Promise<GuessHandleResult> {
    if (!content) return { consumed: true, action: 'ignored' }
    const status = runtime.status as ClassicalGuessStatus
    const answers = await this.options.aliasService.search(content)
    if (!answers.slice(0, 10).some(answer => answer.id === status.musicId)) {
      return { consumed: true, action: 'ignored' }
    }
    await this.finishClassical(runtime, '恭喜你猜中了哦~')
    return { consumed: true, action: 'correct' }
  }

  private async handleOpening(
    runtime: ActiveGuessGame,
    content: string,
  ): Promise<GuessHandleResult> {
    const status = runtime.status as OpeningGuessStatus
    const letterMatch = content.match(/^开字母(?:\s+(.*))?$/u)
    if (letterMatch) {
      const characters = Array.from((letterMatch[1] ?? '').trim())
      if (characters.length !== 1 || !characters[0].trim()) {
        await runtime.reply(textReply('请在“开字母”后输入一个字符。'))
        return { consumed: true, action: 'invalid' }
      }
      const character = normalizeCharacter(characters[0])
      if (status.opened.includes(character)) {
        await runtime.reply(textReply(`字母“${characters[0]}”已经开过了！`))
        return { consumed: true, action: 'invalid' }
      }
      if (status.opened.length >= OPENING_MAX_LETTERS) {
        await runtime.reply(textReply(`最多只能开 ${OPENING_MAX_LETTERS} 个字母。`))
        return { consumed: true, action: 'invalid' }
      }
      const opened = [...status.opened, character]
      const musics = status.musics.map(item => ({
        ...item,
        revealed: item.revealed || this.musicFullyOpened(item.musicId, opened),
      }))
      return this.updateOpening(runtime, { ...status, opened, musics })
    }

    const songMatch = content.match(/^开歌(?:\s+(.*))?$/u)
    if (songMatch) {
      const query = (songMatch[1] ?? '').trim()
      if (!query) {
        await runtime.reply(textReply('请在“开歌”后输入歌曲名称。'))
        return { consumed: true, action: 'invalid' }
      }
      const answers = await this.options.aliasService.search(query)
      if (!answers.length) {
        await runtime.reply(textReply('歌曲不存在！'))
        return { consumed: true, action: 'invalid' }
      }
      const answerIds = new Set(answers.slice(0, 10).map(music => music.id))
      const index = status.musics.findIndex(item => answerIds.has(item.musicId))
      if (index < 0) {
        await runtime.reply(textReply('歌曲不在题目列表中！'))
        return { consumed: true, action: 'invalid' }
      }
      if (status.musics[index].revealed) {
        await runtime.reply(textReply('这首歌已经开过了！'))
        return { consumed: true, action: 'invalid' }
      }
      const musics = status.musics.map((item, itemIndex) => (
        itemIndex === index ? { ...item, revealed: true } : { ...item }
      ))
      return this.updateOpening(runtime, { ...status, musics })
    }

    if (!content) return { consumed: true, action: 'ignored' }
    const answers = await this.options.aliasService.search(content)
    const answerIds = new Set(answers.slice(0, 10).map(music => music.id))
    const index = status.musics.findIndex(item => !item.revealed && answerIds.has(item.musicId))
    if (index < 0) return { consumed: true, action: 'ignored' }
    const musics = status.musics.map((item, itemIndex) => (
      itemIndex === index ? { ...item, revealed: true } : { ...item }
    ))
    const next = { ...status, musics }
    const musicName = this.options.musics.get(musics[index].musicId)?.name ?? ''
    return this.updateOpening(runtime, next, `恭喜你猜中了「${musicName}」！`)
  }

  private async updateOpening(
    runtime: ActiveGuessGame,
    next: OpeningGuessStatus,
    prefix = '',
  ): Promise<GuessHandleResult> {
    if (next.musics.every(item => item.revealed)) {
      const finished: OpeningGuessStatus = { ...next, phase: 'finished' }
      await this.persist(runtime, finished)
      try {
        await runtime.reply(textReply(`恭喜您猜出了全部歌曲！\n${this.openingBoard(finished, true)}`))
      } finally {
        await this.removeRuntime(runtime)
      }
      return { consumed: true, action: 'correct' }
    }
    await this.persist(runtime, next)
    const board = this.openingBoard(next)
    await runtime.reply(textReply(prefix ? `${prefix}\n${board}` : board))
    return { consumed: true, action: 'updated' }
  }

  private musicFullyOpened(musicId: number, opened: readonly string[]) {
    const music = this.options.musics.get(musicId)
    if (!music) return false
    const openedSet = new Set(opened)
    return Array.from(music.name).every(character => (
      !character.trim() || openedSet.has(normalizeCharacter(character))
    ))
  }

  private openingBoard(status: OpeningGuessStatus, revealAll = false) {
    const opened = new Set(status.opened)
    const lines = ['舞萌开字母']
    for (const item of status.musics) {
      const music = this.options.musics.get(item.musicId)
      if (!music) continue
      if (item.revealed) {
        lines.push(`✅ ${music.name}`)
        continue
      }
      const name = revealAll
        ? music.name
        : Array.from(music.name).map(character => (
            !character.trim() || opened.has(normalizeCharacter(character)) ? character : '?'
          )).join('')
      lines.push(`${revealAll ? '❌' : '🤔'} ${name}`)
    }
    lines.push(`已开出字母：${status.opened.join(', ') || '无'}`)
    return lines.join('\n')
  }

  private async stopForUser(runtime: ActiveGuessGame) {
    if (runtime.type === 'classical') {
      await this.finishClassical(runtime, '游戏已结束。答案如下：')
      return
    }
    const status = runtime.status as OpeningGuessStatus
    const finished: OpeningGuessStatus = { ...status, phase: 'finished' }
    await this.persist(runtime, finished)
    try {
      await runtime.reply(textReply(this.openingBoard(finished, true)))
    } finally {
      await this.removeRuntime(runtime)
    }
  }

  private async finishClassical(runtime: ActiveGuessGame, title: string) {
    this.clearRuntimeTimer(runtime)
    const status = runtime.status as ClassicalGuessStatus
    const music = this.options.musics.get(status.musicId)
    if (!music) {
      await this.removeRuntime(runtime)
      return
    }
    const finished: ClassicalGuessStatus = {
      ...status,
      phase: 'finished',
      nextAt: null,
    }
    await this.persist(runtime, finished)
    const description = songDescription(music)
    try {
      let image: Buffer
      try {
        image = await this.options.renderer.renderFinal({ music, title, description })
      } catch (error) {
        this.logger.warn(`[mai-plugin] guess final render failed: ${String(error)}`)
        await runtime.reply(textReply(`${title}\n${description}`))
        return
      }
      await runtime.reply({ type: 'image', text: `${title}\n${description}`, image })
    } finally {
      await this.removeRuntime(runtime)
    }
  }

  private scheduleClassical(runtime: ActiveGuessGame) {
    this.clearRuntimeTimer(runtime)
    const status = runtime.status as ClassicalGuessStatus
    if (this.disposed || status.nextAt === null || status.phase === 'finished') return
    const delay = Math.max(0, status.nextAt - this.now().getTime())
    const token = runtime.token
    runtime.timer = this.timers.setTimeout(() => (
      this.serialized(runtime.target.contextId, async () => {
        const current = this.active.get(runtime.target.contextId)
        if (!current || current.token !== token || current.type !== 'classical') return
        current.timer = undefined
        await this.advanceClassical(current)
      }).catch(error => this.failScheduledRuntime(runtime.target.contextId, token, error))
    ), delay)
  }

  private async advanceClassical(runtime: ActiveGuessGame) {
    const status = runtime.status as ClassicalGuessStatus
    const music = this.options.musics.get(status.musicId)
    if (!music) {
      await this.removeRuntime(runtime)
      return
    }
    if (status.phase === 'hints' && status.hintIndex < status.hints.length) {
      await runtime.reply(textReply(status.hints[status.hintIndex]))
      const next: ClassicalGuessStatus = {
        ...status,
        hintIndex: status.hintIndex + 1,
        nextAt: this.now().getTime() + CLASSICAL_HINT_COOLDOWN_MS,
      }
      await this.persist(runtime, next)
      this.scheduleClassical(runtime)
      return
    }
    if (status.phase === 'hints') {
      const image = await this.options.renderer.renderCrop({
        contextId: runtime.target.contextId,
        music,
        seed: status.seed,
      })
      await runtime.reply({
        type: 'image',
        text: '这首歌的封面部分如图，30 秒后将揭晓答案哦~',
        image,
      })
      const next: ClassicalGuessStatus = {
        ...status,
        phase: 'crop',
        nextAt: this.now().getTime() + CLASSICAL_REVEAL_DELAY_MS,
      }
      await this.persist(runtime, next)
      this.scheduleClassical(runtime)
      return
    }
    if (status.phase === 'crop') await this.finishClassical(runtime, '很遗憾，没有人猜中哦')
  }

  private async failScheduledRuntime(contextId: string, token: object, error: unknown) {
    const runtime = this.active.get(contextId)
    if (!runtime || runtime.token !== token) return
    this.logger.warn(`[mai-plugin] guess timer failed: ${String(error)}`)
    await this.removeRuntime(runtime)
  }

  private async persist(runtime: ActiveGuessGame, status: GuessGameStatus) {
    await this.options.repository.save({
      contextId: runtime.target.contextId,
      platform: runtime.target.platform,
      channelId: runtime.target.channelId,
      guildId: runtime.target.guildId,
      userId: runtime.target.userId,
      type: runtime.type,
      status,
    }, this.now())
    runtime.status = status
  }

  private clearRuntimeTimer(runtime: ActiveGuessGame) {
    if (runtime.timer === undefined) return
    this.timers.clearTimeout(runtime.timer)
    runtime.timer = undefined
  }

  private detachRuntime(runtime: ActiveGuessGame) {
    this.clearRuntimeTimer(runtime)
    runtime.token = {}
  }

  private async removeRuntime(runtime: ActiveGuessGame) {
    const current = this.active.get(runtime.target.contextId)
    if (current && current.token !== runtime.token) {
      this.detachRuntime(runtime)
      return
    }
    if (current) this.active.delete(runtime.target.contextId)
    this.detachRuntime(runtime)
    await this.options.repository.remove(runtime.target.contextId)
  }

  private async serialized<T>(contextId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operationTails.get(contextId) ?? Promise.resolve()
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = previous.then(() => pending)
    this.operationTails.set(contextId, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (this.operationTails.get(contextId) === tail) this.operationTails.delete(contextId)
    }
  }
}
