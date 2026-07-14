import type { Context } from 'koishi'
import { MusicDifficulty } from '../domain/enums'
import type { ChartInfo, MusicInfo, RecordEntry } from '../domain/music'
import type { RecordsResponse } from '../domain/player'
import { mapQueryError } from '../platform/fallback-message'
import { filterCharts, filterMusics, filterRecords } from '../query/combo-executor'
import { parseComboQuery } from '../query/combo-parser'
import type { ComboFilter } from '../query/filter-types'
import {
  commandAction,
  replyImage,
  replyText,
  SCORE_LIST_PAGE_SIZE,
  type ActiveCommandSession,
  type CoreCommandDependencies,
} from './support'

function querySession(session: ActiveCommandSession) {
  return {
    userId: session.userId,
    sessionId: `${session.platform}:${session.channelId}`,
    command: session.content,
    mentions: session.elements
      ?.filter(element => element.type === 'at')
      .map(element => ({
        userId: String(element.attrs.id ?? ''),
        qq: element.attrs.id ? String(element.attrs.id) : undefined,
        isBot: String(element.attrs.id ?? '') === session.selfId,
      })),
  }
}

async function commandFailure(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  error: unknown,
) {
  const mapped = mapQueryError(error, { isSelf: true })
  await replyText(session, dependencies, mapped.text)
}

function resultRecords(response: RecordsResponse, filters?: readonly ComboFilter[] | null) {
  return filters ? filterRecords(filters, response.records) ?? [] : [...response.records]
}

function ratingCounts(total: number) {
  const newCount = Math.min(15, total)
  return { newCount, oldCount: Math.max(0, total - newCount) }
}

function splitRatingRecords(records: readonly RecordEntry[], total: number) {
  const counts = ratingCounts(total)
  return {
    oldRecords: records.filter(record => !record.music.isNew).slice(0, counts.oldCount),
    newRecords: records.filter(record => record.music.isNew).slice(0, counts.newCount),
    ...counts,
  }
}

function chartKey(chart: ChartInfo) {
  return `${chart.music.id}:${chart.difficulty.value}`
}

function groupsFor(charts: readonly ChartInfo[]) {
  return MusicDifficulty.values
    .map(difficulty => ({
      label: difficulty.name,
      charts: charts.filter(chart => chart.difficulty === difficulty),
    }))
    .filter(group => group.charts.length)
}

function levelProgress(charts: readonly ChartInfo[], completed: ReadonlySet<string>) {
  return Object.fromEntries(MusicDifficulty.values.map(difficulty => {
    const selected = charts.filter(chart => chart.difficulty === difficulty)
    return [difficulty.name, {
      total: selected.length,
      completed: selected.filter(chart => completed.has(chartKey(chart))).length,
    }]
  }))
}

function filtersAndCharts(
  dependencies: CoreCommandDependencies,
  raw: string,
) {
  const filters = raw.trim() ? parseComboQuery(raw) : []
  if (!filters) return null
  return {
    filters,
    charts: filterCharts(filters, dependencies.data.musics.values()),
    musics: filterMusics(filters, dependencies.data.musics.values()),
  }
}

async function renderLevelTable(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  title: string,
  charts: readonly ChartInfo[],
  records?: readonly RecordEntry[],
  completed = new Set<string>(),
) {
  if (!charts.length) {
    await replyText(session, dependencies, '未找到符合条件的谱面。')
    return
  }
  const image = await dependencies.renderer.renderLevel({
    title,
    groups: groupsFor(charts),
    records,
    showProgress: records !== undefined,
    progress: records === undefined ? undefined : levelProgress(charts, completed),
  })
  await replyImage(session, dependencies, image)
}

async function songByAlias(
  dependencies: CoreCommandDependencies,
  raw: string,
) {
  return (await dependencies.aliasService.search(raw.trim()))[0]
}

