import type { Command, Context, Middleware } from 'koishi'
import { registerCalcCommands } from './calc'
import { registerHelpCommand } from './help'
import { registerImageCommands } from './image'
import { registerMusicCommands } from './music'
import { registerRecordCommands } from './record'
import { registerSettingsCommands } from './settings'
import type { CoreCommandDependencies } from './support'

export type { CoreCommandDependencies } from './support'

const compatibilityPatterns = [
  /^mai$/i,
  /^id\d+$/i,
  /^(?:绿谱?|黄谱?|红谱?|紫谱?|白谱?|Basic|Advanced|Expert|Master|ReMaster)id\d+$/i,
  /^随个(?:\s+.*)?$/,
  /^查歌(?:\s+.*)?$/,
  /^定数查歌(?:\s+.*)?$/,
  /^拟合定数查歌(?:\s+.*)?$/,
  /^谱师查歌(?:\s+.*)?$/,
  /^版本查歌(?:\s+.*)?$/,
  /^曲师查歌(?:\s+.*)?$/,
  /^正则查歌(?:\s+.*)?$/,
  /^(?:BPM|bpm)查歌(?:\s+.*)?$/,
  /^搜索(?:\s+.*)?$/,
  /^添加别名(?:\s+.*)?$/,
  /^删除别名(?:\s+.*)?$/,
  /^今日舞萌$/,
  /^预览(?:\s+.*)?$/,
  /^(?:.*?)b(?:15|25|35|40|50)(?:\s+.*)?$/i,
  /^(?:.*?)(?:分数列表|分数表|成绩列表|成绩表)(?:\s+\d+)?$/,
  /^(?:.*?)定数表$/,
  /^(?:.*?)(?:完成表|进度表|未完成表|未完成列表)$/,
  /^(?:info|minfo)\s+.+$/i,
  /^(?:绿谱?|黄谱?|红谱?|紫谱?|白谱?)成绩\s+.+$/,
  /^段位表(?:\s+.*)?$/,
  /^.+?进度(?:\s+.*)?$/,
  /^分数线(?:\s+.*)?$/,
  /^(?:bind|绑定)(?:\s+.*)?$/i,
  /^设置查分器(?:\s+.*)?$/,
  /^(?:设置水鱼|水鱼|设置落雪|落雪)$/,
  /^(?:兼容模式(?:\s+.*)?|取消兼容模式|关闭兼容模式|禁用兼容模式|打开兼容模式|启用兼容模式)$/,
  /^设置头像(?:\s+.*)?$/,
  /^(?:设置牌子|设置姓名框)(?:\s+.*)?$/,
  /^设置(?:mai|b50)$/i,
  /^(?:默认|设为默认)$/,
] as const

export function isExactCompatibilityCommand(content: string) {
  const normalized = content.trim()
  return compatibilityPatterns.some(pattern => pattern.test(normalized))
}

function commandArgument(value: string) {
  return value.trim()
}

