# Remote Alias Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate a persistent local base-alias cache from LXNS when no valid cache exists, then merge those aliases into song search without touching user aliases or votes.

**Architecture:** A dedicated alias-cache module owns strict remote/cache parsing, fixed-host downloading, limits, atomic persistence, and non-blocking fallback. `MaimaiDataSyncService` enriches each completed data store with remote aliases, while `AliasService` merges titles, remote aliases, and approved user aliases at document construction time. Remote aliases never enter Koishi database tables.

**Tech Stack:** TypeScript, Koishi 4, Node filesystem, existing `CacheStore`, LXNS alias API, existing search normalization and debug tracer, inline Node assertions, root Koishi build.

## Global Constraints

- Fetch only when `resourceSync.cacheDir/aliases.json` is missing, malformed, or contains no valid aliases.
- Use only `https://maimai.lxns.net/api/v0/maimai/alias/list`; do not guess a Diving Fish endpoint.
- Keep remote aliases separate from `mai_alias` and `mai_alias_vote`.
- Valid local cache wins and prevents network access.
- Remote/cache failures must not block plugin startup.
- Preserve a corrupt or old cache when remote fetch or normalized write fails; never overwrite it with an empty snapshot.
- Accept at most 20,000 remote entries, 128 aliases per song, 8 MiB response, and 128 Unicode code points per alias.
- Reject unknown song IDs, empty/control-character/overlong aliases, invalid schema, unsafe IDs, and malformed arrays.
- Deduplicate per song by normalized search text and keep the first display form.
- Debug logs may contain source and counts, never alias strings.
- Do not add package scripts, engines, Vitest, vite-node, TypeScript, `@types/node`, or plugin-local test tooling.
- Final compilation runs `yarn build` from `C:\koishi-app` and waits beyond the Vite CJS warning.

---

### Task 1: Strict Alias Cache Module

**Files:**
- Create: `src/data/alias-cache.ts`

**Interfaces:**
- Produces: `RemoteAliases = ReadonlyMap<number, readonly string[]>`.
- Produces: `normalizeLxnsAliases(payload, musics): Map<number, string[]>`.
- Produces: `parseAliasCache(payload, musics): Map<number, string[]>`.
- Produces: `RemoteAliasCache.startup(musics): Promise<Map<number, string[]>>`.

- [ ] **Step 1: Run a failing export assertion**

Build current `lib`, require it, and assert `normalizeLxnsAliases`, `parseAliasCache`, and `RemoteAliasCache` are absent. Expected output: `RED: remote alias cache APIs are absent`.

- [ ] **Step 2: Implement normalization and cache schema**

Define constants:

```ts
export const LXNS_ALIAS_LIST_URL = 'https://maimai.lxns.net/api/v0/maimai/alias/list'
export const REMOTE_ALIAS_CACHE_SCHEMA_VERSION = 1
export const MAX_REMOTE_ALIAS_ENTRIES = 20_000
export const MAX_REMOTE_ALIASES_PER_MUSIC = 128
export const MAX_REMOTE_ALIAS_CODE_POINTS = 128
export const MAX_REMOTE_ALIAS_BYTES = 8 * 1024 * 1024
```

Parse all payloads from `unknown`. LXNS requires exactly an object with an `aliases` array; each accepted entry requires a positive safe-integer `song_id` and string `aliases` array. Reject the whole payload when the entry count or a source alias array exceeds its cap. Unknown music IDs are dropped. Trim names and drop empty values, control characters `/[\u0000-\u001f\u007f-\u009f]/u`, and values over the code-point cap. Deduplicate with `normalizeSearchText(name)` per music, merge repeated song entries, and retain first display form.

Cache schema requires `{ schemaVersion: 1, source: 'lxns', generatedAt: valid ISO date, aliases: [{ musicId, names }] }`. Reuse the same normalization rules. Return an empty map only when the structure is valid but no aliases survive; throw on malformed structure.

- [ ] **Step 3: Implement cache-first startup and atomic sync**

`RemoteAliasCacheOptions` contains `cacheDir`, `timeoutMs`, optional `fetch`, logger, debug, and `now`. Use `join(cacheDir, 'aliases.json')` and the existing `CacheStore`.

Startup behavior:

1. `readFile(cachePath, 'utf8')`, JSON parse, `parseAliasCache()`.
2. If at least one alias survives, emit `alias.cache.hit` with song/alias counts and return without calling fetch.
3. On missing/invalid/empty cache, emit only status/count/error type and create a staging directory.
4. Download the fixed LXNS URL to staging through `CacheStore.downloadComputed()` with timeout, 8 MiB cap, and a validator requiring HTTPS, hostname `maimai.lxns.net`, no credentials, and exact path `/api/v0/maimai/alias/list` after every redirect.
5. Parse and normalize. Require at least one valid alias.
6. Serialize deterministic entries sorted by music ID, names in retained order, and atomically write final `aliases.json` through `CacheStore.writeAtomic()`.
7. Always discard staging. On any remote/read/write error, warn once, emit sanitized debug failure, and return an empty map without deleting or rewriting existing cache.

