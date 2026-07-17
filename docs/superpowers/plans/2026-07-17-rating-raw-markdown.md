# Rating Raw Markdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send every B15/B25/B35/B40/B50 Rating result as a QQ Raw Markdown image backed by Koishi Assets, with actual PNG dimensions and a consistent three-button keyboard.

**Architecture:** A focused platform helper converts a PNG Buffer into an Assets-backed Markdown image element using `sharp` metadata and structured Koishi element parsing. The reply layer selects this rich path only for non-compatibility QQ sessions and falls back to the existing image reply on preparation failure. The Rating command supplies the dynamic B label, self-query command, and keyboard without changing renderer interfaces.

**Tech Stack:** TypeScript, Koishi 4, `@satorijs/element`, Koishi Assets public `transform()` API, `sharp`, QQ Raw Markdown, inline Node assertions, root Koishi build.

## Global Constraints

- Apply the Raw Markdown image flow to B15, B25, B35, B40, and B50, including filtered and targeted Rating queries.
- Derive width and height from final PNG metadata; do not use template constants.
- Call only the public Assets `transform(content)` API; do not call `upload()`.
- Keep Assets optional and fall back to the existing ordinary PNG reply on missing service, transform failure, malformed transformed content, invalid URL, or invalid dimensions.
- Do not call Assets for non-QQ sessions or compatibility mode.
- Raw Markdown must contain the transformed image URL and must not also send the Buffer image.
- Keyboard labels are exactly `我也要查`, `成绩列表`, and `查分设置`.
- Preserve filters and B count in `我也要查`, but remove the original query target.
- Every button uses permission type `2`, `reply: false`, and `enter: true`.
- Do not add package scripts, engines, Vitest, vite-node, TypeScript, `@types/node`, or plugin-local test tooling.
- Final compilation runs `yarn build` from `C:\koishi-app` and waits beyond the Vite CJS deprecation warning.

---

### Task 1: Assets-Backed Markdown Image Helper

**Files:**
- Create: `src/platform/qq-markdown-image.ts`
- Modify: `src/commands/support.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Produces: `AssetTransformer` with `transform(content: string): Promise<string>`.
- Produces: `createQqMarkdownImageContent(url, width, height, alt): string` for pure validation and Markdown serialization.
- Produces: `createQqMarkdownImage(options): Promise<h>` for validated image Markdown construction.
- Produces: `replyMarkdownImage(session, dependencies, image, options): Promise<void>` with ordinary-image fallback.
- Adds optional `assetTransformer` to `CoreCommandDependencies`.

- [ ] **Step 1: Run a failing API assertion**

Build the current plugin and run:

```powershell
@'
const assert = require('node:assert/strict')
const plugin = require('./lib')
assert.equal(plugin.createQqMarkdownImage, undefined)
assert.equal(plugin.replyMarkdownImage, undefined)
console.log('RED: markdown image APIs are absent')
'@ | node -
```

Expected: exit 0 and both APIs absent.

- [ ] **Step 2: Implement structured Assets transformation**

Create `src/platform/qq-markdown-image.ts` with these public types:

```ts
export interface AssetTransformer {
  transform(content: string): Promise<string>
}

