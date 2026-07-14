import type { Command, Context } from 'koishi'
import { Worker } from 'node:worker_threads'
import { MusicDifficulty } from '../domain/enums'
import type { ChartInfo, MusicInfo } from '../domain/music'
import { isAdministrator } from '../platform/admin'
import {
  createPagedCallbackButtons,
  createQqKeyboard,
  createQqNativeMarkdown,
} from '../platform/qq-message'
import { filterCharts, filterMusics } from '../query/combo-executor'
import { parseComboQuery } from '../query/combo-parser'
import { Semaphore } from '../utils/semaphore'
import {
  MAX_USER_REGEX_LENGTH,
  commandAction,
  replyAudio,
  replyText,
  SEARCH_PAGE_SIZE,
  SEARCH_TOO_MANY,
  type ActiveCommandSession,
  type CoreCommandDependencies,
} from './support'

const NOT_FOUND = '未找到相关歌曲。'
const LEVEL_USAGE = '用法：定数查歌 <定数或范围> [页数]'
const FIT_LEVEL_USAGE = '用法：拟合定数查歌 <定数或范围> [页数]'
const USER_REGEX_TIMEOUT_MS = 100
const USER_REGEX_STARTUP_TIMEOUT_MS = 1_000
const userRegexWorkerSemaphore = new Semaphore(2, 4)

export const REGEX_WORKER_BUSY_MESSAGE = '正则搜索繁忙，请稍后重试。'

const difficultyTokens = [
  '绿谱', '绿', '黄谱', '黄', '红谱', '红', '紫谱', '紫', '白谱', '白',
  'Basic', 'Advanced', 'Expert', 'Master', 'ReMaster',
] as const

const directIdPattern = /^\/mai\s+id(\d+)$/i
const difficultyIdPattern = new RegExp(
  `^/mai\\s+(${difficultyTokens.join('|')})\\s*id(\\d+)$`,
  'i',
)

type MusicSearchResult = MusicInfo | ChartInfo

function resolveDifficulty(token: string | undefined) {
  if (!token) return undefined
  const normalized = token.toLocaleLowerCase()
  return MusicDifficulty.values.find(difficulty => (
    difficulty.name.toLocaleLowerCase() === normalized
    || difficulty.names.some(name => name === token)
  ))
}

function isChart(result: MusicSearchResult): result is ChartInfo {
  return 'music' in result && 'difficulty' in result
}

function formatMusic(music: MusicInfo, chart?: ChartInfo) {
  if (!chart) {
    return `${music.id}. ${music.name}\n曲师：${music.artist}\nBPM：${music.bpm}`
  }
  return `[${chart.difficulty.brief}] ${music.id}. ${music.name}\n定数：${chart.levelValue.toFixed(1)}\n谱师：${chart.notesDesigner}`
}

function resultLine(result: MusicSearchResult) {
  if (isChart(result)) {
    return `${result.difficulty.brief}${result.music.id}. ${result.music.name}`
  }
  return `${result.id}. ${result.name}`
}

function pageText(results: readonly MusicSearchResult[], page: number) {
  const totalPages = Math.max(1, Math.ceil(results.length / SEARCH_PAGE_SIZE))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const start = (currentPage - 1) * SEARCH_PAGE_SIZE
  const lines = results.slice(start, start + SEARCH_PAGE_SIZE).map(resultLine)
  return {
    currentPage,
    totalPages,
    text: `${currentPage} / ${totalPages}\n${lines.join('\n')}`,
  }
}

function createSearchPage(
  dependencies: CoreCommandDependencies,
  results: readonly MusicSearchResult[],
  query: string,
  page: number,
  scope: { userId: string, channelId: string },
) {
  const view = pageText(results, page)
  const callbackData = (targetPage: number) => dependencies.callbackRouter.registerPagination({
    payload: { mode: 'search', query, page: targetPage },
    expectedUserId: scope.userId,
    expectedChannelId: scope.channelId,
    handler: payload => createSearchPage(
      dependencies,
      results,
      payload.query,
      payload.page,
      scope,
    ).rich,
  })
  const row = createPagedCallbackButtons({
    page: view.currentPage,
    totalPages: view.totalPages,
    callbackData,
  })
  return {
    ...view,
    rich: createQqNativeMarkdown(
      view.text,
      row.buttons.length ? createQqKeyboard([row]) : undefined,
    ),
  }
}

