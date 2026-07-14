# Task 12 Report: Maimai Guessing Games

## Implementation

- Added a persistence-backed `GuessService` with explicit versioned classical and opening states.
- Classical games emit six hints at 10-second intervals, render a deterministic cover crop, reveal after 30 seconds, accept alias-aware answers, and support `不玩了`.
- Opening games select at most eight eligible songs, normalize full-width/case-equivalent characters, enforce eight distinct opened characters, validate `开字母 X`, support `开歌 曲名` and free alias answers, and reveal the board on completion or stop.
- Serialized every operation per context. Concurrent starts have one winner; starts, stops, timer transitions, replacements, restore, and disposal cannot overlap persisted ownership.
- Persisted every accepted transition through `GuessRepository`. Restore uses the repository's exact 30-minute cutoff, rejects malformed or timerless active rows, preserves crop seeds, and creates only the timer required by the stored phase.
- Timer callbacks carry a runtime token, so callbacks from stopped or replaced games cannot mutate current state. Disposal waits for in-flight starts and transitions before deleting rows.
- Added `TakumiGuessRenderer` with immutable node trees for deterministic crop and final PNGs. Missing covers load the packaged fallback; no Sharp composition, Canvas, browser, or HTML rendering is used.
- Added exact classical/opening start aliases, active-game middleware, group enable/disable aliases, group setting isolation, and private-game behavior. Management accepts group owner/admin roles, configured administrators, or Koishi authority 4.
- Reused Task 10 reply helpers for QQ native Markdown and standard image/text fallback. Ambiguous delivery failures are not retried.
- Registered the guessing commands and one middleware listener through the core lifecycle. Default dependencies restore persisted games, and lifecycle disposal removes commands, middleware, timers, and rows.

## Review Follow-up

- Added a lifecycle admission gate that tracks accepted transitions through repository deletion. Restore and disposal are exclusive, so disposal waits for blocked removals and restore cannot race later starts or stops.
- Disposal is permanent. Restore after disposal returns without reading persistence, and disposal queued during restore removes every partially attached runtime and timer.
- Default dependency initialization now disposes its locally owned guessing service when restore fails, including failures after an earlier row attached.
- Alias answers now compare normalized resolved music titles, matching SD/DX chart variants with the same title in classical, free-answer, and `开歌` flows.
- Group settings now use `platform:channel` identities, opening letters are normalized before one-code-point validation, and restore rejects duplicate songs, malformed opened letters, and impossible phase/counter combinations.

## TDD Evidence

- First RED: the focused integration test failed because `GuessService` was not exported. The minimal concurrent admission/persistence slice made it green.
- State-machine RED/GREEN cycles covered six hints, exact cooldowns, crop/reveal phases, aliases, stop, opening validation, eight-letter limit, song reveals, persistence snapshots, restore, stale callbacks, failed starts, and disposal.
- Rendering RED/GREEN added real concurrent Takumi PNG output, deterministic crop bytes, final output, and fallback-cover loading.
- Command RED/GREEN added real Koishi middleware routing, exact command consumption, group permissions/isolation, private behavior, QQ rich/fallback output, core registration, default restore, and disposal.
- Hardening RED/GREEN cycles covered an in-flight timer during disposal, in-flight start during disposal, malformed restored deadlines, post-disposal starts, replacement ordering during database removal, and ambiguous send retry prevention.
- Review RED cycle 1 failed 5/23 tests for blocked removal disposal and restore/start/stop/dispose ordering; the lifecycle admission gate made all 23 pass.
- Review RED cycle 2 failed 5/27 tests for SD/DX title aliases, lowercase expansion, restore validation, platform settings, and partial initialization cleanup; the scoped fixes made all 27 pass.

## Verification

| Check | Result |
| --- | --- |
| Focused Task 12 | Passed, 27/27 |
| Affected suites, single worker | Passed, 292/292 across 7 files |
| Production build | Passed: TypeScript declarations and Vite build, 55 modules |
| Full suite, exact command | Passed, 600/600 across 16 files |
| Package dry-run | Passed, 73 entries; new guess command/service/render declarations included |
| Forbidden rendering dependency scan | No Sharp, Canvas, browser, or HTML use in Task 12 files |

The package import harness now uses the system temporary directory with explicit dependency links, avoiding Windows watcher locks without relying on ancestor `node_modules` resolution.

## Scope Check

- No arcade queue or OAuth routes were added.
- No external network calls or browser dependencies were added.
- The generated worktree-local `data/` snapshot was resolved under the isolated worktree, inspected, and removed before commit; no unrelated files were deleted.