export interface QqMarkdownImageOptions {
  image: Buffer | Uint8Array
  alt: string
  keyboard: QqKeyboard
  assets: AssetTransformer
}
```

`createQqMarkdownImage()` must:

1. Convert the image to `Buffer` and call `sharp(buffer).metadata()`.
2. Require positive integer `width` and `height`.
3. Call `assets.transform(h.image(buffer, 'image/png').toString())`.
4. Parse with `h.parse()` and require exactly one top-level `img` element with no additional non-empty text/elements.
5. Read `attrs.src`, parse it with `new URL()`, require `http:` or `https:`, and reject credentials.
6. Call `createQqMarkdownImageContent()` and return `createQqNativeMarkdown(content, keyboard)`.

`createQqMarkdownImageContent()` must require positive integer dimensions, require `alt` to match `/^B(?:15|25|35|40|50)$/`, parse an absolute `http:` or `https:` URL without credentials, percent-encode literal `(` and `)` in its serialized URL, and return `![${alt} #${width}px #${height}px](${url})`.

Throw `TypeError` for malformed transform output or URL and `RangeError` for invalid dimensions. Do not catch inside this function.

- [ ] **Step 3: Add optional service wiring and reply fallback**

Change the exported plugin injection to:

```ts
export const inject = {
  required: [...INJECTED_SERVICES],
  optional: ['assets'],
}
```

In `createDefaultCommandDependencies()`, access `ctx.assets` through a local structural type and expose a bound narrow wrapper only when `transform` is a function:

```ts
assetTransformer: typeof assets?.transform === 'function'
  ? { transform: content => assets.transform(content) }
  : undefined,
```

Add `assetTransformer?: AssetTransformer` to `CoreCommandDependencies`.

Add `replyMarkdownImage()` to `support.ts`. It accepts `{ alt, keyboard }`, checks QQ platform, compatibility mode, and `assetTransformer` before preparing rich output. On an ineligible session or any error from `createQqMarkdownImage()`, send the ordinary image exactly once. On success call `sendReply()` directly with an image fallback and the Raw Markdown rich element, so QQ receives only Raw Markdown while fallback platforms receive only the Buffer image. Do not catch errors from the final `sendReply()` call.

- [ ] **Step 4: Build and run helper assertions**

Run `yarn build` from `C:\koishi-app`, then use a generated 3x2 PNG and fake transformer to assert:

```js
assert.equal(markdown.attrs.markdown.content, '![B15 #3px #2px](https://assets.example/a%28b%29.png)')
assert.match(transformInput, /^<img src="data:image\/png;base64,[A-Za-z0-9+/=]+"\/>$/)
assert.equal(markdown.attrs.keyboard, keyboard)
```

Also assert `createQqMarkdownImageContent()` rejects invalid alt text, zero, negative, fractional, and missing dimensions, relative URL, `file:` URL, and credential URL. Assert `createQqMarkdownImage()` rejects multiple transformed elements and transform output without an image, and treats a corrupt PNG as a preparation failure.

Using fake sessions, assert Assets is not called for non-QQ and compatibility mode, transform failures send one ordinary image, and successful QQ preparation sends one `qq:rawmarkdown` element without a sibling Buffer image.

- [ ] **Step 5: Commit helper and wiring**

```powershell
git add src/platform/qq-markdown-image.ts src/commands/support.ts src/index.ts
git commit -m "feat: add Assets-backed Markdown images"
```

### Task 2: Rating Keyboard and Dynamic Self-Query

**Files:**
- Modify: `src/commands/image.ts`

**Interfaces:**
- Consumes: `replyMarkdownImage(session, dependencies, image, { alt, keyboard })`.
- Produces: exported `ratingSelfQueryCommand(filterText, total)` and `createRatingKeyboard(filterText, total)`.

- [ ] **Step 1: Run a failing command-builder assertion**

After Task 1 is built, run:

```powershell
@'
const assert = require('node:assert/strict')
const plugin = require('./lib')
assert.equal(plugin.ratingSelfQueryCommand, undefined)
assert.equal(plugin.createRatingKeyboard, undefined)
console.log('RED: Rating keyboard APIs are absent')
'@ | node -
```

Expected: exit 0 and both APIs absent.

- [ ] **Step 2: Implement dynamic commands and keyboard**

Implement:

```ts
export function ratingSelfQueryCommand(filterText: string, total: number) {
  if (![15, 25, 35, 40, 50].includes(total)) throw new RangeError('Unsupported Rating count.')
  const filter = filterText.trim()
  return `/mai ${filter ? `${filter} ` : ''}b${total}`
}
```

`createRatingKeyboard()` returns one row with exactly these buttons:

```ts
[
  { id: `rating-self-b${total}`, label: '我也要查', command: ratingSelfQueryCommand(filterText, total) },
  { id: 'rating-score-list', label: '成绩列表', command: '/mai 分数列表' },
  { id: 'rating-settings', label: '查分设置', command: '/mai 查分设置' },
]
```

Build them with existing QQ button/action helpers. Every action uses `enter: true`; helper defaults must produce permission type `2` and `reply: false`.

- [ ] **Step 3: Route every Rating result through the rich reply**

Replace both successful `replyImage()` calls in `mai.rating` with:

```ts
await replyMarkdownImage(session, dependencies, image, {
  alt: `B${total}`,
  keyboard: createRatingKeyboard(filterText, total),
})
```

Constructing the self-query command only from `filterText` and `total` intentionally excludes `target` and mentions. Do not change score-list or any other image command.

- [ ] **Step 4: Build and run Rating matrix assertions**

Run `yarn build` from `C:\koishi-app`. Assert command outputs for all totals:

```js
for (const total of [15, 25, 35, 40, 50]) {
  assert.equal(ratingSelfQueryCommand('', total), `/mai b${total}`)
  assert.equal(ratingSelfQueryCommand('舞萌', total), `/mai 舞萌 b${total}`)
}
```

Assert `/mai b40 @用户` derives `/mai b40` and `/mai 舞萌 b50 @用户` derives `/mai 舞萌 b50` by invoking the registered Rating action with fake query/renderer/reply dependencies. Inspect all three buttons for exact labels, commands, `enter: true`, `reply: false`, and permission type `2`. Assert both filtered and unfiltered Rating paths call `assetTransformer`, while a score-list action does not use the new helper.

- [ ] **Step 5: Commit Rating integration**

```powershell
git add src/commands/image.ts
git commit -m "feat: send Rating images with Raw Markdown"
```

### Task 3: Documentation and Final Acceptance

**Files:**
- Modify: `readme.md`
- Verify: `package.json`

**Interfaces:**
- Consumes all prior tasks.
- Produces documented optional Assets behavior and a clean buildable plugin.

- [ ] **Step 1: Document Rating image requirements**

In `readme.md`, add a concise note that QQ Rating images use the optional Koishi Assets service to obtain permanent public URLs. State that the plugin reads actual PNG dimensions, emits a three-button Raw Markdown keyboard, and falls back to ordinary PNG replies when Assets is unavailable or conversion fails.

- [ ] **Step 2: Run the full clean build**

```powershell
Set-Location C:\koishi-app
$env:NODE_OPTIONS='--max-old-space-size=256'
yarn clean mai-plugin
yarn build
```

Expected: TypeScript declarations and `external/mai-plugin/lib/index.js` are regenerated; Vite may print its CJS deprecation warning; final exit code is 0.

- [ ] **Step 3: Run complete runtime acceptance**

Against the fresh `lib`, run the Task 1 helper/fallback assertions and Task 2 command/keyboard matrix. Generate PNGs with `sharp` at 3x2 and 7x5 and verify the Markdown dimensions change accordingly. Verify successful rich replies contain one `qq:rawmarkdown` element and zero direct image elements; each failure mode contains one ordinary image and no Raw Markdown.

- [ ] **Step 4: Audit scope and package metadata**

```powershell
Set-Location C:\koishi-app\external\mai-plugin
rg -n "reply:\s*true|permission:\s*\{\s*type:\s*[01]" src
git diff --check
```

Parse `package.json` explicitly as UTF-8 and assert it has no `scripts` or `engines` fields and no test-tool dependencies. Confirm only the planned source and README files changed and `lib/index.js` remains generated for runtime use.

- [ ] **Step 5: Commit documentation**

```powershell
git add readme.md
git commit -m "docs: document Rating Markdown images"
```

- [ ] **Step 6: Record acceptance result**

Report the clean build exit code, dynamic dimension cases, five Rating totals, filtered/targeted command cases, fallback matrix, button audit, package audit, commits, and the residual need to click-test one Assets-backed message in a real QQ client.
