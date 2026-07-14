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

## TDD Evidence

- First RED: the focused integration test failed because `GuessService` was not exported. The minimal concurrent admission/persistence slice made it green.
- State-machine RED/GREEN cycles covered six hints, exact cooldowns, crop/reveal phases, aliases, stop, opening validation, eight-letter limit, song reveals, persistence snapshots, restore, stale callbacks, failed starts, and disposal.
- Rendering RED/GREEN added real concurrent Takumi PNG output, deterministic crop bytes, final output, and fallback-cover loading.
- Command RED/GREEN added real Koishi middleware routing, exact command consumption, group permissions/isolation, private behavior, QQ rich/fallback output, core registration, default restore, and disposal.
- Hardening RED/GREEN cycles covered an in-flight timer during disposal, in-flight start during disposal, malformed restored deadlines, post-disposal starts, replacement ordering during database removal, and ambiguous send retry prevention.

## Verification

| Check | Result |
| --- | --- |
| Focused Task 12 | Passed, 18/18 |
| Affected suites, single worker | Passed, 287/287 across 7 files |
| Production build | Passed: TypeScript declarations and Vite build, 55 modules |
| Full suite | Passed, 591/591 across 16 files |
| Package dry-run | Passed, 73 entries; new guess command/service/render declarations included |
| Forbidden rendering dependency scan | No Sharp, Canvas, browser, or HTML use in Task 12 files |

## Scope Check

- No arcade queue or OAuth routes were added.
- No external network calls or browser dependencies were added.
- The pre-existing untracked `data/` directory was preserved and excluded from the commit.
