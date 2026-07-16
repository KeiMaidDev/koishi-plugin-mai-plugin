import type { Command, Context, Middleware } from 'koishi'
import { isAdministrator } from '../platform/admin'
import {
  QueueServiceError,
  type QueueService,
} from '../services/queue-service'
import {
  commandAction,
  createQqCommandGuidance,
  replyText,
  type ActiveCommandSession,
  type QqCommandGuidanceButton,
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
  '## 舞萌DX',
  '本功能可以提供机厅人数查询及更新功能。',
  '支持的功能命令如下：',
].join('\n')

const queueActionRows: readonly (readonly QqCommandGuidanceButton[])[] = [
  [
    queueAction('queue-add-arcade', '添加机厅', '添加机厅'),
    queueAction('queue-delete-arcade', '删除机厅', '删除机厅'),
    queueAction('queue-view-aliases', '查看别名', '查看别名'),
  ],
  [
    queueAction('queue-add-alias', '添加别名', '添加别名'),
    queueAction('queue-delete-alias', '删除别名', '删除别名'),
    queueAction('queue-bind-group', '添加分组', '添加分组'),
  ],
]

function queueAction(id: string, label: string, operation: string): QqCommandGuidanceButton {
  return {
    id,
    label,
    command: `/mai 排卡管理 ${operation}`,
    enter: false,
    reply: false,
  }
}

function queueMenu(content: string) {
  return createQqCommandGuidance(content, queueActionRows)
}

function queueOperation(content: string, id: string, label: string, operation: string) {
  return createQqCommandGuidance(content, [[queueAction(id, label, operation)]])
}

function queueStatus(content: string) {
  return createQqCommandGuidance(content, [[{
    id: 'queue-manage',
    label: '排卡管理',
    command: '/mai 排卡管理',
    enter: true,
    reply: false,
  }]])
}

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
          const text = '请填写机厅名称'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-add-arcade-input',
            '填写机厅名称',
            '添加机厅',
          ))
          return
        }
        await dependencies.queueService.addArcade(session.channelId, name)
        await replyText(session, dependencies, '添加机厅成功。', queueMenu('添加机厅成功。'))
        return
      case '删除机厅':
        if (!name) {
          const text = '请填写机厅名称'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-delete-arcade-input',
            '填写机厅名称',
            '删除机厅',
          ))
          return
        }
        await dependencies.queueService.deleteArcade(session.channelId, name)
        await replyText(session, dependencies, '删除机厅成功。', queueMenu('删除机厅成功。'))
        return
      case '添加别名':
        if (!name || !alias) {
          const text = '请填写机厅名称和别名'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-add-alias-input',
            '填写机厅和别名',
            '添加别名',
          ))
          return
        }
        await dependencies.queueService.addAlias(session.channelId, name, alias)
        await replyText(session, dependencies, '添加机厅别名成功。', queueMenu('添加机厅别名成功。'))
        return
      case '删除别名':
        if (!name || !alias) {
          const text = '请填写机厅名称和别名'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-delete-alias-input',
            '填写机厅和别名',
            '删除别名',
          ))
          return
        }
        await dependencies.queueService.deleteAlias(session.channelId, name, alias)
        await replyText(session, dependencies, '删除机厅别名成功。', queueMenu('删除机厅别名成功。'))
        return
      case '查看别名': {
        if (!name) {
          const text = '请填写机厅名称'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-view-aliases-input',
            '填写机厅名称',
            '查看别名',
          ))
          return
        }
        const aliases = await dependencies.queueService.aliases(session.channelId, name)
        const text = `机厅别名如下：${aliases.join('，')}`
        await replyText(session, dependencies, text, queueMenu(text))
        return
      }
      case '添加分组':
        if (!name) {
          const text = '请填写分组名称'
          await replyText(session, dependencies, text, queueOperation(
            text,
            'queue-bind-group-input',
            '填写分组名称',
            '添加分组',
          ))
          return
        }
        await dependencies.queueService.bindGroup(session.channelId, name)
        await replyText(session, dependencies, '设置分组成功。', queueMenu('设置分组成功。'))
        return
      default:
        await replyText(session, dependencies, QUEUE_HELP_TEXT, queueMenu(QUEUE_HELP_TEXT))
    }
  } catch (error) {
    if (error instanceof QueueServiceError) {
      await replyText(session, dependencies, error.message, queueMenu(error.message))
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
    await replyText(
      session as ActiveCommandSession,
      dependencies,
      result.text,
      queueStatus(result.text),
    )
  }
}

export function registerQueueCommands(
  ctx: Context,
  dependencies: QueueCommandDependencies,
): QueueCommandRegistration {
  const command = ctx.command('mai.queue [input:text]', '管理机厅排卡')
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
