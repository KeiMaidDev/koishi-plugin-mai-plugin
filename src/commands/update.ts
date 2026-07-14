import type { Context } from 'koishi'
import {
  PublicCallbackUnavailableError,
  UpdateBindingRequiredError,
  type UpdateService,
  type UpdateSessionLocator,
} from '../services/update-service'
import {
  commandAction,
  replyText,
  type ActiveCommandSession,
  type ReplyCommandDependencies,
} from './support'

export type UpdateServicePort = Pick<
  UpdateService,
  'beginDivingFishUpdate' | 'beginLxnsOAuth' | 'bindDivingFishToken'
>

export interface UpdateCommandDependencies extends ReplyCommandDependencies {
  updateService: UpdateServicePort
  replayCommand?: (session: ActiveCommandSession, command: string) => Promise<void> | void
}

export function createUpdateSessionLocator(
  session: ActiveCommandSession,
  dependencies: UpdateCommandDependencies,
  pendingCommand = session.content,
): UpdateSessionLocator {
  return {
    userId: session.userId,
    platform: session.platform,
    channelId: session.channelId,
    direct: session.isDirect,
    pendingCommand,
    send: text => replyText(session, dependencies, text),
    replay: async (command) => {
      if (dependencies.replayCommand) {
        await dependencies.replayCommand(session, command)
      } else {
        await session.execute(command)
      }
    },
  }
}

async function updateFailure(
  session: ActiveCommandSession,
  dependencies: UpdateCommandDependencies,
  error: unknown,
) {
  if (error instanceof PublicCallbackUnavailableError || error instanceof UpdateBindingRequiredError) {
    await replyText(session, dependencies, error.message)
    return
  }
  await replyText(session, dependencies, '更新失败，请稍后重试。')
}

export function registerUpdateCommands(
  ctx: Context,
  dependencies: UpdateCommandDependencies,
) {
  return [
    ctx.command('mai.update', '更新水鱼成绩')
      .shortcut(/^\/mai\s+(?:更新|导)$/u)
      .action(commandAction(async ({ session }) => {
        try {
          const url = await dependencies.updateService.beginDivingFishUpdate(
            createUpdateSessionLocator(session, dependencies, ''),
          )
          await replyText(
            session,
            dependencies,
            `${url}\n请连接代理后在微信中打开该链接。请自行确认第三方服务条款与网络合规性。`,
          )
        } catch (error) {
          await updateFailure(session, dependencies, error)
        }
      })),
    ctx.command('mai.bind-diving-fish <token:text>', '绑定水鱼成绩导入 Token')
      .shortcut(/^\/mai\s+绑定水鱼(?:\s+(.*))?$/u, { args: ['$1'] })
      .action(commandAction(async ({ session }, token = '') => {
        try {
          await dependencies.updateService.bindDivingFishToken(session.userId, token)
          await replyText(session, dependencies, '水鱼token绑定成功。')
        } catch (error) {
          await updateFailure(session, dependencies, error)
        }
      })),
  ]
}
