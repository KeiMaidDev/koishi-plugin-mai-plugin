import type { Context } from 'koishi'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ConfigSchema,
  inject,
  initializePlugin,
  type Config,
  type LifecycleContext,
  type LifecycleSteps,
} from '../../src'

const config: Config = {
  developerTokens: {
    divingFish: '',
    lxns: '',
  },
  oauth: {
    enabled: false,
    clientId: '',
    clientSecret: '',
    tokenCipherKey: '',
  },
  resourceSync: {
    enabled: true,
    intervalMinutes: 60,
    timeoutMs: 10_000,
    cacheDir: 'data/maimai',
    staticBaseUrl: '',
    allowedHosts: [],
  },
  render: {
    concurrency: 4,
    queueLimit: 64,
    timeoutMs: 30_000,
  },
  publicBaseUrl: '',
  administrators: [],
  compatibilityMode: false,
}

function createContext(services: { database?: object, server?: { selfUrl?: string } } = {}) {
  const disposeHandlers: Array<() => void | Promise<void>> = []
  const context = {
    database: services.database,
    server: services.server,
    on(event: string, handler: () => void | Promise<void>) {
      if (event === 'dispose') disposeHandlers.push(handler)
    },
  } as unknown as Context

  return { context, disposeHandlers }
}

function createLifecycleSteps(calls: string[], overrides: Partial<LifecycleSteps> = {}): LifecycleSteps {
  return {
    verifyNativePackages: () => calls.push('native-packages'),
    initializeDatabaseModels: () => calls.push('database-models'),
    initializeDataCache: () => calls.push('data-cache'),
    initializeProviders: () => calls.push('providers'),
    initializeRenderer: () => calls.push('renderer'),
    initializeServices: () => calls.push('services'),
    initializeRoutes: () => calls.push('routes'),
    initializeCommands: () => calls.push('commands'),
    cancelSyncTasks: () => calls.push('cancel-sync-tasks'),
    clearWaitingQueue: () => calls.push('clear-waiting-queue'),
    releaseCallbackState: () => calls.push('release-callback-state'),
    ...overrides,
  }
}

