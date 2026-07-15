import type { Context } from 'koishi'
import {
  PublicCallbackUnavailableError,
  UpdateBindingRequiredError,
  type UpdateService,
  type UpdateSessionLocator,
} from '../services/update-service'
import {
  commandAction,
  createQqCommandGuidance,
  createQqUrlGuidance,
  replyText,
  type ActiveCommandSession,
  type ReplyCommandDependencies,
} from './support'

export type UpdateServicePort = Pick<
  UpdateService,
  'beginDivingFishUpdate' | 'beginLxnsOAuth' | 'bindDivingFishToken' | 'unbindLxns'
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
    send: (text, options) => replyText(
      session,
      dependencies,
      text,
      options?.retryCommand
        ? createQqCommandGuidance(text, [[{
            id: 'retry-lxns-oauth',
            label: '重试授权',
            command: options.retryCommand,
            enter: true,
            reply: true,
          }]])
        : undefined,
    ),
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
  retryCommand?: string,
) {
  const guidanceCommand = error instanceof PublicCallbackUnavailableError
    ? undefined
    : retryCommand
  const replyWithGuidance = async (text: string) => {
    await replyText(session, dependencies, text, createQqCommandGuidance(text, [[{
      id: guidanceCommand ? 'retry-update' : 'update-help',
      label: guidanceCommand ? '重试' : '返回帮助',
      command: guidanceCommand ?? '/mai',
      enter: true,
      reply: true,
    }]]))
  }
  if (error instanceof PublicCallbackUnavailableError || error instanceof UpdateBindingRequiredError) {
    await replyWithGuidance(error.message)
    return
  }
  await replyWithGuidance('更新失败，请稍后重试。')
}

export function registerUpdateCommands(
  ctx: Context,
  dependencies: UpdateCommandDependencies,
) {
  return [
    ctx.command('mai.bind-lxns', '绑定落雪 OAuth')
      .shortcut(/^\/mai\s+(?:绑定落雪|bind-lxns)$/iu)
      .action(commandAction(async ({ session }) => {
        try {
          const url = await dependencies.updateService.beginLxnsOAuth(
            createUpdateSessionLocator(session, dependencies, ''),
          )
          const text = `请授权 BOT 访问您在落雪查分器的成绩。无法使用按钮时，请复制以下 HTTPS 链接打开：\n${url}`
          await replyText(session, dependencies, text, createQqUrlGuidance(text, {
            id: 'lxns-oauth',
            label: '前往落雪授权',
            visitedLabel: '重新前往落雪授权',
            url,
          }))
        } catch (error) {
          await updateFailure(session, dependencies, error, '/mai 绑定落雪')
        }
      })),
    ctx.command('mai.unbind-lxns', '解绑落雪 OAuth')
      .shortcut(/^\/mai\s+(?:解绑落雪|unbind-lxns)$/iu)
      .action(commandAction(async ({ session }) => {
        try {
          await dependencies.updateService.unbindLxns(session.userId)
          const text = '落雪授权解绑成功。需要时可重新发送“/mai 绑定落雪”。'
          await replyText(session, dependencies, text, createQqCommandGuidance(text, [[{
            id: 'rebind-lxns',
            label: '重新绑定落雪',
            command: '/mai 绑定落雪',
            enter: true,
            reply: true,
          }]]))
        } catch (error) {
          await updateFailure(session, dependencies, error, '/mai 解绑落雪')
        }
      })),
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
          await updateFailure(session, dependencies, error, '/mai 更新')
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
