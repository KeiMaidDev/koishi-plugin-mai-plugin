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
            reply: false,
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
  if (error instanceof PublicCallbackUnavailableError) {
    const text = `${error.message}\n落雪当前无法完成绑定，请选择其他查分器或绑定水鱼。`
    await replyText(session, dependencies, text, createQqCommandGuidance(text, [[
      {
        id: 'update-provider',
        label: '选择查分器',
        command: '/mai 设置查分器',
        enter: true,
        reply: false,
      },
      {
        id: 'update-bind-diving-fish',
        label: '绑定水鱼',
        command: '/mai 绑定水鱼',
        enter: false,
        reply: false,
        unsupportTips: '请在正文命令后补充水鱼导入 Token 并手动发送。',
      },
    ]]))
    return
  }
  if (error instanceof UpdateBindingRequiredError) {
    await replyText(session, dependencies, error.message, createQqCommandGuidance(error.message, [[{
      id: 'bind-diving-fish-token',
      label: '填写水鱼 Token',
      command: '/mai 绑定水鱼',
      enter: false,
      reply: false,
      unsupportTips: '请在正文命令后补充水鱼导入 Token 并手动发送。',
    }]]))
    return
  }
  const text = '更新失败，请稍后重试。'
  await replyText(session, dependencies, text, createQqCommandGuidance(text, [[{
    id: retryCommand ? 'retry-update' : 'update-help',
    label: retryCommand ? '重试' : '返回帮助',
    command: retryCommand ?? '/mai',
    enter: true,
    reply: false,
  }]]))
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
          const text = `请点击下方按钮授权 BOT 访问您在落雪查分器的成绩。`
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
            reply: false,
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