- [ ] **Step 4: Build and run parser/cache assertions**

Run root `yarn build`. Assert valid LXNS/cache payloads, unknown IDs, repeated song entries, normalized duplicates, trim, control/empty/overlong filtering, malformed fields, each cap, deterministic serialization, valid cache no-fetch, missing/invalid/empty cache fetch, fixed-host redirect rejection, 8 MiB rejection, atomic valid write, and non-blocking read/fetch/parse/write failures. Inspect debug entries and assert no alias text appears.

- [ ] **Step 5: Commit the module**

```powershell
git add src/data/alias-cache.ts
git commit -m "feat: add remote alias cache"
```

### Task 2: Data Store and Search Integration

**Files:**
- Modify: `src/data/sync-service.ts`
- Modify: `src/services/alias-service.ts`
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: `RemoteAliasCache.startup(musics)`.
- Adds: `MaimaiDataStore.remoteAliases: ReadonlyMap<number, readonly string[]>` and `setRemoteAliases()` for startup publication.
- Alias search consumes remote aliases without changing add/remove/vote ports.

- [ ] **Step 1: Run a failing search assertion**

Construct a `MaimaiDataStore` with one song and a remote alias, an empty fake `AliasRepository`, and assert current `AliasService.search(remoteAlias)` returns no result. Expected: fail because the store has no remote alias support.

- [ ] **Step 2: Attach alias cache during data startup**

Construct one `RemoteAliasCache` in `MaimaiDataSyncService` using `resourceSync.cacheDir`, timeout, fetch, logger, debug, and now. Add a private async enrichment step called by `complete()` before invalidation publication:

```ts
store.setRemoteAliases(await this.aliases.startup(store.musics))
```

`complete()` becomes async; preserve all existing source priority and fallback behavior. Catching remains inside `RemoteAliasCache`, so alias failure cannot change LXNS/Diving Fish/static/cache/builtin music-source selection.

- [ ] **Step 3: Merge remote and user aliases in search documents**

For each song, construct fields in exact order: title, remote aliases, approved user aliases. Deduplicate the complete field list by `normalizeSearchText`, retaining the first display form and ignoring normalized-empty values. Keep exact title, exact alias, token/fuzzy, and contains ranking logic unchanged.

Do not add repository methods and do not call add/remove/vote while loading or searching remote aliases.

- [ ] **Step 4: Build and run integration assertions**

Run root `yarn build`. Assert remote-only exact/fuzzy search, user-only search, title priority, remote-before-user deduplication, same-name remote alias surviving user-row deletion, startup cache hit without fetch, first-run fetch publication, alias failure with successful music startup, and unchanged `AliasService.add/remove/vote` delegation. Verify existing source invalidation still fires after alias enrichment.

- [ ] **Step 5: Commit integration**

```powershell
git add src/data/sync-service.ts src/services/alias-service.ts src/index.ts
git commit -m "feat: use cached remote song aliases"
```

### Task 3: Documentation and Final Acceptance

**Files:**
- Modify: `readme.md`
- Verify: `package.json`

- [ ] **Step 1: Document remote alias behavior**

Document the cache path, cache-first/no-refresh behavior, LXNS-only current source, search merge with user aliases, and non-blocking fallback. Do not claim Diving Fish currently provides aliases.

- [ ] **Step 2: Run a real LXNS smoke sync**

Use a temporary cache directory and current music data to call the live LXNS alias endpoint once. Verify HTTP/parser success, at least one known song survives, `aliases.json` is valid, a second startup performs zero network calls, and an alias resolves through `AliasService`. Remove only the verified temporary directory afterward.

- [ ] **Step 3: Run full clean build and acceptance**

From `C:\koishi-app`, run `yarn clean mai-plugin` and `NODE_OPTIONS=--max-old-space-size=256 yarn build`. Against fresh `lib`, rerun Task 1 parser/cache matrix and Task 2 search/startup matrix. Verify no alias values appear in debug logs and no database writes occur during remote sync/search.

- [ ] **Step 4: Audit package and scope**

Parse `package.json` as UTF-8 and assert no scripts, engines, or test-tool dependencies. Run `git diff --check`, inspect changed files, and retain generated `lib/index.js`.

- [ ] **Step 5: Commit documentation**

```powershell
git add readme.md
git commit -m "docs: document remote alias cache"
```

- [ ] **Step 6: Record acceptance**

Report build exit, live LXNS counts, cache-hit no-fetch proof, parser limits, failure matrix, remote/user search cases, database non-write proof, commits, and residual risk that aliases remain cache-first until the file is removed or a refresh policy is added later.
