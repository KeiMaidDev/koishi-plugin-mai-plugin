import type { Config } from './config'

export type Awaitable<T> = T | Promise<T>

export interface LifecycleContext {
  config: Config
  publicBaseUrl: string
}

export interface LifecycleSteps {
  verifyNativePackages(context: LifecycleContext): Awaitable<void>
  initializeDatabaseModels(context: LifecycleContext): Awaitable<void>
  initializeDataCache(context: LifecycleContext): Awaitable<void>
  initializeProviders(context: LifecycleContext): Awaitable<void>
  initializeRenderer(context: LifecycleContext): Awaitable<void>
  initializeServices(context: LifecycleContext): Awaitable<void>
  initializeRoutes(context: LifecycleContext): Awaitable<void>
  initializeCommands(context: LifecycleContext): Awaitable<void>
  cancelSyncTasks(): Awaitable<void>
  clearWaitingQueue(): Awaitable<void>
  releaseCallbackState(): Awaitable<void>
}

export interface PluginContext {
  database?: unknown
  server?: { selfUrl?: string }
  on(event: 'dispose', listener: () => Awaitable<void>): unknown
}
