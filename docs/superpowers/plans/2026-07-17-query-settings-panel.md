# Query Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Raw Markdown `/mai 查分设置` panel that displays current query settings and provides live avatar, plate, provider, LXNS binding, and Diving Fish binding controls.

**Architecture:** Repository and provider methods expose binding presence without leaking tokens. `UpdateService` combines both providers into one binding-status port and owns unbinding. `settings.ts` builds a pure panel model from settings plus binding status, then sends it through the existing QQ Raw Markdown keyboard helper.

**Tech Stack:** TypeScript, Koishi 4 commands and database API, `@satorijs/element`, existing QQ Raw Markdown helpers, inline Node assertions, root Koishi build.

## Global Constraints

- Do not add package scripts, Vitest, vite-node, TypeScript, `@types/node`, or plugin-local test tooling.
- All command button actions must use `reply: false` and unrestricted permission `{ type: 2 }` through the existing QQ helper.
- Avatar and plate buttons fill editable commands with `enter: false`; provider switches and unbind buttons use `enter: true`.
- Both LXNS and Diving Fish binding buttons are always present and independently reflect current binding state.
- Preserve `/mai 设置mai` and `/mai 设置b50` as aliases for the same panel.
- Final compilation must run `yarn build` from `C:\koishi-app` and wait beyond the Vite CJS deprecation warning.

---

### Task 1: Binding Status and Diving Fish Unbind Service

**Files:**
- Modify: `src/database/repositories.ts`
- Modify: `src/providers/lxns.ts`
- Modify: `src/services/update-service.ts`

**Interfaces:**
- Produces: `BindRepository.hasImportToken(id): Promise<boolean>` and `removeImportToken(id): Promise<void>`.
- Produces: `OAuthRepository.exists(userId, provider?): Promise<boolean>`.
- Produces: `LxnsProvider.hasOAuthToken(userId): Promise<boolean>`.
- Produces: `UpdateService.getBindingStatus(userId): Promise<{ lxns: boolean; divingFish: boolean }>` and `unbindDivingFish(userId): Promise<void>`.

- [ ] **Step 1: Run a failing inline assertion for repository and service API presence**

Build the current plugin, then run:

```powershell
@'
const assert = require('node:assert/strict')
const plugin = require('./lib')
assert.equal(typeof plugin.BindRepository.prototype.hasImportToken, 'function')
assert.equal(typeof plugin.BindRepository.prototype.removeImportToken, 'function')
assert.equal(typeof plugin.OAuthRepository.prototype.exists, 'function')
assert.equal(typeof plugin.LxnsProvider.prototype.hasOAuthToken, 'function')
assert.equal(typeof plugin.UpdateService.prototype.getBindingStatus, 'function')
assert.equal(typeof plugin.UpdateService.prototype.unbindDivingFish, 'function')
'@ | node -
```

Expected: FAIL because at least `hasImportToken` is undefined.

- [ ] **Step 2: Add token-presence and removal methods**

Add these methods to `BindRepository`:

```ts
async hasImportToken(id: string) {
  return Boolean(await this.getImportToken(id))
}

async removeImportToken(id: string) {
  await this.ctx.database.remove('mai_diving_fish_bind', { id })
}
```

Add this method to `OAuthRepository` without decrypting token contents:

```ts
async exists(userId: string, provider: 'lxns' = 'lxns') {
  const rows = await this.ctx.database.get('mai_oauth_token', { userId, provider }, ['userId'])
  return rows.length > 0
}
```

Add this method to `LxnsProvider`:

```ts
async hasOAuthToken(userId: string) {
  return this.repositories.oauth.exists(userId, 'lxns')
}
```

Extend the update-service bind/LXNS ports to include these methods, then add:

```ts
async getBindingStatus(userId: string) {
  const [lxns, divingFish] = await Promise.all([
    this.options.lxns.hasOAuthToken(userId),
    this.options.bind.hasImportToken(userId),
  ])
  return { lxns, divingFish }
}

async unbindDivingFish(userId: string) {
  this.assertActive()
  await this.options.bind.removeImportToken(userId)
}
```

- [ ] **Step 3: Build and rerun the API assertion**

