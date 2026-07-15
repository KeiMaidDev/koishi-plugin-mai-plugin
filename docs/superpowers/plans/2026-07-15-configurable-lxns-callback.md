# Configurable LXNS Callback Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let administrators configure the LXNS OAuth callback path while preserving the existing default and printing the effective callback URL at startup.

**Architecture:** A focused `src/server/lxns-callback.ts` module owns the default path and strict validation. The Config Schema, OAuth service, route registration, and default lifecycle all consume that shared resolver so the registered route and OAuth `redirect_uri` cannot diverge.

**Tech Stack:** TypeScript, Schemastery, Koishi server, Vitest

## Global Constraints

- Keep `/mai-plugin/lxns/callback` as the default.
- Keep `Config.oauth.callbackPath` optional for direct API backward compatibility.
- Reject invalid configured paths; never silently replace an invalid explicit value.
- Log only the public callback URL, never OAuth secrets, codes, state, or tokens.
- Keep `task.md` untracked and untouched.

---

### Task 1: Share and apply the configurable callback path

**Files:**
- Create: `src/server/lxns-callback.ts`
- Modify: `src/config.ts`
- Modify: `src/services/update-service.ts`
- Modify: `src/server/routes.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/plugin.spec.ts`
- Test: `tests/integration/server-routes.spec.ts`

**Interfaces:**
- Produces: `DEFAULT_LXNS_CALLBACK_PATH`, `LXNS_CALLBACK_PATH_PATTERN`, and `resolveLxnsCallbackPath(value?: string): string`.
- Consumes: optional `Config.oauth.callbackPath` and optional `MaiServerRouteOptions.lxnsCallbackPath`.

- [ ] **Step 1: Add failing validation, Schema, OAuth, and route tests**

Add tests that require:

```ts
expect(resolveLxnsCallbackPath()).toBe('/mai-plugin/lxns/callback')
expect(resolveLxnsCallbackPath('/lxns/callback')).toBe('/lxns/callback')

for (const path of ['', 'lxns/callback', '/lxns//callback', '/lxns/../callback',
  '/lxns/callback?source=x', '/lxns/:provider']) {
  expect(() => resolveLxnsCallbackPath(path)).toThrow('Invalid LXNS OAuth callback path')
}
```

Extend the Schema assertion with:

```ts
const callbackPath = resolve(oauth.callbackPath)
expect(callbackPath.meta).toMatchObject({ default: '/mai-plugin/lxns/callback' })
expect(callbackPath.meta?.pattern?.source).toBeTruthy()
```

Add an UpdateService case whose OAuth options contain `callbackPath: '/lxns/callback'`; assert both authorization and token exchange use `https://bot.example/lxns/callback`.

Add a server route case that disposes the default registration, registers with `lxnsCallbackPath: '/lxns/callback'`, and asserts the custom route returns 200 while `/mai-plugin/lxns/callback` returns 404.

- [ ] **Step 2: Run focused tests and verify the red state**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm test -- tests/integration/plugin.spec.ts tests/integration/server-routes.spec.ts --maxWorkers=1 --reporter=verbose
```

Expected: FAIL because the callback resolver and Schema field do not exist.

- [ ] **Step 3: Implement the shared path resolver**

Create `src/server/lxns-callback.ts`:

```ts
export const DEFAULT_LXNS_CALLBACK_PATH = '/mai-plugin/lxns/callback'
export const LXNS_CALLBACK_PATH_PATTERN = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/u

export function resolveLxnsCallbackPath(value?: string) {
  const path = value === undefined ? DEFAULT_LXNS_CALLBACK_PATH : value
  if (!LXNS_CALLBACK_PATH_PATTERN.test(path)) {
    throw new Error(`Invalid LXNS OAuth callback path: ${path}`)
  }
  return path
}
```

- [ ] **Step 4: Add the optional Config field and Schema entry**

Add `callbackPath?: string` to `Config.oauth`. Add this field after `enabled` in the Schema:

```ts
callbackPath: Schema.string()
  .pattern(LXNS_CALLBACK_PATH_PATTERN)
  .default(DEFAULT_LXNS_CALLBACK_PATH)
  .description('LXNS OAuth 回调路径。完整地址为“publicBaseUrl 或 Koishi Server selfUrl”加上此路径。'),
