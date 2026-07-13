import type { Context } from 'koishi'
import { Config, ConfigSchema } from './config'
import { INJECTED_SERVICES, PLUGIN_NAME } from './constants'
import { registerMaiDatabaseModels } from './database/models'
import type { LifecycleContext, LifecycleSteps, PluginContext } from './types'

export const name = PLUGIN_NAME

export { Config, ConfigSchema }
export { type LifecycleContext, type LifecycleSteps }
export * from './database/models'
export * from './database/repositories'
export * from './data/cache-store'
export * from './data/manifest'
export * from './data/normalizers'
export * from './data/sync-service'

export const inject = [...INJECTED_SERVICES]

const noOp = () => undefined

function createDefaultLifecycle(ctx: Context): LifecycleSteps {
  return {
    async verifyNativePackages() {
      await Promise.all([
        import('@takumi-rs/core'),
        import('@takumi-rs/helpers'),
      ])
    },
    initializeDatabaseModels: () => registerMaiDatabaseModels(ctx),
    initializeDataCache: noOp,
    initializeProviders: noOp,
    initializeRenderer: noOp,
    initializeServices: noOp,
    initializeRoutes: noOp,
    initializeCommands: noOp,
    cancelSyncTasks: noOp,
    clearWaitingQueue: noOp,
    releaseCallbackState: noOp,
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
  lifecycle: LifecycleSteps = createDefaultLifecycle(ctx as Context),
) {
  assertRequiredServices(ctx)

  const runtime: LifecycleContext = {
    config,
    publicBaseUrl: config.publicBaseUrl || ctx.server?.selfUrl || '',
  }
  const cleanup = createCleanup(lifecycle)
  ctx.on('dispose', cleanup)

  try {
    await lifecycle.verifyNativePackages(runtime)
  } catch {
    await cleanup()
    throw new Error('[mai-plugin] Takumi native packages are unavailable. Reinstall @takumi-rs/core and @takumi-rs/helpers.')
  }

  try {
    await lifecycle.initializeDatabaseModels(runtime)
    await lifecycle.initializeDataCache(runtime)
    await lifecycle.initializeProviders(runtime)
    await lifecycle.initializeRenderer(runtime)
    await lifecycle.initializeServices(runtime)
    await lifecycle.initializeRoutes(runtime)
    await lifecycle.initializeCommands(runtime)
  } catch (error) {
    await cleanup()
    throw error
  }
}

export function apply(ctx: Context, config: Config) {
  return initializePlugin(ctx, config)
}