Run `yarn build` from `C:\koishi-app`, then rerun Step 1.

Expected: build exits 0 and all six methods are functions.

- [ ] **Step 4: Commit the service layer**

```powershell
git add src/database/repositories.ts src/providers/lxns.ts src/services/update-service.ts
git commit -m "feat: expose query provider binding status"
```

### Task 2: Dynamic Raw Markdown Settings Panel

**Files:**
- Modify: `src/commands/support.ts`
- Modify: `src/commands/settings.ts`

**Interfaces:**
- Consumes: `SettingService.getSettings(userId)` and `UpdateService.getBindingStatus(userId)`.
- Produces: exported `createQuerySettingsPanel(state)` returning `{ text, rich }`.
- Produces: `mai.query-settings` command with `/mai 查分设置`, `/mai 设置mai`, and `/mai 设置b50` shortcuts.

- [ ] **Step 1: Write a failing panel matrix assertion**

After building Task 1, run an inline Node assertion that imports `createQuerySettingsPanel`. For each tuple below, inspect `rich.attrs.keyboard.content.rows[2].buttons`:

```js
const cases = [
  [{ lxns: false, divingFish: false }, ['绑定落雪', '绑定水鱼']],
  [{ lxns: true, divingFish: false }, ['解绑落雪', '绑定水鱼']],
  [{ lxns: false, divingFish: true }, ['绑定落雪', '解绑水鱼']],
  [{ lxns: true, divingFish: true }, ['解绑落雪', '解绑水鱼']],
]
```

Also assert:

```js
assert.equal(rows[0].buttons[0].action.enter, false)
assert.equal(rows[0].buttons[1].action.enter, false)
assert.ok(rows[1].buttons.every(button => button.action.enter === true))
assert.ok(rows.flatMap(row => row.buttons).every(button => button.action.reply === false))
assert.ok(rows.flatMap(row => row.buttons).every(button => button.action.permission.type === 2))
```

Expected: FAIL because `createQuerySettingsPanel` is not exported.

- [ ] **Step 2: Extend command dependency ports**

In `CoreCommandDependencies`, add `getSettings` to the `settingService` pick and add `getBindingStatus` plus `unbindDivingFish` to the optional `updateService` pick.

- [ ] **Step 3: Implement the pure panel builder**

Export a state type containing `provider`, `avatar`, `plate`, `lxns`, and `divingFish`. Build three keyboard rows with `createQqCommandGuidance`:

```ts
const bindingButton = (
  provider: 'lxns' | 'diving-fish',
  bound: boolean,
): QqCommandGuidanceButton => ({
  id: `${bound ? 'unbind' : 'bind'}-${provider}`,
  label: `${bound ? '解绑' : '绑定'}${provider === 'lxns' ? '落雪' : '水鱼'}`,
  command: provider === 'lxns'
    ? `/mai ${bound ? '解绑' : '绑定'}落雪`
    : `/mai ${bound ? '解绑水鱼' : '绑定水鱼 '}`,
  enter: bound || provider === 'lxns',
  reply: false,
})
```

The first row uses `/mai 设置头像 ` and `/mai 设置牌子 ` with `enter: false`. The second row uses the three existing provider commands with `enter: true`. The text includes the five current values and uses “默认” for null avatar/plate.

- [ ] **Step 4: Register the panel command**

Replace the text-only `mai.settings` action with `mai.query-settings`. Add shortcuts for `/mai 查分设置` and the two legacy names. Its action loads both state sources concurrently:

```ts
const [settings, bindings] = await Promise.all([
  dependencies.settingService.getSettings(session.userId),
  dependencies.updateService.getBindingStatus(session.userId),
])
const panel = createQuerySettingsPanel({ ...settings, ...bindings })
await replyText(session, dependencies, panel.text, panel.rich)
```

If `updateService` is unavailable or either read fails, route the error through `settingFailure` and do not send a partial panel.

- [ ] **Step 5: Build and run the four-state panel assertion**

Run `yarn build` from `C:\koishi-app`, then execute the complete matrix from Step 1.

Expected: all four label combinations, `enter` values, `reply: false`, and permission type assertions pass.

- [ ] **Step 6: Commit the panel**