```

Import the constants from `./server/lxns-callback`.

- [ ] **Step 5: Use the resolver in OAuth and route registration**

In `UpdateServiceOptions.oauth`, add `callbackPath?: string`. Export and use:

```ts
export function lxnsCallbackUrl(publicUrl: string, callbackPath?: string) {
  return publicRoute(publicUrl, resolveLxnsCallbackPath(callbackPath))
}
```

Both `beginLxnsOAuth()` and `completeLxnsOAuth()` must call `lxnsCallbackUrl(this.options.publicBaseUrl, this.options.oauth.callbackPath)`.

In `MaiServerRouteOptions`, add `lxnsCallbackPath?: string`, resolve it before registering routes, and replace the hard-coded route with the resolved value. In the default lifecycle, pass `runtime.config.oauth.callbackPath` as `lxnsCallbackPath`.

Export `src/server/lxns-callback.ts` from `src/index.ts`.

- [ ] **Step 6: Run focused tests and verify the green state**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm test -- tests/integration/plugin.spec.ts tests/integration/server-routes.spec.ts --maxWorkers=1 --reporter=verbose
```

Expected: both test files pass.

---

### Task 2: Report the effective callback URL at startup

**Files:**
- Modify: `src/index.ts`
- Test: `tests/integration/server-routes.spec.ts`

**Interfaces:**
- Consumes: `lxnsCallbackUrl(publicUrl, callbackPath)` from Task 1.
- Produces: one info or warning log when default lifecycle route initialization runs with OAuth enabled.

- [ ] **Step 1: Add failing lifecycle log assertions**

Extend the existing default lifecycle route test by spying on `app.logger(PLUGIN_NAME)` and using `/lxns/callback`. Require an info message containing:

```text
https://bot.example:8443/lxns/callback
```

Add a case with OAuth enabled and an empty runtime `publicBaseUrl`; require a warning mentioning `publicBaseUrl` or `selfUrl`. Assert joined log output does not contain `clientSecret`, `tokenCipherKey`, `code`, `state`, or configured secret values.

- [ ] **Step 2: Run the lifecycle test and verify the red state**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm test -- tests/integration/server-routes.spec.ts --maxWorkers=1 --reporter=verbose
```

Expected: FAIL because route initialization does not log the callback URL.

- [ ] **Step 3: Add startup callback logging**

After successful route registration in `createDefaultLifecycle().initializeRoutes()`:

```ts
if (runtime.config.oauth.enabled) {
  const logger = ctx.logger(PLUGIN_NAME)
  try {
    logger.info(`LXNS OAuth 回调地址：${lxnsCallbackUrl(
      runtime.publicBaseUrl,
      runtime.config.oauth.callbackPath,
    )}`)
  } catch (error) {
    if (!(error instanceof PublicCallbackUnavailableError)) throw error
    logger.warn('LXNS OAuth 已启用，但未配置 publicBaseUrl 或 Koishi Server selfUrl。')
  }
}
```

Import `PublicCallbackUnavailableError` and `lxnsCallbackUrl` from `./services/update-service` if they are not already in the import list.

- [ ] **Step 4: Run focused and full verification**

```powershell
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm test -- tests/integration/server-routes.spec.ts --maxWorkers=1 --reporter=verbose
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm test -- --maxWorkers=1 --reporter=dot
$env:NODE_OPTIONS='--max-old-space-size=2048'; npm run build
```

Expected: all focused tests pass, the complete suite has no failures, and TypeScript/Vite build successfully.

- [ ] **Step 5: Commit the implementation**

```powershell
git add -- src/server/lxns-callback.ts src/config.ts src/services/update-service.ts src/server/routes.ts src/index.ts tests/integration/plugin.spec.ts tests/integration/server-routes.spec.ts
git commit -m "feat: make LXNS callback path configurable"
```

