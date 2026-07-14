import type { Context } from 'koishi'
import { MusicDifficulty } from '../domain/enums'
import type { ChartInfo, RecordEntry } from '../domain/music'
import { mapQueryError } from '../platform/fallback-message'
import { filterCharts, filterMusics, filterRecords } from '../query/combo-executor'
import { parseComboQuery } from '../query/combo-parser'
import {
  commandAction,
  replyText,
  type ActiveCommandSession,
  type CoreCommandDependencies,
} from './support'

function querySession(session: ActiveCommandSession) {
  return {
    userId: session.userId,
    sessionId: `${session.platform}:${session.channelId}`,
    command: session.content,
  }
}

function chartKey(chart: ChartInfo) {
  return `${chart.music.id}:${chart.difficulty.value}`
}

function defaultCompleted(records: readonly RecordEntry[]) {
  return records.filter(record => record.achievement >= 800_000)
}

export function registerRecordCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  return [ctx.command('mai.progress <filter:string> [target:text]', '查询文字进度')
    .shortcut(/^\/mai\s+(.+?)进度(?:\s+(.*))?$/, { args: ['$1', '$2'] })
    .action(commandAction(async ({ session }, filterText, target = '') => {
      const filters = parseComboQuery(filterText)
      if (!filters) {
        await replyText(session, dependencies, '未找到有效的进度条件。')
        return
      }
      const charts = filterCharts(filters, dependencies.data.musics.values())
      const musics = filterMusics(filters, dependencies.data.musics.values())
      if (!charts.length || !musics.length) {
        await replyText(session, dependencies, '未找到符合条件的谱面。')
        return
      }
      try {
        const user = await dependencies.queryService.getQueryParams(querySession(session), target)
        const { response } = await dependencies.queryService.records(user, musics)
        const matched = filterRecords(filters, response.records, true)
          ?? defaultCompleted(response.records)
        const completed = new Set(matched.map(record => chartKey(record.chart)))
        if (charts.every(chart => completed.has(chartKey(chart)))) {
          await replyText(session, dependencies, `您已经达成了${filterText}的条件。`)
          return
        }

        const lines = MusicDifficulty.values.flatMap(difficulty => {
          const total = charts.filter(chart => chart.difficulty === difficulty).length
          const done = charts.filter(chart => (
            chart.difficulty === difficulty && completed.has(chartKey(chart))
          )).length
          return total > done ? [`${difficulty.brief}谱剩余 ${total - done} 个（共 ${total} 个）`] : []
        })
        const totalRemaining = charts.filter(chart => !completed.has(chartKey(chart))).length
        await replyText(
          session,
          dependencies,
          `您的${filterText}进度如下：\n${lines.join('\n')}\n总计 ${totalRemaining} 个`,
        )
      } catch (error) {
        const mapped = mapQueryError(error, { isSelf: true })
        await replyText(session, dependencies, mapped.text)
      }
    }))]
}
