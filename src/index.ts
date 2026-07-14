import type { Context } from 'koishi'
import h from '@satorijs/element'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Config, ConfigSchema } from './config'
import {
  registerCoreCommands,
  type CoreCommandDependencies,
  type CoreCommandRegistration,
} from './commands/core'
import { INJECTED_SERVICES, PLUGIN_NAME } from './constants'
import { MaimaiDataSyncService, type MaimaiDataSyncOptions } from './data/sync-service'
import { registerMaiDatabaseModels } from './database/models'
import { MaiRepositories } from './database/repositories'
import { PlayerSettings } from './domain/player'
import { CommandCallbackRouter } from './platform/command-router'
import { DivingFishProvider } from './providers/diving-fish'
import { LxnsProvider } from './providers/lxns'
import { ProviderChain } from './providers/provider-chain'
import { TakumiMaiRenderer } from './render/mai-renderer'
import { TakumiGuessRenderer } from './render/guess-template'
import {
  connectDataSyncAssetInvalidation,
  TakumiRenderService,
} from './render/renderer'
import { AliasService } from './services/alias-service'
import { GuessService, type GuessReply, type GuessTarget } from './services/guess-service'
import { QqBindingRequiredError, QueryService } from './services/query-service'
import { SettingService } from './services/setting-service'
import type { Awaitable, LifecycleContext, LifecycleSteps, PluginContext } from './types'

export const name = PLUGIN_NAME

export { Config, ConfigSchema }
export { type LifecycleContext, type LifecycleSteps }
export * from './database/models'
export * from './database/repositories'
export * from './domain/enums'
export * from './domain/music'
export * from './domain/player'
export * from './domain/rating'
export * from './data/cache-store'
export * from './data/manifest'
export * from './data/normalizers'
export * from './data/sync-service'
export * from './providers/types'
export * from './providers/errors'
export * from './providers/diving-fish'
export * from './providers/lxns'
export * from './providers/provider-chain'
export * from './query/filter-types'
export * from './query/combo-parser'
export * from './query/combo-rules'
export * from './query/combo-executor'
export * from './services/alias-service'
export * from './services/guess-service'
export * from './services/query-service'
export * from './services/setting-service'
export * from './commands/calc'
export * from './commands/core'
export * from './commands/guess'
export * from './commands/help'
export * from './commands/image'
export * from './commands/music'
export * from './commands/record'
export * from './commands/settings'
export * from './commands/support'
export * from './platform/admin'
export * from './platform/command-router'
export * from './platform/fallback-message'
export * from './platform/qq-message'
export * from './render/assets'
export * from './render/course-template'
export * from './render/guess-template'
export * from './render/level-template'
export * from './render/mai-renderer'
export * from './render/nodes'
export * from './render/radar-template'
export * from './render/rating-template'
export * from './render/renderer'
export * from './render/score-template'
export * from './render/theme'
export * from './utils/semaphore'
export * from './utils/strings'

export const inject = [...INJECTED_SERVICES]

const noOp = () => undefined

export interface DefaultLifecycleDependencies {
  initializeDatabaseModels(ctx: Context): Awaitable<void>
  createRenderer(options: Config['render']): TakumiRenderService
  createDataSync(options: MaimaiDataSyncOptions): MaimaiDataSyncService
  createCommandDependencies(
    ctx: Context,
    runtime: LifecycleContext,
    services: DefaultCommandServices,
  ): Awaitable<CoreCommandDependencies | null>
}

export interface DefaultCommandServices {
  dataSync: MaimaiDataSyncService
  renderer?: TakumiRenderService
}

interface DefaultRuntimeState {
  renderer?: TakumiRenderService
  dataSync?: MaimaiDataSyncService
  disconnectInvalidation?: () => void
  commandRegistration?: CoreCommandRegistration
}

const defaultRuntimeStates = new WeakMap<object, DefaultRuntimeState>()

const defaultLifecycleDependencies: DefaultLifecycleDependencies = {
  initializeDatabaseModels: ctx => registerMaiDatabaseModels(ctx),
  createRenderer: options => new TakumiRenderService(options),
  createDataSync: options => new MaimaiDataSyncService(options),
  createCommandDependencies: createDefaultCommandDependencies,
}

