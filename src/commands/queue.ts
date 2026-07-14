import type { Command, Context, Middleware } from 'koishi'
import { isAdministrator } from '../platform/admin'
import {
  QueueServiceError,
  type QueueService,
} from '../services/queue-service'
import {
  commandAction,
  replyText,
  type ActiveCommandSession,
  type ReplyCommandDependencies,
} from './support'

type QueueServicePort = Pick<
  QueueService,
  | 'addArcade'
  | 'deleteArcade'
  | 'addAlias'
  | 'deleteAlias'
  | 'aliases'
  | 'bindGroup'
  | 'handleMessage'
>

export interface QueueCommandDependencies extends ReplyCommandDependencies {
  queueService: QueueServicePort
  administrators?: readonly string[]
}

export interface QueueCommandRegistration {
  readonly commands: readonly Command[]
  dispose(): Promise<void>
}

export const QUEUE_HELP_TEXT = [
  '本功能可以提供机厅人数查询及更新功能，支持的功能命令如下：',
  '查询人数：@可怜BOT 几 (或者 j)',
  '修改机厅：@可怜BOT 排卡管理 添加机厅/删除机厅 机厅名称',
  '机厅别名：@可怜BOT 排卡管理 查看别名/添加别名/删除别名 机厅名称 (别名)',
].join('\n')

async function administratorSubject(session: ActiveCommandSession) {
  let authority = (session.user as { authority?: number } | undefined)?.authority
  if (authority === undefined) {
    try {
      authority = (await session.observeUser(['authority'])).authority
    } catch {
      authority = undefined
    }
  }
  return {
    userId: session.userId,
    authority,
    roles: session.event.member?.roles?.map(role => role.id),
  }
}

async function manageQueue(
  session: ActiveCommandSession,
  dependencies: QueueCommandDependencies,
  raw: string,
) {
  if (session.isDirect) {
    await replyText(session, dependencies, '排卡管理仅支持群聊。')
    return
  }
  if (!isAdministrator(await administratorSubject(session), {
    administrators: dependencies.administrators,
  })) {
    await replyText(session, dependencies, '权限不足。')
    return
  }
  const [operation, name, alias] = raw.trim().split(/\s+/u)
  try {
    switch (operation) {
      case '添加机厅':
        if (!name) {
          await replyText(session, dependencies, '使用方法：/排卡管理 添加机厅 机厅名称')
          return
        }
        await dependencies.queueService.addArcade(session.channelId, name)
        await replyText(session, dependencies, '添加机厅成功。')
        return
      case '删除机厅':
        if (!name) {
          await replyText(session, dependencies, '使用方法：/排卡管理 删除机厅 机厅名称')
          return
        }
        await dependencies.queueService.deleteArcade(session.channelId, name)
        await replyText(session, dependencies, '删除机厅成功。')
        return
      case '添加别名':
        if (!name) {
          await replyText(session, dependencies, '请输入别名！')
          return
        }
        await dependencies.queueService.addAlias(session.channelId, name, alias)
        await replyText(session, dependencies, '添加机厅别名成功。')
        return
      case '删除别名':
        if (!name) {
          await replyText(session, dependencies, '请输入别名！')
          return
        }
        await dependencies.queueService.deleteAlias(session.channelId, name, alias)
        await replyText(session, dependencies, '删除机厅别名成功。')
        return
      case '查看别名': {
        if (!name) {
          await replyText(session, dependencies, '请输入要查看别名的机厅！')
          return
        }
        const aliases = await dependencies.queueService.aliases(session.channelId, name)
        await replyText(session, dependencies, `机厅别名如下：${aliases.join('，')}`)
        return
      }
      case '添加分组':
        if (!name) {
          await replyText(session, dependencies, QUEUE_HELP_TEXT)
          return
        }
        await dependencies.queueService.bindGroup(session.channelId, name)
        await replyText(session, dependencies, '设置分组成功。')
        return
      default:
        await replyText(session, dependencies, QUEUE_HELP_TEXT)
    }
  } catch (error) {
    if (error instanceof QueueServiceError) {
      await replyText(session, dependencies, error.message)
      return
    }
    throw error
  }
}

export function createQueueMiddleware(
  dependencies: QueueCommandDependencies,
): Middleware {
  return async (session, next) => {
    if (!session.userId || !session.channelId || session.userId === session.selfId) return next()
    if (session.isDirect || session.event.user?.isBot) return next()
    const content = session.content?.trim() ?? ''
    if (!content) return next()
    let result
    try {
      result = await dependencies.queueService.handleMessage(session.channelId, content)
    } catch (error) {
      if (error instanceof QueueServiceError) return next()
      throw error
    }
    if (!result) return next()
    await replyText(session as ActiveCommandSession, dependencies, result.text)
  }
}

export function registerQueueCommands(
  ctx: Context,
  dependencies: QueueCommandDependencies,
): QueueCommandRegistration {
  const command = ctx.command('mai.queue [input:text]', '管理机厅排卡', {
    authority: 4,
    permissions: ['authority:0'],
  })
    .shortcut(/^\/mai\s+排卡管理(?:\s+(.*))?$/u, { args: ['$1'] })
    .action(commandAction(async ({ session }, input = '') => {
      await manageQueue(session, dependencies, input)
    }))
  const disposeMiddleware = ctx.middleware(createQueueMiddleware(dependencies), false)
  let disposed = false

  return {
    commands: [command],
    async dispose() {
      if (disposed) return
      disposed = true
      disposeMiddleware()
      command.dispose()
    },
  }
}
