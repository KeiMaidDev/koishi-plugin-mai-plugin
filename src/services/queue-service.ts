import {
  ARCADE_NO_UPDATES_AT_MS,
  ArcadeRepositoryError,
  type ArcadeRepository,
  type ArcadeSnapshot,
} from '../database/repositories'

type QueueRepository = Pick<
  ArcadeRepository,
  | 'addArcade'
  | 'deleteArcade'
  | 'addAlias'
  | 'deleteAlias'
  | 'aliases'
  | 'bind'
  | 'list'
  | 'mutateCount'
>

export interface QueueServiceOptions {
  now?: () => Date
}

export type QueueMessageResult =
  | { type: 'updated', arcade: ArcadeSnapshot, text: string }
  | { type: 'too-large', text: string }
  | { type: 'query', arcades: ArcadeSnapshot[], text: string }
  | { type: 'empty', text: string }

export type QueueServiceErrorCode =
  | 'invalid-arcade-name'
  | 'arcade-name-too-long'
  | 'alias-required'
  | 'invalid-alias'
  | 'alias-too-long'
  | 'invalid-group-name'
  | 'group-name-too-long'
  | 'arcade-not-found'
  | 'group-not-found'
  | 'arcade-exists'
  | 'alias-exists'

export class QueueServiceError extends Error {
  constructor(
    readonly code: QueueServiceErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'QueueServiceError'
  }
}

function arcadeName(raw: string | null | undefined) {
  const name = raw?.trim() ?? ''
  if (!name) {
    throw new QueueServiceError('invalid-arcade-name', '请输入正确的机厅名称！')
  }
  if (name.length > 32) {
    throw new QueueServiceError('arcade-name-too-long', '机厅名称过长！')
  }
  return name
}

function aliasName(raw: string | null | undefined) {
  if (raw === null || raw === undefined) {
    throw new QueueServiceError('alias-required', '请输入别名！')
  }
  const alias = raw.replaceAll(',', '').trim()
  if (!alias) {
    throw new QueueServiceError('invalid-alias', '请输入正确的别名！')
  }
  if (alias.length > 32) {
    throw new QueueServiceError('alias-too-long', '别名长度过长！')
  }
  return alias
}

function groupName(raw: string | null | undefined) {
  const name = raw?.trim() ?? ''
  if (!name) {
    throw new QueueServiceError('invalid-group-name', '请输入正确的分组名称！')
  }
  if (name.length > 32) {
    throw new QueueServiceError('group-name-too-long', '分组名称过长！')
  }
  return name
}

const repositoryErrorMessages = {
  'arcade-not-found': '机厅不存在！',
  'group-not-found': '该分组不存在。',
  'arcade-exists': '机厅已存在！',
  'alias-exists': '别名已存在！',
} as const

async function translateRepositoryErrors<T>(
  operation: () => Promise<T>,
  missingGroupIsMissingArcade = true,
) {
  try {
    return await operation()
  } catch (error) {
    if (!(error instanceof ArcadeRepositoryError)) throw error
    const code = error.code === 'group-not-found' && missingGroupIsMissingArcade
      ? 'arcade-not-found'
      : error.code
    throw new QueueServiceError(code, repositoryErrorMessages[code])
  }
}

function compact(value: string) {
  return value.replaceAll(' ', '')
}

function formatStatus(arcade: ArcadeSnapshot, now: Date) {
  let updated: string
  if (arcade.modifiedAt.getTime() === ARCADE_NO_UPDATES_AT_MS) {
    updated = '今日未更新数据'
  } else {
    const hours = Math.floor((now.getTime() - arcade.modifiedAt.getTime()) / 3_600_000)
    updated = hours < 1 ? '更新于 1 小时内' : `更新于 ${hours} 小时前`
  }
  return `${arcade.name}: ${arcade.value}人 (${updated})`
}

function formatQuery(arcades: ArcadeSnapshot[], now: Date) {
  const statuses = arcades.map(arcade => formatStatus(arcade, now)).join('\n')
  if (arcades.length === 1) return statuses
  return [
    '机厅排卡人数：',
    '',
    statuses,
    '',
    '更新数据请使用“/mai 排卡管理 更新人数 <机厅名称> <人数或增量>”。',
  ].join('\n')
}