export async function createDefaultCommandDependencies(
  ctx: Context,
  runtime: LifecycleContext,
  services: DefaultCommandServices,
): Promise<CoreCommandDependencies> {
  if (!services.renderer) {
    throw new Error('[mai-plugin] renderer must be initialized before commands.')
  }
  const data = await services.dataSync.startup()
  const repositories = new MaiRepositories(ctx, runtime.config.oauth.tokenCipherKey)
  const providers = {
    divingFish: new DivingFishProvider({
      ctx,
      config: runtime.config,
      data,
      repositories,
    }),
    lxns: new LxnsProvider({
      ctx,
      config: runtime.config,
      data,
      repositories,
    }),
  }
  const providerChain = new ProviderChain({ data, repositories, providers })
  let settingService: SettingService
  settingService = new SettingService(data, repositories, {
    achievementRecords: async (userId, musics) => {
      const qq = await repositories.bind.getQq(userId)
      if (!qq) throw new QqBindingRequiredError({ userId, sessionId: 'settings' })
      const settings = await settingService.getSettings(userId)
      const result = await providerChain.records({
        type: 'qq',
        qq,
        userId,
        isSelf: true,
        provider: settings.provider,
        settings: new PlayerSettings(settings.avatar, settings.plate),
      }, musics)
      return result.response
    },
  })
  const queryService = new QueryService(repositories, {
    providerChain,
    settings: settingService,
  })
  const aliasService = new AliasService(data, repositories)
  const guessService = new GuessService({
    musics: data.musics,
    repository: repositories.guess,
    aliasService,
    renderer: new TakumiGuessRenderer(services.renderer, data),
    send: async (target: GuessTarget, reply: GuessReply) => {
      const bot = ctx.bots.find(candidate => candidate.platform === target.platform)
      if (!bot) {
        throw new Error(`[mai-plugin] no ${target.platform} bot is available to restore guessing game output.`)
      }
      const content = reply.type === 'text'
        ? h.text(reply.text)
        : [h.image(reply.image, 'image/png'), h.text(reply.text)]
      if (target.direct) {
        await bot.sendPrivateMessage(target.userId, content)
      } else {
        await bot.sendMessage(target.channelId, content)
      }
    },
    now: () => new Date(),
    random: Math.random,
    logger: ctx.logger(PLUGIN_NAME),
  })
  await guessService.restore()
  const previewDirectory = join(runtime.config.resourceSync.cacheDir, 'preview')

  return {
    data,
    aliasService,
    queryService,
    settingService,
    bindRepository: repositories.bind,
    guessService,
    settingRepository: repositories.setting,
    renderer: new TakumiMaiRenderer(services.renderer, data),
    callbackRouter: new CommandCallbackRouter(),
    administrators: runtime.config.administrators,
    compatibilityMode: runtime.config.compatibilityMode,
    now: () => new Date(),
    random: Math.random,
    async previewAudio(music) {
      try {
        const audio = await readFile(join(previewDirectory, `${music.resourceId}.ogg`))
        return audio.byteLength ? audio : null
      } catch {
        return null
      }
    },
  }
}

export function getTakumiRenderService(ctx: object) {
  const renderer = defaultRuntimeStates.get(ctx)?.renderer
  if (!renderer) throw new Error('[mai-plugin] renderer service is not initialized')
  return renderer
}

export function getMaimaiDataSyncService(ctx: object) {
  const dataSync = defaultRuntimeStates.get(ctx)?.dataSync
  if (!dataSync) throw new Error('[mai-plugin] data sync service is not initialized')
  return dataSync
}

