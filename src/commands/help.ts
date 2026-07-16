import type { Context } from 'koishi'
import type { CoreCommandDependencies } from './support'
import { commandAction, createQqCommandGuidance, replyText } from './support'

const HELP_TEXT = [
  '舞萌 DX 常用命令：',
  '/mai 查歌 <关键词>',
  '/mai b50',
  '/mai 绑定 <QQ 号>',
  '/mai 设置查分器 <自动/水鱼/落雪>',
  '/mai 猜歌',
  '/mai 排卡管理',
  '完整文档：https://otmdb.cn/bot/maimai',
].join('\n')

export function registerHelpCommand(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  return ctx.command('mai', '舞萌 DX 命令帮助')
    .alias('/mai')
    .action(commandAction(async ({ session }) => {
      await replyText(session, dependencies, HELP_TEXT, createQqCommandGuidance(HELP_TEXT, [
        [
          {
            id: 'help-search',
            label: '查歌',
            command: '/mai 查歌',
            enter: true,
            reply: false,
          },
          {
            id: 'help-rating',
            label: 'B50',
            command: '/mai b50',
            enter: true,
            reply: false,
          },
          {
            id: 'help-bind',
            label: '绑定 QQ',
            command: '/mai 绑定',
            enter: true,
            reply: false,
          },
        ],
        [
          {
            id: 'help-provider',
            label: '设置查分器',
            command: '/mai 设置查分器',
            enter: true,
            reply: false,
          },
          {
            id: 'help-guess',
            label: '猜歌',
            command: '/mai 猜歌',
            enter: true,
            reply: false,
          },
          {
            id: 'help-queue',
            label: '排卡',
            command: '/mai 排卡管理',
            enter: true,
            reply: false,
          },
        ],
      ]))
    }))
}
