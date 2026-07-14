import type { Context } from 'koishi'
import { Config, ConfigSchema } from './config'
import { INJECTED_SERVICES, PLUGIN_NAME } from './constants'
import { MaimaiDataSyncService, type MaimaiDataSyncOptions } from './data/sync-service'
import { registerMaiDatabaseModels } from './database/models'
import {
  connectDataSyncAssetInvalidation,
  TakumiRenderService,
} from './render/renderer'
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
export * from './services/query-service'
export * from './services/setting-service'
export * from './platform/admin'
export * from './platform/command-router'
export * from './platform/fallback-message'
export * from './platform/qq-message'
export * from './render/assets'
export * from './render/course-template'
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
}

interface DefaultRuntimeState {
  renderer?: TakumiRenderService
  dataSync?: MaimaiDataSyncService
  disconnectInvalidation?: () => void
}

const defaultRuntimeStates = new WeakMap<object, DefaultRuntimeState>()

const defaultLifecycleDependencies: DefaultLifecycleDependencies = {
  initializeDatabaseModels: ctx => registerMaiDatabaseModels(ctx),
  createRenderer: options => new TakumiRenderService(options),
  createDataSync: options => new MaimaiDataSyncService(options),
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
    initializeCommands: noOp,
    cancelSyncTasks: noOp,
    clearWaitingQueue() {
      state.renderer?.clearWaitingQueue(new Error('[mai-plugin] renderer queue cleared'))
    },
    releaseCallbackState() {
      state.disconnectInvalidation?.()
      state.disconnectInvalidation = undefined
      defaultRuntimeStates.delete(ctx)
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