describe('maimai plugin lifecycle', () => {
  it('pins the native renderer and requires a supported Node runtime', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    )
    const dependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    }

    expect(packageJson.engines.node).toBe('>=18')
    expect(packageJson.devDependencies['@types/node']).toMatch(/^\^18\./)
    expect(packageJson.devDependencies.vitest).toBe('3.2.6')
    expect(packageJson.devDependencies.vite).toBe('6.4.3')
    expect(packageJson.dependencies['@takumi-rs/core']).toBe('2.1.1')
    expect(packageJson.dependencies['@takumi-rs/helpers']).toBe('2.1.1')
    expect(Object.keys(dependencies).filter(name => /puppeteer|playwright|chromium/i.test(name)))
      .toEqual([])
  })

  it('declares its required Koishi services', () => {
    expect(inject).toEqual(['database', 'server'])
  })

  it('exposes secure defaults and renderer bounds through the Koishi schema', () => {
    const schema = ConfigSchema.toJSON()
    const resolve = (uid: number) => schema.refs[uid]
    const object = resolve(schema.uid).dict
    const developerTokens = resolve(object.developerTokens).dict
    const oauth = resolve(object.oauth).dict
    const render = resolve(object.render).dict

    expect(resolve(developerTokens.divingFish).meta?.role).toBe('secret')
    expect(resolve(developerTokens.lxns).meta?.role).toBe('secret')
    expect(resolve(oauth.clientSecret).meta?.role).toBe('secret')
    expect(resolve(render.concurrency).meta).toMatchObject({ default: 4, min: 1, max: 16 })
    expect(resolve(render.queueLimit).meta).toMatchObject({ default: 64, min: 1 })
    expect(resolve(render.timeoutMs).meta).toMatchObject({ default: 30_000, min: 1_000 })
  })

  it.each([
    ['database', { server: {} }],
    ['server', { database: {} }],
  ])('rejects startup when %s is unavailable', async (service, services) => {
    const { context } = createContext(services)

    await expect(initializePlugin(context, config, createLifecycleSteps([])))
      .rejects.toThrow(`required Koishi service "${service}" is unavailable`)
  })

  it('reports an unavailable Takumi native package without exposing details', async () => {
    const { context } = createContext({ database: {}, server: {} })
    const lifecycle = createLifecycleSteps([], {
      verifyNativePackages: () => {
        throw new Error('native module unavailable')
      },
    })

    await expect(initializePlugin(context, config, lifecycle))
      .rejects.toThrow('Takumi native packages are unavailable')
  })

  it('passes the server self URL to lifecycle stages when no public URL is configured', async () => {
    const received: LifecycleContext[] = []
    const { context } = createContext({ database: {}, server: { selfUrl: 'https://server.example' } })
    const lifecycle = createLifecycleSteps([], {
      initializeServices: runtime => received.push(runtime),
      initializeRoutes: runtime => received.push(runtime),
    })

    await initializePlugin(context, config, lifecycle)

    expect(received).toHaveLength(2)
    expect(received[0].publicBaseUrl).toBe('https://server.example')
    expect(received[0].config).toBe(config)
    expect(received[1]).toBe(received[0])
  })

  it('passes the explicit public URL to lifecycle stages over the server self URL', async () => {
    const received: LifecycleContext[] = []
    const explicitConfig = { ...config, publicBaseUrl: 'https://public.example' }
    const { context } = createContext({ database: {}, server: { selfUrl: 'https://server.example' } })
    const lifecycle = createLifecycleSteps([], {
      initializeServices: runtime => received.push(runtime),
    })

    await initializePlugin(context, explicitConfig, lifecycle)

    expect(received[0].publicBaseUrl).toBe('https://public.example')
    expect(received[0].config).toBe(explicitConfig)
  })

  it('initializes and disposes lifecycle seams in the required order', async () => {
    const calls: string[] = []
    const { context, disposeHandlers } = createContext({ database: {}, server: {} })

    await initializePlugin(context, config, createLifecycleSteps(calls))
    expect(disposeHandlers).toHaveLength(1)

    await disposeHandlers[0]()

    expect(calls).toEqual([
      'native-packages',
      'database-models',
      'data-cache',
      'providers',
      'renderer',
      'services',
      'routes',
      'commands',
      'cancel-sync-tasks',
      'clear-waiting-queue',
      'release-callback-state',
    ])
  })

  it('attempts every cleanup step when one disposer fails', async () => {
    const calls: string[] = []
    const { context, disposeHandlers } = createContext({ database: {}, server: {} })
    const lifecycle = createLifecycleSteps(calls, {
      cancelSyncTasks: () => {
        calls.push('cancel-sync-tasks')
        throw new Error('sync cleanup failed')
      },
    })

    await initializePlugin(context, config, lifecycle)
    await expect(disposeHandlers[0]()).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: 'sync cleanup failed' })],
    })

    expect(calls.slice(-3)).toEqual([
      'cancel-sync-tasks',
      'clear-waiting-queue',
      'release-callback-state',
    ])
  })

  it('cleans up partial startup exactly once before a later dispose', async () => {
    const calls: string[] = []
    const { context, disposeHandlers } = createContext({ database: {}, server: {} })
    const lifecycle = createLifecycleSteps(calls, {
      initializeProviders: () => {
        calls.push('providers')
        throw new Error('provider initialization failed')
      },
    })

    await expect(initializePlugin(context, config, lifecycle))
      .rejects.toThrow('provider initialization failed')

    expect(calls).toEqual([
      'native-packages',
      'database-models',
      'data-cache',
      'providers',
      'cancel-sync-tasks',
      'clear-waiting-queue',
      'release-callback-state',
    ])

    await disposeHandlers[0]()

    expect(calls).toEqual([
      'native-packages',
      'database-models',
      'data-cache',
      'providers',
      'cancel-sync-tasks',
      'clear-waiting-queue',
      'release-callback-state',
    ])
  })
})
