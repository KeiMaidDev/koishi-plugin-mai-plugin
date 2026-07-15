import type { Context } from 'koishi'
import { CallbackTokenError } from './callback-store'
import { resolveLxnsCallbackPath } from './lxns-callback'
import { createProxyConfig, type ProxyEndpoint } from './proxy-config'

export interface MaiRouteService {
  completeLxnsOAuth(state: string, code: string): Promise<void>
  createUpdateRedirect(token: string): Promise<string>
  completeDivingFishUpdate(token: string, callbackPath: string): Promise<void>
}

export interface MaiServerRouteOptions {
  service: MaiRouteService
  proxy: ProxyEndpoint
  allowedWahlapHost?: string
  lxnsCallbackPath?: string
}

interface RouteContext {
  method: string
  host: string
  headers: Record<string, string | string[] | undefined>
  url: string
  query: Record<string, string | string[] | undefined>
  params: Record<string, string | undefined>
  status: number
  body: unknown
  type: string
  set(name: string, value: string): void
  redirect(url: string): void
}

type RouteNext = () => Promise<unknown>
type RouteLayer = object
interface ServerRouter {
  stack: RouteLayer[]
  all(
    path: string,
    handler: (context: unknown, next: RouteNext) => unknown,
  ): unknown
}

function queryValue(value: string | string[] | undefined, maxLength: number) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : null
}

function allowGet(ctx: RouteContext) {
  if (ctx.method === 'GET') return true
  ctx.set('Allow', 'GET')
  ctx.status = 405
  ctx.body = 'Method Not Allowed'
  return false
}

function parsedHostname(host: string) {
  try {
    const parsed = new URL(`http://${host}`)
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      return null
    }
    return parsed.hostname.toLocaleLowerCase()
  } catch {
    return null
  }
}

function validRawHost(value: string | string[] | undefined) {
  if (typeof value !== 'string' || !value || value.length > 260) return false
  return !/[\s@/?#\\]/u.test(value)
}

function callbackFailure(ctx: RouteContext, error: unknown) {
  if (error instanceof CallbackTokenError) {
    ctx.status = 400
    ctx.body = 'Invalid or expired callback token.'
    return
  }
  ctx.status = 502
  ctx.body = 'Callback processing failed.'
}

export function registerMaiServerRoutes(
  ctx: Context,
  options: MaiServerRouteOptions,
) {
  const router = (ctx as Context & { server: ServerRouter }).server
  const previousLayers = new Set(router.stack)
  const allowedWahlapHost = (options.allowedWahlapHost ?? 'tgk-wcaime.wahlap.com').toLocaleLowerCase()
  const lxnsCallbackPath = resolveLxnsCallbackPath(options.lxnsCallbackPath)

  router.all(lxnsCallbackPath, async (routeContext: unknown) => {
    const route = routeContext as unknown as RouteContext
    if (!allowGet(route)) return
    const state = queryValue(route.query.state, 128)
    const code = queryValue(route.query.code, 2_048)
    if (!state || !code) {
      route.status = 400
      route.body = 'Missing state or code.'
      return
    }
    try {
      await options.service.completeLxnsOAuth(state, code)
      route.status = 200
      route.body = '绑定成功，您可以返回继续使用相关功能了。'
    } catch (error) {
      callbackFailure(route, error)
    }
  })

  router.all('/mai-plugin/update', async (routeContext: unknown) => {
    const route = routeContext as unknown as RouteContext
    if (!allowGet(route)) return
    const token = queryValue(route.query.token, 128)
    if (!token) {
      route.status = 400
      route.body = 'Missing token.'
      return
    }
    try {
      route.redirect(await options.service.createUpdateRedirect(token))
    } catch (error) {
      callbackFailure(route, error)
    }
  })

  router.all('/mai-plugin/proxy-config/:type', async (routeContext: unknown) => {
    const route = routeContext as unknown as RouteContext
    if (!allowGet(route)) return
    const generated = createProxyConfig(route.params.type ?? '', options.proxy)
    if (!generated) {
      route.status = 404
      route.body = 'Unknown proxy configuration type.'
      return
    }
    route.status = 200
    route.type = generated.contentType
    route.body = generated.body
  })

  router.all('/wc_auth/oauth/callback/maimai-dx', async (routeContext: unknown, next: RouteNext) => {
    const route = routeContext as unknown as RouteContext
    const rawHost = typeof route.headers.host === 'string' ? route.headers.host : ''
    if (!validRawHost(rawHost)
      || parsedHostname(rawHost) !== allowedWahlapHost
      || parsedHostname(route.host) !== allowedWahlapHost) {
      await next()
      return
    }
    if (!allowGet(route)) return
    const token = queryValue(route.query.token, 128)
    if (!token) {
      route.status = 400
      route.body = 'Missing token.'
      return
    }
    try {
      await options.service.completeDivingFishUpdate(token, route.url)
      route.status = 200
      route.body = 'BOT正在更新中，您可以关闭此页面了。'
    } catch (error) {
      callbackFailure(route, error)
    }
  })

  const layers = router.stack.filter(layer => !previousLayers.has(layer))
  let disposed = false
  return {
    dispose() {
      if (disposed) return
      disposed = true
      for (const layer of layers) {
        const index = router.stack.indexOf(layer)
        if (index >= 0) router.stack.splice(index, 1)
      }
    },
  }
}