export function registerImageCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  const commands = []

  commands.push(ctx.command('mai.rating <input:text>', '生成 B15/B25/B35/B40/B50 成绩图')
    .shortcut(/^\/mai\s+((?:.+?)?b(?:15|25|35|40|50)(?:\s+.*)?)$/i, { args: ['$1'] })
    .action(commandAction(async ({ session }, input) => {
      const match = input.match(/^(.*?)(?:b)(15|25|35|40|50)(?:\s+(.*))?$/i)
      if (!match) return
      const filterText = match[1].trim()
      const total = Number(match[2])
      const target = match[3]?.trim() ?? ''
      try {
        const user = await dependencies.queryService.getQueryParams(querySession(session), target)
        if (!filterText) {
          const { response, provider } = await dependencies.queryService.rating(user)
          const counts = ratingCounts(total)
          const image = await dependencies.renderer.renderRating({
            backend: provider.name,
            player: response.player,
            settings: response.settings,
            oldRecords: response.oldRatingList.slice(0, counts.oldCount),
            newRecords: response.newRatingList.slice(0, counts.newCount),
            ...counts,
          })
          await replyImage(session, dependencies, image)
          return
        }

        const selected = filtersAndCharts(dependencies, filterText)
        if (!selected?.musics.length) {
          await replyText(session, dependencies, '未找到符合条件的歌曲。')
          return
        }
        const { response, provider } = await dependencies.queryService.records(user, selected.musics)
        const records = resultRecords(response, selected.filters)
        if (!records.length) {
          await replyText(session, dependencies, '当前条件下没有成绩。')
          return
        }
        const split = splitRatingRecords(records, total)
        const image = await dependencies.renderer.renderRating({
          backend: provider.name,
          player: response.player,
          settings: response.settings,
          ...split,
        })
        await replyImage(session, dependencies, image)
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.score-list [filter:string] [page:posint]', '生成成绩列表')
    .shortcut(/^\/mai\s+(.*?)(?:分数列表|分数表|成绩列表|成绩表)(?:\s+(\d+))?$/, {
      args: ['$1', '$2'],
    })
    .action(commandAction(async ({ session }, filterText = '', pageText = '') => {
      const page = pageText ? Number(pageText) : 1
      if (!Number.isSafeInteger(page) || page < 1) {
        await replyText(session, dependencies, '请输入正确的页数。')
        return
      }
      try {
        const selected = filtersAndCharts(dependencies, filterText)
        if (!selected) {
          await replyText(session, dependencies, '未找到符合条件的歌曲。')
          return
        }
        const user = await dependencies.queryService.getQueryParams(querySession(session))
        const musics = selected.musics.length
          ? selected.musics
          : [...dependencies.data.musics.values()]
        const { response, provider } = await dependencies.queryService.records(user, musics)
        const records = resultRecords(response, selected.filters)
        if (!records.length) {
          await replyText(session, dependencies, '当前条件下没有成绩。')
          return
        }
        const totalPages = Math.max(1, Math.ceil(records.length / SCORE_LIST_PAGE_SIZE))
        const currentPage = Math.min(page, totalPages)
        const offset = (currentPage - 1) * SCORE_LIST_PAGE_SIZE
        const pageRecords = records.slice(offset, offset + SCORE_LIST_PAGE_SIZE)
        if (totalPages > 1) {
          for (const targetPage of [currentPage - 1, currentPage + 1]) {
            if (targetPage < 1 || targetPage > totalPages) continue
            dependencies.callbackRouter.registerPagination({
              payload: { mode: 'score-list', filter: filterText, page: targetPage },
              expectedUserId: session.userId,
              expectedChannelId: session.channelId,
              handler: payload => `${payload.page} / ${totalPages}`,
            })
          }
        }
        const split = splitRatingRecords(pageRecords, SCORE_LIST_PAGE_SIZE)
        const image = await dependencies.renderer.renderRating({
          backend: provider.name,
          player: response.player,
          settings: response.settings,
          ...split,
        })
        await replyImage(session, dependencies, image, `${currentPage} / ${totalPages}`)
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.level-table [filter:text]', '生成定数表')
    .shortcut(/^\/mai\s+(.*?)定数表$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, filterText = '') => {
      const selected = filtersAndCharts(dependencies, filterText)
      if (!selected) {
        await replyText(session, dependencies, '未找到符合条件的谱面。')
        return
      }
      try {
        await renderLevelTable(session, dependencies, `${filterText}定数表`, selected.charts)
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.complete-table [filter:text]', '生成完成表或进度表')
    .shortcut(/^\/mai\s+(?!.*未完成)(.*?)(?:完成表|进度表)$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, filterText = '') => {
      const selected = filtersAndCharts(dependencies, filterText)
      if (!selected?.charts.length) {
        await replyText(session, dependencies, '未找到符合条件的谱面。')
        return
      }
      try {
        const user = await dependencies.queryService.getQueryParams(querySession(session))
        const { response } = await dependencies.queryService.records(user, selected.musics)
        const matched = filterRecords(selected.filters, response.records, true)
          ?? response.records.filter(record => record.achievement >= 800_000)
        const completed = new Set(matched.map(record => chartKey(record.chart)))
        await renderLevelTable(
          session,
          dependencies,
          `${filterText}完成表`,
          selected.charts,
          response.records,
          completed,
        )
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.incomplete-table [filter:text]', '生成未完成表')
    .shortcut(/^\/mai\s+(.*?)(?:未完成表|未完成列表)$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, filterText = '') => {
      const selected = filtersAndCharts(dependencies, filterText)
      if (!selected?.charts.length) {
        await replyText(session, dependencies, '未找到符合条件的谱面。')
        return
      }
      try {
        const user = await dependencies.queryService.getQueryParams(querySession(session))
        const { response } = await dependencies.queryService.records(user, selected.musics)
        const matched = filterRecords(selected.filters, response.records, true)
          ?? response.records.filter(record => record.achievement >= 800_000)
        const completed = new Set(matched.map(record => chartKey(record.chart)))
        const remains = selected.charts.filter(chart => !completed.has(chartKey(chart)))
        if (!remains.length) {
          await replyText(session, dependencies, '恭喜您已完成所有谱面！')
          return
        }
        await renderLevelTable(
          session,
          dependencies,
          `${filterText}未完成表`,
          remains,
          response.records,
          completed,
        )
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.song-score <query:text>', '生成单曲成绩图')
    .option('difficulty', '-d <difficulty:string> 只显示指定难度')
    .shortcut(/^\/mai\s+(?:info|minfo)\s+(.+)$/i, { args: ['$1'] })
    .shortcut(/^\/mai\s+(绿谱?|黄谱?|红谱?|紫谱?|白谱?)成绩\s+(.+)$/, {
      args: ['$2'],
      options: { difficulty: '$1' },
    })
    .action(commandAction(async ({ session, options }, query) => {
      const music = await songByAlias(dependencies, query)
      if (!music) {
        await replyText(session, dependencies, '未找到该歌曲。')
        return
      }
      try {
        const user = await dependencies.queryService.getQueryParams(querySession(session))
        const { response } = await dependencies.queryService.record(user, music)
        const difficulty = options.difficulty
          ? MusicDifficulty.from(options.difficulty.replace('谱', ''))
          : undefined
        const records = difficulty
          ? response.filter(record => record.chart.difficulty === difficulty)
          : response
        const image = await dependencies.renderer.renderScore({ music, records })
        await replyImage(session, dependencies, image)
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.course <name:text>', '生成段位表')
    .shortcut(/^\/mai\s+段位表(?:\s+(.+))?$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, name = '') => {
      const normalized = name.trim().toLocaleLowerCase()
      const course = [...dependencies.data.courses.values()].find(entry => (
        entry.name.trim().toLocaleLowerCase() === normalized
        || String(entry.id) === normalized
      ))
      if (!course) {
        await replyText(session, dependencies, '未找到该段位。')
        return
      }
      try {
        const charts = course.random
          ? [...dependencies.data.musics.values()].flatMap(music => music.charts)
            .filter(chart => chart.levelValue >= course.lower && chart.levelValue <= course.upper)
            .slice(0, 4)
          : course.musics.map(entry => dependencies.data.musics.get(entry.id)?.charts.find(
            chart => chart.difficulty.value === entry.difficulty,
          )).filter((chart): chart is ChartInfo => Boolean(chart))
        const musics = [...new Set(charts.map(chart => chart.music))]
        const user = await dependencies.queryService.getQueryParams(querySession(session))
        const { response } = await dependencies.queryService.records(user, musics)
        const image = await dependencies.renderer.renderCourse({
          course,
          songs: charts.map(chart => ({
            chart,
            record: response.records.find(record => chartKey(record.chart) === chartKey(chart)),
          })),
        })
        await replyImage(session, dependencies, image)
      } catch (error) {
        await commandFailure(session, dependencies, error)
      }
    })))

  return commands
}