async function showResults(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  results: readonly MusicSearchResult[],
  query: string,
  page = 1,
) {
  if (!results.length) {
    await replyText(session, dependencies, NOT_FOUND)
    return
  }
  if (results.length > SEARCH_TOO_MANY) {
    await replyText(session, dependencies, '在当前条件下查询到的曲目过多，请缩小范围。')
    return
  }
  if (results.length === 1) {
    const result = results[0]
    await replyText(
      session,
      dependencies,
      isChart(result) ? formatMusic(result.music, result) : formatMusic(result),
    )
    return
  }

  const view = createSearchPage(
    dependencies,
    results,
    query,
    page,
    { userId: session.userId, channelId: session.channelId },
  )
  await replyText(session, dependencies, view.text, view.rich)
}

function parseLevelRange(raw: string) {
  const match = raw.trim().match(
    /^(\d+(?:\.\d+)?)(?:\s*(?:-|~|至)\s*(\d+(?:\.\d+)?))?(?:\s+(\d+))?$/,
  )
  if (!match) return null
  const first = Number(match[1])
  const second = Number(match[2] ?? match[1])
  const page = Number(match[3] ?? 1)
  if (![first, second, page].every(Number.isFinite) || page < 1 || !Number.isInteger(page)) {
    return null
  }
  return { begin: Math.min(first, second), end: Math.max(first, second), page }
}

