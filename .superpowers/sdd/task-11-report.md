# Task 11 Core Command Port Report

## Coverage Checklist

| Family | Triggers / aliases | Success | Failure | Status |
| --- | --- | --- | --- | --- |
| Help | `mai` | Bare `/mai` returns documentation help | Trailing legacy text is routed to registered subcommands | Complete |
| Direct ID | `id<id>`, color and named difficulties | Plain ID plus 15 color/color-name/English difficulty aliases | Missing song/difficulty | Complete |
| Music discovery | random, name/alias, constant/range, fitted, designer, version, artist, regex, BPM, combo | All listed triggers; range and pagination paths | Empty, malformed, unsafe, overlength, and no-result paths | Complete |
| Alias management | add alias, administrator delete | Vote/add and authority-4 delete | Missing args and non-admin delete | Complete |
| Daily recommendation | `今日舞萌` | Stable user plus local-date seed | Empty local catalog | Complete |
| Preview | `预览` | Non-empty injected local audio | Missing song, missing resource, empty resource | Complete |
| Ratings / lists | `b15/b25/b35/b40/b50`, filtered forms, `分数列表/分数表/成绩列表/成绩表` | All five totals, five filtered forms, and all four list aliases render through QueryService and MaiRenderer | Provider/query failure and empty records do not invoke the renderer | Complete |
| Tables / images | `定数表`, `完成表/进度表`, `未完成表/未完成列表`, `info/minfo`, five color difficulties, `段位表` | Each table alias, both info aliases, all five colors, and course rendering | Invalid filter, missing song, and unknown course | Complete |
| Text progress | `<条件>进度` | Matching records produce text progress | Invalid/no-result filter | Complete |
| Score line | `分数线` | Valid chart computes TAP GREAT and BREAK tolerances | Missing input/song, malformed target, and invalid difficulty | Complete |
| Settings | `bind/绑定`, `/bind`, provider aliases, compatibility aliases, avatar, plate/name frame, `设置mai/设置b50`, `默认/设为默认` | Every listed alias persists through Task 9 services; bind replay is consumed once | Invalid QQ/provider, collection validation/acquisition, and persistence failure | Complete |
| Compatibility middleware | exact prefixless commands for maimai default | Real low-priority middleware executes recognized commands after higher-priority middleware | Unknown/partial text, another default, self event, unsupported platform, and settings lookup failure pass through | Complete |
| Lifecycle | commands, middleware, callback state disposal | Default lifecycle constructs/registers once | Disposal unregisters commands/middleware and clears opaque callback state; repeated disposal is safe | Complete |

## TDD Evidence

- First RED: `tests/integration/commands-core.spec.ts` imported the missing core registration entry point and failed before command implementation existed.
- Focused GREEN: `npx vitest run tests/integration/commands-core.spec.ts` passed 162/162 cases.
- Type build GREEN: `npm run build:types` completed without diagnostics.

## Verification

| Check | Result |
| --- | --- |
| Focused command integration | Passed, 162/162 |
| Affected suites | Passed, 127/127 across aliases, combo query, QQ message, QueryService, and plugin lifecycle |
| Production build | Passed: declaration build plus Vite production bundle |
| Full test suite | Passed, 551/551 across 15 files |
| `git diff --check` | Passed |
| Pack dry-run | Passed; 70 packaged entries and prepack build completed |

## Residual Risks

- Compatibility recognition is deliberately limited to the documented Task 11 command surface and configured platforms.
- User regular expressions are length-limited, reject known high-risk structures, and run only against bounded local song-name slices; JavaScript does not provide a synchronous regex timeout primitive.
- Actual provider availability, local preview cache population, and native renderer output remain environment-dependent and are covered here through injected integration fakes.
