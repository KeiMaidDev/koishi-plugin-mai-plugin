import type { Context } from 'koishi'
import { MusicDifficulty } from '../domain/enums'
import { commandAction, replyText, type CoreCommandDependencies } from './support'

const SCORE_LINE_USAGE = '用法：分数线 <难度+曲目 ID/名称/别名> <目标达成率>'

const difficultyPrefixes = [
  ['ReMaster', MusicDifficulty.ReMaster],
  ['Advanced', MusicDifficulty.Advanced],
  ['Expert', MusicDifficulty.Expert],
  ['Master', MusicDifficulty.Master],
  ['Basic', MusicDifficulty.Basic],
  ['白谱', MusicDifficulty.ReMaster], ['白', MusicDifficulty.ReMaster],
  ['紫谱', MusicDifficulty.Master], ['紫', MusicDifficulty.Master],
  ['红谱', MusicDifficulty.Expert], ['红', MusicDifficulty.Expert],
  ['黄谱', MusicDifficulty.Advanced], ['黄', MusicDifficulty.Advanced],
  ['绿谱', MusicDifficulty.Basic], ['绿', MusicDifficulty.Basic],
] as const

type ScoreLineInput = {
  difficulty: MusicDifficulty
  musicQuery: string
  target: number
}

type ScoreLineParseResult = ScoreLineInput | { error: string } | null

function parseScoreLine(raw: string): ScoreLineParseResult {
  const match = raw.trim().match(/^(.+?)\s+(\d+(?:\.\d+)?)$/)
  if (!match) return null
  const chartQuery = match[1].trim()
  const target = Number(match[2])
  if (!Number.isFinite(target) || target < 0 || target > 101) return null
  const difficulty = difficultyPrefixes.find(([prefix]) => (
    chartQuery.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())
  ))
  if (!difficulty) return { error: '请指定绿、黄、红、紫或白谱难度。' }
  const musicQuery = chartQuery.slice(difficulty[0].length).trim()
  if (!musicQuery) return null
  return { difficulty: difficulty[1], musicQuery, target }
}

export function registerCalcCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  return [ctx.command('mai.score-line <input:text>', '计算目标达成率允许的失分')
    .shortcut(/^\/mai\s+分数线(?:\s+(.*))?$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, raw = '') => {
      const parsed = parseScoreLine(raw)
      if (!parsed) {
        await replyText(session, dependencies, SCORE_LINE_USAGE)
        return
      }
      if ('error' in parsed) {
        await replyText(session, dependencies, parsed.error)
        return
      }
      const music = (await dependencies.aliasService.search(parsed.musicQuery))[0]
      const chart = music?.charts.find(entry => entry.difficulty === parsed.difficulty)
      if (!music || !chart) {
        await replyText(session, dependencies, '未找到该歌曲或难度。')
        return
      }

      const notes = chart.notes
      const totalScore = notes.tap * 500
        + notes.hold * 1_000
        + notes.slide * 1_500
        + notes.touch * 500
        + notes.break * 2_500
      if (totalScore <= 0) {
        await replyText(session, dependencies, '该谱面没有可用于计算的物量数据。')
        return
      }
      const reduce = 101 - parsed.target
      const allowedGreat = totalScore * reduce / 10_000
      const perGreat = 10_000 / totalScore
      const break50Reduce = notes.break
        ? totalScore * (0.01 / notes.break) / 4
        : 0
      const breakEquivalent = break50Reduce / 100
      const breakPercent = break50Reduce / totalScore * 100
      await replyText(session, dependencies, [
        `[${chart.difficulty.brief}] ${music.id}. ${music.name}`,
        `分数线 ${parsed.target}% 允许的最大 TAP GREAT 数量为 ${allowedGreat.toFixed(2)}`,
        `每个 TAP GREAT 约降低 ${perGreat.toFixed(4)}%`,
        `BREAK 50 落等价于 ${breakEquivalent.toFixed(3)} 个 TAP GREAT（-${breakPercent.toFixed(4)}%）`,
      ].join('\n'))
    }))]
}