const EMPTY_QUEUE_TEXT = '当前群未设置机厅，请先添加机厅。'

function parseCountMutation(raw: string) {
  const match = raw.trim().match(/^([+=-]?)(\d+)$/u)
  if (!match) return null
  const magnitude = BigInt(match[2])
  const bounded = Number(
    magnitude > BigInt(Number.MAX_SAFE_INTEGER)
      ? BigInt(Number.MAX_SAFE_INTEGER)
      : magnitude,
  )
  if (match[1] === '+') return { type: 'adjust' as const, value: bounded }
  if (match[1] === '-') return { type: 'adjust' as const, value: -bounded }
  return { type: 'set' as const, value: bounded }
}

export class QueueService {
  constructor(
    private readonly repository: QueueRepository,
    private readonly options: QueueServiceOptions = {},
  ) {}

  async addArcade(channelId: string, rawName: string) {
    const name = arcadeName(rawName)
    return translateRepositoryErrors(() => this.repository.addArcade(channelId, name))
  }

  async deleteArcade(channelId: string, rawName: string) {
    const name = arcadeName(rawName)
    return translateRepositoryErrors(() => this.repository.deleteArcade(channelId, name))
  }

  async addAlias(channelId: string, rawName: string, rawAlias?: string) {
    const name = arcadeName(rawName)
    const alias = aliasName(rawAlias)
    return translateRepositoryErrors(() => this.repository.addAlias(channelId, name, alias))
  }

  async deleteAlias(channelId: string, rawName: string, rawAlias?: string) {
    const name = arcadeName(rawName)
    const alias = aliasName(rawAlias)
    return translateRepositoryErrors(() => this.repository.deleteAlias(channelId, name, alias))
  }

  async aliases(channelId: string, rawName: string) {
    const name = arcadeName(rawName)
    return translateRepositoryErrors(() => this.repository.aliases(channelId, name))
  }

  async bindGroup(channelId: string, rawGroupName: string) {
    const name = groupName(rawGroupName)
    return translateRepositoryErrors(() => this.repository.bind(channelId, name), false)
  }

  async query(channelId: string, rawName = ''): Promise<QueueMessageResult | null> {
    const now = this.options.now?.() ?? new Date()
    const arcades = await this.repository.list(channelId, now)
    if (!arcades?.length) return { type: 'empty', text: EMPTY_QUEUE_TEXT }

    const requestedName = compact(rawName).toLocaleLowerCase()
    const queried = requestedName
      ? arcades.filter(arcade => (
          [arcade.name, ...arcade.aliases].some(alias => (
            compact(alias).toLocaleLowerCase() === requestedName
          ))
        ))
      : arcades
    if (queried.length !== (requestedName ? 1 : arcades.length)) return null
    return {
      type: 'query',
      arcades: queried,
      text: formatQuery(queried, now),
    }
  }

  async updateCount(
    channelId: string,
    rawName: string,
    rawCount: string,
  ): Promise<QueueMessageResult | null> {
    const mutation = parseCountMutation(rawCount)
    if (!mutation) return null
    const now = this.options.now?.() ?? new Date()
    const arcades = await this.repository.list(channelId, now)
    if (!arcades?.length) return null

    const requestedName = compact(rawName).toLocaleLowerCase()
    if (!requestedName) return null
    const candidates = arcades.filter(arcade => (
      [arcade.name, ...arcade.aliases].some(alias => (
        compact(alias).toLocaleLowerCase() === requestedName
      ))
    ))
    if (candidates.length !== 1) return null

    const result = await this.repository.mutateCount(
      channelId,
      candidates[0].name,
      mutation,
      now,
      50,
    )
    if (result.type === 'too-large') {
      return { type: 'too-large', text: '机厅很小，请你忍一忍' }
    }
    return {
      type: 'updated',
      arcade: result.arcade,
      text: `更新成功，现在${result.arcade.name}人数为${result.arcade.value}人。`,
    }
  }
}
