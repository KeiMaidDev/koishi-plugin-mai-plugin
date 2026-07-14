import type { Context } from 'koishi'
import type { CoreCommandDependencies } from './support'
import { commandAction, replyText } from './support'

export function registerHelpCommand(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  return ctx.command('mai', '舞萌 DX 命令帮助')
    .alias('/mai')
    .action(commandAction(async ({ session }) => {
      await replyText(session, dependencies, '请查看文档：https://otmdb.cn/bot/maimai')
    }))
}