export function resolveCompatibilityExecution(content: string) {
  const normalized = content.trim()
  let match: RegExpMatchArray | null
  if (/^mai$/i.test(normalized)) return 'mai'
  if ((match = normalized.match(/^id(\d+)$/i))) return `mai.id ${match[1]}`
  if ((match = normalized.match(/^(绿谱?|黄谱?|红谱?|紫谱?|白谱?|Basic|Advanced|Expert|Master|ReMaster)id(\d+)$/i))) {
    return `mai.id ${match[2]} --difficulty ${commandArgument(match[1])}`
  }
  const textCommands: Array<[RegExp, string]> = [
    [/^随个(?:\s+(.*))?$/, 'mai.random'],
    [/^查歌(?:\s+(.*))?$/, 'mai.search'],
    [/^定数查歌(?:\s+(.*))?$/, 'mai.level-search'],
    [/^拟合定数查歌(?:\s+(.*))?$/, 'mai.fit-level-search'],
    [/^谱师查歌(?:\s+(.*))?$/, 'mai.designer-search'],
    [/^版本查歌(?:\s+(.*))?$/, 'mai.version-search'],
    [/^曲师查歌(?:\s+(.*))?$/, 'mai.artist-search'],
    [/^正则查歌(?:\s+(.*))?$/, 'mai.regex-search'],
    [/^(?:BPM|bpm)查歌(?:\s+(.*))?$/, 'mai.bpm-search'],
    [/^搜索(?:\s+(.*))?$/, 'mai.combo-search'],
    [/^添加别名(?:\s+(.*))?$/, 'mai.alias-add'],
    [/^删除别名(?:\s+(.*))?$/, 'mai.alias-remove'],
    [/^预览(?:\s+(.*))?$/, 'mai.preview'],
    [/^分数线(?:\s+(.*))?$/, 'mai.score-line'],
    [/^(?:bind|绑定)(?:\s+(.*))?$/i, 'mai.bind'],
    [/^设置查分器(?:\s+(.*))?$/, 'mai.provider'],
    [/^设置头像(?:\s+(.*))?$/, 'mai.avatar'],
    [/^(?:设置牌子|设置姓名框)(?:\s+(.*))?$/, 'mai.plate'],
  ]
  for (const [pattern, command] of textCommands) {
    match = normalized.match(pattern)
    if (match) return `${command} ${commandArgument(match[1] ?? '')}`
  }
  if (/^今日舞萌$/.test(normalized)) return 'mai.daily'
  if (/^(?:设置水鱼|水鱼)$/.test(normalized)) return 'mai.provider diving-fish'
  if (/^(?:设置落雪|落雪)$/.test(normalized)) return 'mai.provider lxns'
  if (/^(?:设置mai|设置b50)$/i.test(normalized)) return 'mai.settings'
  if (/^(?:默认|设为默认)$/.test(normalized)) return 'mai.default'
  if (/^(?:兼容模式(?:\s+.*)?|取消兼容模式|关闭兼容模式|禁用兼容模式|打开兼容模式|启用兼容模式)$/.test(normalized)) {
    return `mai.compatibility ${commandArgument(normalized)}`
  }
  if (/^(?:.*?)b(?:15|25|35|40|50)(?:\s+.*)?$/i.test(normalized)) {
    return `mai.rating ${commandArgument(normalized)}`
  }
  if ((match = normalized.match(/^(.*?)(?:分数列表|分数表|成绩列表|成绩表)(?:\s+(\d+))?$/))) {
    return `mai.score-list ${JSON.stringify(commandArgument(match[1]))} ${match[2] ?? 1}`
  }
  if ((match = normalized.match(/^(.*?)定数表$/))) {
    return `mai.level-table ${commandArgument(match[1])}`
  }
  if ((match = normalized.match(/^(?!.*未完成)(.*?)(?:完成表|进度表)$/))) {
    return `mai.complete-table ${commandArgument(match[1])}`
  }
  if ((match = normalized.match(/^(.*?)(?:未完成表|未完成列表)$/))) {
    return `mai.incomplete-table ${commandArgument(match[1])}`
  }
  if ((match = normalized.match(/^(?:info|minfo)\s+(.+)$/i))) {
    return `mai.song-score ${commandArgument(match[1])}`
  }
  if ((match = normalized.match(/^(绿谱?|黄谱?|红谱?|紫谱?|白谱?)成绩\s+(.+)$/))) {
    return `mai.song-score ${commandArgument(match[2])} --difficulty ${commandArgument(match[1])}`
  }
  if ((match = normalized.match(/^段位表(?:\s+(.*))?$/))) {
    return `mai.course ${commandArgument(match[1] ?? '')}`
  }
  if ((match = normalized.match(/^(.+?)进度(?:\s+(.*))?$/))) {
    return `mai.progress ${commandArgument(match[1])} ${commandArgument(match[2] ?? '')}`
  }
  return null
}

export function createCompatibilityMiddleware(
  dependencies: CoreCommandDependencies,
): Middleware {
  const supportedPlatforms = new Set(
    dependencies.compatibilityPlatforms ?? ['qq', 'onebot', 'mock'],
  )
  return async (session, next) => {
    if (!supportedPlatforms.has(session.platform)) return next()
    if (!session.userId || session.userId === session.selfId) return next()
    const content = session.content?.trim() ?? ''
    if (!content || content.startsWith('/') || !isExactCompatibilityCommand(content)) {
      return next()
    }
    let defaultGame: string
    try {
      defaultGame = await dependencies.settingService.getDefaultGame(session.userId)
    } catch {
      return next()
    }
    if (defaultGame !== 'maimai') return next()
    const execution = resolveCompatibilityExecution(content)
    if (!execution) return next()
    await session.execute(execution)
  }
}

export interface CoreCommandRegistration {
  readonly commands: readonly Command[]
  dispose(): void
}

export function registerCoreCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  const commands = [
    registerHelpCommand(ctx, dependencies),
    ...registerSettingsCommands(ctx, dependencies),
    ...registerMusicCommands(ctx, dependencies),
    ...registerImageCommands(ctx, dependencies),
    ...registerRecordCommands(ctx, dependencies),
    ...registerCalcCommands(ctx, dependencies),
  ]
  const disposeMiddleware = ctx.middleware(createCompatibilityMiddleware(dependencies))
  let disposed = false

  return {
    commands,
    dispose() {
      if (disposed) return
      disposed = true
      disposeMiddleware()
      for (const command of [...commands].reverse()) command.dispose()
      dependencies.callbackRouter.clear()
    },
  } satisfies CoreCommandRegistration
}