```powershell
git add src/commands/support.ts src/commands/settings.ts
git commit -m "feat: add query settings keyboard panel"
```

### Task 3: Diving Fish Unbind Command and Compatibility Routing

**Files:**
- Modify: `src/commands/update.ts`
- Modify: `src/commands/core.ts`
- Modify: `src/commands/help.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: `UpdateService.unbindDivingFish(userId)`.
- Produces: `mai.unbind-diving-fish` and compatibility routing for `查分设置` and `解绑水鱼`.

- [ ] **Step 1: Run failing compatibility assertions**

```powershell
@'
const assert = require('node:assert/strict')
const { resolveCompatibilityExecution } = require('./lib')
assert.equal(resolveCompatibilityExecution('查分设置'), 'mai.query-settings')
assert.equal(resolveCompatibilityExecution('设置mai'), 'mai.query-settings')
assert.equal(resolveCompatibilityExecution('设置b50'), 'mai.query-settings')
assert.equal(resolveCompatibilityExecution('解绑水鱼'), 'mai.unbind-diving-fish')
'@ | node -
```

Expected: FAIL for `查分设置` and `解绑水鱼`.

- [ ] **Step 2: Add the unbind command**

Extend `UpdateServicePort` with `getBindingStatus` and `unbindDivingFish`. Register:

```ts
ctx.command('mai.unbind-diving-fish', '解绑水鱼导入 Token')
  .shortcut(/^\/mai\s+(?:解绑水鱼|unbind-diving-fish)$/iu)
  .action(commandAction(async ({ session }) => {
    try {
      await dependencies.updateService.unbindDivingFish(session.userId)
      await replyText(session, dependencies, '水鱼查分器解绑成功。')
    } catch (error) {
      await updateFailure(session, dependencies, error, '/mai 解绑水鱼')
    }
  }))
```

- [ ] **Step 3: Extend compatibility command routing**

Add exact compatibility patterns and map:

```ts
if (/^(?:查分设置|设置mai|设置b50)$/i.test(normalized)) return 'mai.query-settings'
if (/^解绑水鱼$/.test(normalized)) return 'mai.unbind-diving-fish'
```

Remove the old mapping to `mai.settings`.

- [ ] **Step 4: Update README command documentation**

Change the help keyboard's settings button label to `查分设置` and command to `/mai 查分设置`. Document `/mai 查分设置` as the central settings panel, retain the two legacy aliases, and list `/mai 解绑水鱼` next to existing bind/unbind commands.

- [ ] **Step 5: Build and verify compatibility routing**

Run `yarn build` from `C:\koishi-app`, rerun Step 1, and verify it exits 0.

- [ ] **Step 6: Commit command routing and docs**

```powershell
git add src/commands/update.ts src/commands/core.ts src/commands/help.ts README.md
git commit -m "feat: add provider binding controls"
```

### Task 4: Final Acceptance

**Files:**
- Verify only; no planned source changes.

**Interfaces:**
- Consumes all prior tasks.
- Produces a clean, buildable plugin on `master`.

- [ ] **Step 1: Run the full clean build**

```powershell
Set-Location C:\koishi-app
$env:NODE_OPTIONS='--max-old-space-size=256'
yarn clean mai-plugin
yarn build
```

Expected: Vite may print its CJS deprecation warning; after waiting, TypeScript and esbuild finish with exit code 0 and recreate `external/mai-plugin/lib/index.js`.

- [ ] **Step 2: Run the complete runtime assertion set**

Run the Task 1 API-presence assertions, Task 2 four-state keyboard matrix, and Task 3 compatibility routing assertions against the freshly generated `lib`.

Expected: every assertion passes and every keyboard command action has `reply: false` with permission type `2`.

- [ ] **Step 3: Audit all button actions and repository diff**

```powershell
Set-Location C:\koishi-app\external\mai-plugin
rg -n "reply:\s*true|permission:\s*\{\s*type:\s*[01]" src
git diff --check
git status --short
```

Expected: no restricted command buttons or `reply: true`, no whitespace errors, and only intentional files are modified.

- [ ] **Step 4: Record acceptance result**

Report the build exit code, runtime assertion results, button audit result, resulting commits, and any residual manual QQ-client verification requirement.