export function createDefaultLifecycle(
  ctx: Context,
  overrides: Partial<DefaultLifecycleDependencies> = {},
): LifecycleSteps {
  const dependencies = { ...defaultLifecycleDependencies, ...overrides }
  const state = defaultRuntimeStates.get(ctx) ?? {}
  defaultRuntimeStates.set(ctx, state)

  const ensureDataSync = (runtime: LifecycleContext) => {
    state.dataSync ??= dependencies.createDataSync({ config: runtime.config.resourceSync })
    return state.dataSync
  }

  return {
    async verifyNativePackages() {
      await Promise.all([
        import('@takumi-rs/core'),
        import('@takumi-rs/helpers'),
      ])
    },
    initializeDatabaseModels: () => dependencies.initializeDatabaseModels(ctx),
    initializeDataCache(runtime) {
      ensureDataSync(runtime)
    },
    initializeProviders: noOp,
    async initializeRenderer(runtime) {
      const dataSync = ensureDataSync(runtime)
      state.renderer ??= dependencies.createRenderer(runtime.config.render)
      await state.renderer.initialize()
      state.disconnectInvalidation ??= connectDataSyncAssetInvalidation(dataSync, state.renderer)
    },
    initializeServices: noOp,
    initializeRoutes: noOp,
    async initializeCommands(runtime) {
      if (state.commandRegistration) return
      if (typeof (ctx as Context).command !== 'function') return
      const commandDependencies = await dependencies.createCommandDependencies(
        ctx,
        runtime,
        {
          dataSync: ensureDataSync(runtime),
          renderer: state.renderer,
        },
      )
      if (!commandDependencies) return
      state.commandRegistration = registerCoreCommands(ctx, commandDependencies)
    },
    cancelSyncTasks: noOp,
    clearWaitingQueue() {
      state.renderer?.clearWaitingQueue(new Error('[mai-plugin] renderer queue cleared'))
    },
    async releaseCallbackState() {
      try {
        await state.commandRegistration?.dispose()
      } finally {
        state.commandRegistration = undefined
        state.disconnectInvalidation?.()
        state.disconnectInvalidation = undefined
        defaultRuntimeStates.delete(ctx)
      }
    },
  }
}

function assertRequiredServices(ctx: PluginContext) {
  for (const service of INJECTED_SERVICES) {
    if (!ctx[service]) {
      throw new Error(`[mai-plugin] required Koishi service "${service}" is unavailable.`)
    }
  }
}

function createCleanup(lifecycle: LifecycleSteps) {
  let cleaned = false

  return async () => {
    if (cleaned) return
    cleaned = true

    const cleanupSteps = [
      () => lifecycle.cancelSyncTasks(),
      () => lifecycle.clearWaitingQueue(),
      () => lifecycle.releaseCallbackState(),
    ]
    const results = await Promise.allSettled(
      cleanupSteps.map(cleanup => Promise.resolve().then(cleanup)),
    )
    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map(result => result.reason)
    if (failures.length) throw new AggregateError(failures, 'mai-plugin cleanup failed')
  }
}

export async function initializePlugin(
  ctx: PluginContext,
  config: Config,
  lifecycle?: LifecycleSteps,
) {
  assertRequiredServices(ctx)
  const activeLifecycle = lifecycle ?? createDefaultLifecycle(ctx as Context)

  const runtime: LifecycleContext = {
    config,
    publicBaseUrl: config.publicBaseUrl || ctx.server?.selfUrl || '',
  }
  const cleanup = createCleanup(activeLifecycle)
  ctx.on('dispose', cleanup)

  try {
    await activeLifecycle.verifyNativePackages(runtime)
  } catch {
    await cleanup()
    throw new Error('[mai-plugin] Takumi native packages are unavailable. Reinstall @takumi-rs/core and @takumi-rs/helpers.')
  }

  try {
    await activeLifecycle.initializeDatabaseModels(runtime)
    await activeLifecycle.initializeDataCache(runtime)
    await activeLifecycle.initializeProviders(runtime)
    await activeLifecycle.initializeRenderer(runtime)
    await activeLifecycle.initializeServices(runtime)
    await activeLifecycle.initializeRoutes(runtime)
    await activeLifecycle.initializeCommands(runtime)
  } catch (error) {
    await cleanup()
    throw error
  }
}

export function apply(ctx: Context, config: Config) {
  return initializePlugin(ctx, config)
}
