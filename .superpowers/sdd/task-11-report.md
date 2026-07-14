# Task 11 Core Command Port Report

## Coverage Checklist

| Family | Triggers / aliases | Success | Failure | Status |
| --- | --- | --- | --- | --- |
| Help | `mai` | Bare `/mai` returns documentation help | Trailing legacy text is routed to registered subcommands | Complete |
| Direct ID | `id<id>`, color and named difficulties | Plain ID plus 15 color/color-name/English difficulty aliases | Missing song/difficulty | Complete |
| Music discovery | random, name/alias, constant/range, fitted, designer, version, artist, regex, BPM, combo | All listed triggers; real search callbacks navigate 1->2->3->2->1 with fresh scoped tokens | Empty, malformed, unsafe, overlength, timeout, queue overflow, threshold-plus-one, and no-result paths; regex workers use a shared bounded semaphore | Complete |
| Alias management | add alias, administrator delete | Authority-4, configured-user, and group-role administrators pass the custom OR-policy; metadata retains `authority:4` while effective permission remains non-preemptive | Missing args return usage; ordinary low-authority deletion is denied | Complete |
| Daily recommendation | `今日舞萌` | Same user/date is stable; different user and next local date produce independently seeded results | Empty local catalog | Complete |
| Preview | `预览` | Non-empty injected local audio | Missing song, missing resource, empty resource | Complete |
| Ratings / lists | `b15/b25/b35/b40/b50`, filtered forms, `分数列表/分数表/成绩列表/成绩表` | Historical B15/B25/B35/B40 use `Rating.calcOld()`, legacy course totals, and dynamic labels; B50 baseline remains modern; score lists render all 50 records and send callback pages | Public/self privacy guidance, provider/query failure, and empty records do not invoke the renderer | Complete |
| Tables / images | `定数表`, `完成表/进度表`, `未完成表/未完成列表`, `info/minfo`, five color difficulties, `段位表` | Each table alias, both info aliases, all five colors, fixed courses, and deterministic injected random-course sampling | Invalid filter, missing song, unknown course, and random pools below four charts | Complete |
| Text progress | `<条件>进度` | Matching records produce text progress | Invalid/no-result filter | Complete |
| Score line | `分数线` | Valid chart computes TAP GREAT and BREAK tolerances | Missing input/song, malformed target, and invalid difficulty | Complete |
| Settings | `bind/绑定`, `/bind`, provider aliases, compatibility aliases, avatar, plate/name frame, `设置mai/设置b50`, `默认/设为默认` | Every listed alias persists through Task 9 services; cached `b50` and `/mai b50` replay exactly once through real routing | Invalid QQ/provider, collection validation/acquisition, and persistence failure | Complete |
| Compatibility middleware | exact prefixless commands for maimai default | Real low-priority middleware executes parser-validated commands after higher-priority middleware | Unknown/partial text, broad ordinary text, another default, any bot event, unsupported platform, and settings lookup failure pass through | Complete |
| Lifecycle / callbacks | commands, middleware, interaction listener, callback state disposal | `interaction/button` dispatches scoped Task 10 callbacks and sends complete rendered handler output with fresh navigation state | User/channel/authority/permission mismatches are rejected; disposal unregisters commands, middleware, listener, and callback state | Complete |

## TDD Evidence

- First RED: `tests/integration/commands-core.spec.ts` imported the missing core registration entry point and failed before command implementation existed.
- Review RED/GREEN cycles cover ReDoS timeout, bounded worker concurrency/queue release, real bidirectional button pagination, 50-record score-list pagination, pending replay, parser-validated compatibility, sender/bot mention separation, privacy mapping, historical ratings, random courses, search threshold, alias OR-policy/metadata, and daily determinism.
- Focused GREEN: `npx vitest run tests/integration/commands-core.spec.ts` passed 184/184 cases.

## Verification

| Check | Result |
| --- | --- |
| Focused command integration | Passed, 184/184 |
| Affected suites | Passed, 221/221 across aliases, combo query, QQ message, QueryService, rating, semaphore concurrency, render templates, and plugin lifecycle |
| Production build | Passed: TypeScript declarations plus Vite production bundle; final bundle 304.95 kB |
| Full test suite | Passed, 573/573 across 15 files |
| `git diff --check` | Passed |
| Pack dry-run | Passed; 70 packaged entries and prepack build completed |

## Residual Risks

- Compatibility recognition is deliberately limited to the documented Task 11 command surface and configured platforms.
- User regular expressions are length-limited, reject malformed/known high-risk structures, and execute in worker threads with strict timeout/termination plus a shared concurrency and queue bound. The worker boundary bounds event-loop impact; it is not a proof that every accepted expression has linear complexity.
- Callback ingress is wired to Koishi's installed `interaction/button` event and depends on adapters populating the standard button ID, user, channel, authority, and permission fields.
- Actual provider availability, local preview cache population, and native renderer output remain environment-dependent and are covered here through injected integration fakes.
