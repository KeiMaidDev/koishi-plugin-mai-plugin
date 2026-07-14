import h from '@satorijs/element'
import type { Command, Context, Fragment, Session } from 'koishi'
import type { CourseInfo, IconInfo, PlateInfo } from '../data/normalizers'
import type { BindRepository } from '../database/repositories'
import type { MusicInfo } from '../domain/music'
import { createQqNativeMarkdown } from '../platform/qq-message'
import { sendReply } from '../platform/qq-message'
import type { CommandCallbackRouter } from '../platform/command-router'
import type { MaiRenderer } from '../render/mai-renderer'
import type { AliasService } from '../services/alias-service'
import type { QueryService } from '../services/query-service'
import type { SettingService } from '../services/setting-service'
import type { Awaitable } from '../types'

export const SEARCH_PAGE_SIZE = 10
export const SEARCH_TOO_MANY = 40
export const MAX_USER_REGEX_LENGTH = 128
export const SCORE_LIST_PAGE_SIZE = 50

export interface CoreCommandData {
  musics: ReadonlyMap<number, MusicInfo>
  courses: ReadonlyMap<number, CourseInfo>
  icons: ReadonlyMap<number, IconInfo>
  plates: ReadonlyMap<number, PlateInfo>
}

export interface CoreCommandDependencies {
  data: CoreCommandData
  aliasService: Pick<AliasService, 'search' | 'add' | 'remove' | 'vote'>
  queryService: Pick<
    QueryService,
    'getQueryParams' | 'consumePendingCommand' | 'rating' | 'record' | 'records' | 'recent'
  >
  settingService: Pick<
    SettingService,
    | 'isCompatibilityMode'
    | 'getDefaultGame'
    | 'setProviderPreference'
    | 'setCompatibilityMode'
    | 'setAvatar'
    | 'setPlate'
    | 'setDefaultGame'
  >
  bindRepository: Pick<BindRepository, 'setQq'>
  renderer: MaiRenderer
  callbackRouter: CommandCallbackRouter
  administrators?: readonly string[]
  compatibilityMode?: boolean
  now?: () => Date
  random?: () => number
  previewAudio?: (music: MusicInfo) => Awaitable<Buffer | Uint8Array | null>
  replayCommand?: (session: Session, command: string) => Awaitable<void>
  compatibilityPlatforms?: readonly string[]
}

export type CoreCommandContext = Pick<Context, 'command'>

export type ActiveCommandSession = Session & {
  userId: string
  channelId: string
  content: string
}

interface ActiveCommandArgv {
  session: ActiveCommandSession
  options: Record<string, any>
}

export function commandAction(
  callback: (argv: ActiveCommandArgv, ...args: any[]) => Awaitable<void | Fragment>,
): Command.Action {
  return (argv, ...args) => {
    const session = argv.session
    if (!session?.userId || !session.channelId || session.content === undefined) {
      throw new Error('[mai-plugin] command action requires a message session.')
    }
    return callback({
      ...argv,
      session: session as ActiveCommandSession,
      options: argv.options ?? {},
    }, ...args)
  }
}

export async function compatibilityModeFor(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
) {
  if (dependencies.compatibilityMode) return true
  return dependencies.settingService?.isCompatibilityMode(session.userId) ?? false
}

export async function replyText(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  text: string,
  rich = createQqNativeMarkdown(text),
) {
  await sendReply(
    session,
    { type: 'text', text },
    rich,
    { compatibilityMode: await compatibilityModeFor(session, dependencies) },
  )
}

export async function replyImage(
  session: ActiveCommandSession,
  dependencies: CoreCommandDependencies,
  image: Buffer | Uint8Array,
  text = '',
  rich?: h,
) {
  const compatibilityMode = await compatibilityModeFor(session, dependencies)
  if (session.platform === 'qq' && !compatibilityMode && rich) {
    await session.send([h.image(Buffer.from(image), 'image/png'), rich])
    return
  }
  await sendReply(session, [
    { type: 'image', data: image, mimeType: 'image/png' },
    ...(text ? [{ type: 'text' as const, text }] : []),
  ], undefined, { compatibilityMode })
}

export async function replyAudio(session: ActiveCommandSession, audio: Buffer | Uint8Array) {
  await session.send(h.audio(Buffer.from(audio), 'audio/ogg'))
}
