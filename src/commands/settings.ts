import type { Context } from 'koishi'
import type { ProviderMode } from '../providers/types'
import {
  InvalidSettingError,
  PlateNotAcquiredError,
} from '../services/setting-service'
import {
  commandAction,
  createQqCommandGuidance,
  replyText,
  type ActiveCommandSession,
  type CoreCommandDependencies,
} from './support'

const SETTINGS_HELP = [
  '支持以下设置：',
  '设置头像 <头像 ID/名称>',
  '设置牌子 <牌子 ID/名称>',
  '设置查分器 <自动/水鱼/落雪>',
  '兼容模式 [关闭]',
].join('\n')

const PROVIDER_PROMPT = '请选择成绩查询使用的查分器。自动模式会依次尝试可用的查分器。'

function providerLabel(provider: ProviderMode) {
  if (provider === 'diving-fish') return '水鱼'
  if (provider === 'lxns') return '落雪'
  return '自动'
}

function providerSelectionGuidance(text: string) {
  return createQqCommandGuidance(text, [[
    {
      id: 'provider-auto',
      label: '自动',
      command: '/mai 设置查分器 自动',
      enter: true,
      reply: true,
    },
    {
      id: 'provider-diving-fish',
      label: '水鱼',
      command: '/mai 设置查分器 水鱼',
      enter: true,
      reply: true,
    },
    {
      id: 'provider-lxns',
      label: '落雪',
      command: '/mai 设置查分器 落雪',
      enter: true,
      reply: true,
    },
  ]])
}

function pendingScope(session: ActiveCommandSession) {
  return {
    userId: session.userId,
    sessionId: `${session.platform}:${session.channelId}`,
  }
}

function providerMode(raw: string): ProviderMode | null {
  const normalized = raw.trim().toLocaleLowerCase()
  if (['自动', 'auto'].includes(normalized)) return 'auto'
  if (['水鱼', 'diving-fish', 'divingfish'].includes(normalized)) return 'diving-fish'
  if (['落雪', 'lxns'].includes(normalized)) return 'lxns'
  return null
}

async function settingFailure(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  error: unknown,
) {
  if (error instanceof PlateNotAcquiredError) {
    await replyText(session, dependencies, '您尚未达成该牌子的获得条件。')
    return
  }
  if (error instanceof InvalidSettingError) {
    await replyText(session, dependencies, '设置失败，请检查输入。')
    return
  }
  await replyText(session, dependencies, '设置失败，请稍后重试。')
}

export function registerSettingsCommands(
  ctx: Context,
  dependencies: CoreCommandDependencies,
) {
  const commands = []

  commands.push(ctx.command('mai.bind <qq:string>', '绑定查询使用的 QQ 号')
    .shortcut(/^(?:\/mai\s+(?:bind|绑定)|\/bind)(?:\s+(.*))?$/i, { args: ['$1'] })
    .action(commandAction(async ({ session }, qq = '') => {
      const normalized = qq.trim()
      if (!/^\d{5,20}$/.test(normalized)) {
        const text = '用法：/mai 绑定 <QQ 号>'
        await replyText(session, dependencies, text, createQqCommandGuidance(text, [[{
          id: 'bind-qq',
          label: '绑定 QQ',
          command: '/mai 绑定',
          enter: false,
          reply: true,
          unsupportTips: '请在正文命令后补充 QQ 号并手动发送。',
        }]]))
        return
      }
      try {
        await dependencies.bindRepository.setQq(session.userId, normalized)
        const pending = dependencies.queryService.consumePendingCommand(pendingScope(session))
        await replyText(session, dependencies, 'QQ 绑定成功。')
        if (pending) {
          if (dependencies.replayCommand) {
            await dependencies.replayCommand(session, pending)
          } else {
            await session.execute(pending)
          }
        }
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.provider <provider:string>', '设置成绩查询后端')
    .shortcut(/^\/mai\s+设置查分器(?:\s+(.*))?$/, { args: ['$1'] })
    .shortcut(/^\/mai\s+(?:设置水鱼|水鱼)$/, { args: ['diving-fish'] })
    .shortcut(/^\/mai\s+(?:设置落雪|落雪)$/, { args: ['lxns'] })
    .action(commandAction(async ({ session }, raw = '') => {
      const provider = providerMode(raw)
      if (!provider) {
        const text = raw.trim()
          ? `不支持该查分器。${PROVIDER_PROMPT}`
          : PROVIDER_PROMPT
        await replyText(session, dependencies, text, providerSelectionGuidance(text))
        return
      }
      try {
        await dependencies.settingService.setProviderPreference(session.userId, provider)
        await replyText(session, dependencies, `已将查分器设置为“${providerLabel(provider)}”。`)
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.compatibility <input:text>', '切换兼容模式')
    .shortcut(/^\/mai\s+((?:兼容模式(?:\s+.*)?|取消兼容模式|关闭兼容模式|禁用兼容模式|打开兼容模式|启用兼容模式))$/, {
      args: ['$1'],
    })
    .action(commandAction(async ({ session }, raw) => {
      const disabled = /^(?:取消|关闭|禁用)兼容模式$/.test(raw)
        || /^兼容模式\s+(?:取消|关闭|禁用)$/.test(raw)
      const enabled = !disabled
      try {
        await dependencies.settingService.setCompatibilityMode(session.userId, enabled)
        await replyText(
          session,
          dependencies,
          enabled ? '兼容模式启用成功。' : '兼容模式禁用成功。',
        )
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.avatar <value:text>', '设置舞萌头像')
    .shortcut(/^\/mai\s+设置头像(?:\s+(.*))?$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, value = '') => {
      try {
        await dependencies.settingService.setAvatar(session.userId, value.trim())
        await replyText(session, dependencies, '头像设置成功。')
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.plate <value:text>', '设置舞萌牌子或姓名框')
    .shortcut(/^\/mai\s+(?:设置牌子|设置姓名框)(?:\s+(.*))?$/, { args: ['$1'] })
    .action(commandAction(async ({ session }, value = '') => {
      try {
        await dependencies.settingService.setPlate(session.userId, value.trim())
        await replyText(session, dependencies, '牌子设置成功。')
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  commands.push(ctx.command('mai.settings', '显示舞萌成绩图设置')
    .shortcut(/^\/mai\s+设置(?:mai|b50)$/i)
    .action(commandAction(async ({ session }) => {
      await replyText(session, dependencies, SETTINGS_HELP)
    })))

  commands.push(ctx.command('mai.default', '将舞萌设为默认音游')
    .shortcut(/^\/mai\s+(?:默认|设为默认)$/)
    .action(commandAction(async ({ session }) => {
      try {
        await dependencies.settingService.setDefaultGame(session.userId, 'maimai')
        await replyText(session, dependencies, '设置成功，默认游戏已切换为 maimai。')
      } catch (error) {
        await settingFailure(session, dependencies, error)
      }
    })))

  return commands
}