function regexRiskReason(source: string) {
  if (source.length > MAX_USER_REGEX_LENGTH) return '正则表达式过长。'
  if (/\\[1-9]|\(\?(?:[=!]|<[=!])/.test(source)) return '正则表达式不安全。'
  if (/\((?:[^()]|\\.)*(?:[+*{]|\|)(?:[^()]|\\.)*\)[+*{]/.test(source)) {
    return '正则表达式不安全。'
  }
  if (/\.\*(?:[^\n]{0,16})\.\*/.test(source)) return '正则表达式不安全。'
  return null
}

type UserRegexValidation = { source: string } | { error: string }

function validateUserRegex(source: string): UserRegexValidation {
  const risk = regexRiskReason(source)
  if (risk) return { error: risk }
  try {
    new RegExp(source, 'iu')
    return { source }
  } catch {
    return { error: '请输入正确的正则表达式。' }
  }
}

type WorkerRegexResult = { matches: number[] } | { error: 'busy' | 'malformed' | 'timeout' }

const regexWorkerSource = `
const { parentPort, workerData } = require('node:worker_threads')
try {
  const regex = new RegExp(workerData.source, 'iu')
  const matches = []
  for (let index = 0; index < workerData.values.length; index++) {
    if (regex.test(workerData.values[index])) matches.push(index)
  }
  parentPort.postMessage({ matches })
} catch {
  parentPort.postMessage({ error: 'malformed' })
}
`

function executeUserRegex(
  source: string,
  values: readonly string[],
  semaphore: Semaphore,
): Promise<WorkerRegexResult> {
  return semaphore.acquire().then(async (release) => {
    try {
      return await new Promise<WorkerRegexResult>((resolve) => {
        const worker = new Worker(regexWorkerSource, {
          eval: true,
          workerData: { source, values },
        })
        let settled = false
        let timeout: ReturnType<typeof setTimeout>
        const finish = (result: WorkerRegexResult) => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(result)
        }
        const terminateAsTimeout = () => {
          if (settled) return
          settled = true
          void worker.terminate().finally(() => resolve({ error: 'timeout' }))
        }
        timeout = setTimeout(terminateAsTimeout, USER_REGEX_STARTUP_TIMEOUT_MS)
        worker.once('online', () => {
          if (settled) return
          clearTimeout(timeout)
          timeout = setTimeout(terminateAsTimeout, USER_REGEX_TIMEOUT_MS)
        })
        worker.once('message', (result: WorkerRegexResult) => finish(result))
        worker.once('error', () => finish({ error: 'malformed' }))
        worker.once('exit', (code) => {
          if (code !== 0) finish({ error: 'malformed' })
        })
      })
    } finally {
      release()
    }
  }, () => ({ error: 'busy' }))
}

function seededValue(input: string) {
  let state = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    state ^= input.charCodeAt(index)
    state = Math.imul(state, 0x01000193)
  }
  state += 0x6d2b79f5
  let value = state
  value = Math.imul(value ^ value >>> 15, value | 1)
  value ^= value + Math.imul(value ^ value >>> 7, value | 61)
  return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
}

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

async function selectSingleMusic(
  dependencies: CoreCommandDependencies,
  query: string,
) {
  return (await dependencies.aliasService.search(query.trim()))[0]
}

function registerTextShortcut(
  ctx: Context,
  definition: string,
  description: string,
  pattern: RegExp,
  action: (session: ActiveCommandSession, raw: string) => Promise<void>,
  config?: Command.Config,
) {
  return ctx.command(definition, description, config)
    .shortcut(pattern, { args: ['$1'] })
    .action(commandAction(async ({ session }, raw = '') => {
      await action(session, raw)
    }))
}

export function registerMusicCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  const commands = []

  commands.push(ctx.command('mai.id <id:posint>', '按曲目 ID 查询舞萌歌曲')
    .option('difficulty', '-d <difficulty:string> 指定谱面难度')
    .shortcut(directIdPattern, { args: ['$1'] })
    .shortcut(difficultyIdPattern, {
      args: ['$2'],
      options: { difficulty: '$1' },
    })
    .action(commandAction(async ({ session, options }, id) => {
      const music = dependencies.data.musics.get(id)
      if (!music) {
        await replyText(session, dependencies, '未找到该歌曲。')
        return
      }
      const difficulty = resolveDifficulty(options.difficulty)
      if (options.difficulty && !difficulty) {
        await replyText(session, dependencies, '未找到该歌曲或难度。')
        return
      }
      const chart = difficulty
        ? music.charts.find(entry => entry.difficulty === difficulty)
        : undefined
      await replyText(
        session,
        dependencies,
        difficulty && !chart ? '未找到该歌曲或难度。' : formatMusic(music, chart),
      )
    })))

  commands.push(registerTextShortcut(
    ctx,
    'mai.random [query:text]',
    '按随心配条件随机歌曲',
    /^\/mai\s+随个(?:\s+(.*))?$/,
    async (session, raw) => {
      const filters = raw.trim() ? parseComboQuery(raw) : []
      const musics = raw.trim()
        ? filters ? filterMusics(filters, dependencies.data.musics.values()) : []
        : [...dependencies.data.musics.values()]
      if (!musics.length) {
        await replyText(session, dependencies, NOT_FOUND)
        return
      }
      const random = dependencies.random?.() ?? Math.random()
      const index = Math.min(musics.length - 1, Math.floor(Math.max(0, random) * musics.length))
      await replyText(session, dependencies, formatMusic(musics[index]))
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.search <query:text>',
    '按曲名或别名查歌',
    /^\/mai\s+查歌(?:\s+(.*))?$/,
    async (session, raw) => {
      const results = raw.trim() ? await dependencies.aliasService.search(raw) : []
      await showResults(session, dependencies, results, raw)
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.level-search <range:text>',
    '按谱面定数查歌',
    /^\/mai\s+定数查歌(?:\s+(.*))?$/,
    async (session, raw) => {
      const range = parseLevelRange(raw)
      if (!range) {
        await replyText(session, dependencies, LEVEL_USAGE)
        return
      }
      const charts = [...dependencies.data.musics.values()].flatMap(music => music.charts)
        .filter(chart => chart.difficulty !== MusicDifficulty.Utage)
        .filter(chart => chart.levelValue >= range.begin && chart.levelValue <= range.end)
      await showResults(session, dependencies, charts, raw, range.page)
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.fit-level-search <range:text>',
    '按拟合定数查歌',
    /^\/mai\s+拟合定数查歌(?:\s+(.*))?$/,
    async (session, raw) => {
      const range = parseLevelRange(raw)
      if (!range) {
        await replyText(session, dependencies, FIT_LEVEL_USAGE)
        return
      }
      const charts = [...dependencies.data.musics.values()].flatMap(music => music.charts)
        .filter(chart => chart.difficulty !== MusicDifficulty.Utage)
        .filter(chart => chart.fitLevelValue >= range.begin && chart.fitLevelValue <= range.end)
      await showResults(session, dependencies, charts, raw, range.page)
    },
  ))

  const propertySearches = [
    {
      definition: 'mai.designer-search <query:text>',
      description: '按谱师查歌',
      pattern: /^\/mai\s+谱师查歌(?:\s+(.*))?$/,
      search: (query: string) => [...dependencies.data.musics.values()].flatMap(music => music.charts)
        .filter(chart => chart.notesDesigner.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    },
    {
      definition: 'mai.version-search <query:text>',
      description: '按版本查歌',
      pattern: /^\/mai\s+版本查歌(?:\s+(.*))?$/,
      search: (query: string) => [...dependencies.data.musics.values()]
        .filter(music => music.version.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    },
    {
      definition: 'mai.artist-search <query:text>',
      description: '按曲师查歌',
      pattern: /^\/mai\s+曲师查歌(?:\s+(.*))?$/,
      search: (query: string) => [...dependencies.data.musics.values()]
        .filter(music => music.artist.toLocaleLowerCase().includes(query.toLocaleLowerCase())),
    },
  ] as const
  for (const search of propertySearches) {
    commands.push(registerTextShortcut(
      ctx,
      search.definition,
      search.description,
      search.pattern,
      async (session, raw) => {
        const query = raw.trim()
        await showResults(session, dependencies, query ? search.search(query) : [], query)
      },
    ))
  }

  commands.push(registerTextShortcut(
    ctx,
    'mai.regex-search <pattern:text>',
    '按安全正则表达式查歌',
    /^\/mai\s+正则查歌(?:\s+(.*))?$/,
    async (session, raw) => {
      const validated = validateUserRegex(raw.trim())
      if ('error' in validated) {
        await replyText(session, dependencies, validated.error)
        return
      }
      const musics = [...dependencies.data.musics.values()]
      const execution = await executeUserRegex(
        validated.source,
        musics.map(music => music.name.slice(0, 256)),
        dependencies.regexWorkerSemaphore ?? userRegexWorkerSemaphore,
      )
      if ('error' in execution) {
        await replyText(
          session,
          dependencies,
          execution.error === 'busy'
            ? REGEX_WORKER_BUSY_MESSAGE
            : execution.error === 'timeout'
              ? '正则表达式执行超时。'
              : '请输入正确的正则表达式。',
        )
        return
      }
      const results = execution.matches.map(index => musics[index])
      await showResults(session, dependencies, results, raw)
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.bpm-search <query:text>',
    '按 BPM 查歌',
    /^\/mai\s+(?:BPM|bpm)查歌(?:\s+(.*))?$/,
    async (session, raw) => {
      const [bpmText, pageText] = raw.trim().split(/\s+/, 2)
      const bpm = Number(bpmText)
      const page = pageText === undefined ? 1 : Number(pageText)
      if (!Number.isSafeInteger(bpm) || bpm <= 0 || !Number.isSafeInteger(page) || page < 1) {
        await replyText(session, dependencies, '请输入正确的 BPM 值和页数。')
        return
      }
      const results = [...dependencies.data.musics.values()].filter(music => music.bpm === bpm)
      await showResults(session, dependencies, results, raw, page)
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.combo-search <query:text>',
    '按随心配组合条件查歌',
    /^\/mai\s+搜索(?:\s+(.*))?$/,
    async (session, raw) => {
      const filters = parseComboQuery(raw)
      const results = filters ? (
        filters.some(filter => filter.singleChart)
          ? filterCharts(filters, dependencies.data.musics.values())
          : filterMusics(filters, dependencies.data.musics.values())
      ) : []
      await showResults(session, dependencies, results, raw)
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.alias-add <input:text>',
    '添加或投票歌曲别名',
    /^\/mai\s+添加别名(?:\s+(.*))?$/,
    async (session, raw) => {
      const [query, ...aliasParts] = raw.trim().split(/\s+/)
      const alias = aliasParts.join(' ').trim()
      if (!query || !alias) {
        await replyText(session, dependencies, '用法：添加别名 <曲目> <别名>')
        return
      }
      if (alias.length >= 32) {
        await replyText(session, dependencies, '别名过长。')
        return
      }
      const music = await selectSingleMusic(dependencies, query)
      if (!music) {
        await replyText(session, dependencies, '未找到该歌曲。')
        return
      }
      const subject = {
        userId: session.userId,
        authority: (session.user as { authority?: number } | undefined)?.authority,
        roles: session.event.member?.roles?.map(role => role.id),
      }
      if (isAdministrator(subject, { administrators: dependencies.administrators })) {
        await dependencies.aliasService.add(music.id, alias)
        await replyText(session, dependencies, '别名添加成功。')
      } else {
        const voted = await dependencies.aliasService.vote(music.id, alias, session.userId)
        await replyText(session, dependencies, voted ? '别名投票成功。' : '您已经投过票了。')
      }
    },
  ))

  commands.push(registerTextShortcut(
    ctx,
    'mai.alias-remove <input:text>',
    '删除歌曲别名（管理员）',
    /^\/mai\s+删除别名(?:\s+(.*))?$/,
    async (session, raw) => {
      const [query, ...aliasParts] = raw.trim().split(/\s+/)
      const alias = aliasParts.join(' ').trim()
      if (!query || !alias) {
        await replyText(session, dependencies, '用法：删除别名 <曲目> <别名>')
        return
      }
      const subject = {
        userId: session.userId,
        authority: (session.user as { authority?: number } | undefined)?.authority,
        roles: session.event.member?.roles?.map(role => role.id),
      }
      if (!isAdministrator(subject, { administrators: dependencies.administrators })) {
        await replyText(session, dependencies, '权限不足。')
        return
      }
      const music = await selectSingleMusic(dependencies, query)
      if (!music) {
        await replyText(session, dependencies, '未找到该歌曲。')
        return
      }
      await dependencies.aliasService.remove(music.id, alias)
      await replyText(session, dependencies, '别名删除成功。')
    },
    { authority: 4, permissions: ['authority:0'] },
  ))

  commands.push(ctx.command('mai.daily', '生成稳定的今日舞萌推荐')
    .shortcut(/^\/mai\s+今日舞萌$/)
    .action(commandAction(async ({ session }) => {
      const musics = [...dependencies.data.musics.values()]
      if (!musics.length) {
        await replyText(session, dependencies, '本地曲目数据为空，暂无可推荐歌曲。')
        return
      }
      const now = dependencies.now?.() ?? new Date()
      const date = localDateKey(now)
      const seed = seededValue(`${session.userId}:${date}`)
      const music = musics[Math.min(musics.length - 1, Math.floor(seed * musics.length))]
      const luck = Math.floor(seededValue(`${session.userId}:${date}:luck`) * 100) + 1
      await replyText(
        session,
        dependencies,
        `${date}\n今日幸运指数：${luck}\n今日推荐歌曲：\n${formatMusic(music)}`,
      )
    })))

  commands.push(registerTextShortcut(
    ctx,
    'mai.preview <query:text>',
    '发送本地歌曲预览',
    /^\/mai\s+预览(?:\s+(.*))?$/,
    async (session, raw) => {
      const music = raw.trim() ? await selectSingleMusic(dependencies, raw) : undefined
      if (!music) {
        await replyText(session, dependencies, '未找到该歌曲。')
        return
      }
      const audio = await dependencies.previewAudio?.(music)
      if (!audio || audio.byteLength === 0) {
        await replyText(session, dependencies, '该歌曲的本地预览不可用。')
        return
      }
      await replyAudio(session, audio)
    },
  ))

  return commands
}
