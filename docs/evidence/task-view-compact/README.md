# Task view: compact, closer to v1 (2026-11-06)

Owner request: "improve the frontend formatting and make it cleaner, more compact, closer to v1".
Comparison and targets: `qa/2026-11-06/task-view-style/compare.md` (aq-platform workspace).

## Screenshots

| | Desktop 1440×900 | Phone 390×844 |
|---|---|---|
| v1 list (agent-q, read-only) | [v1-list-desktop](v1-list-desktop.png) | [v1-list-phone](v1-list-phone.png) |
| v1 task drawer (`bright-orbit-34`) | [v1-task-desktop](v1-task-desktop.png) | [v1-task-phone](v1-task-phone.png) |
| v2 before, list (live MS1 stack) | [v2-before-list-desktop](v2-before-list-desktop.png) | [v2-before-list-phone](v2-before-list-phone.png) |
| v2 before, task …0011 | [v2-before-task-desktop](v2-before-task-desktop.png), [tall](v2-before-task-desktop-tall.png) | [v2-before-task-phone](v2-before-task-phone.png) |
| v2 after, list (this branch's bundle, proxied read-only to the same stack) | [v2-after-list-desktop](v2-after-list-desktop.png) | [v2-after-list-phone](v2-after-list-phone.png) |
| v2 after, task …0011 | [v2-after-task-desktop](v2-after-task-desktop.png), [tall](v2-after-task-desktop-tall.png) | [v2-after-task-phone](v2-after-task-phone.png) |
| Fixture before (origin/main, mock 0x105) | [inspector](fixture-before-inspector-desktop.png), [list](fixture-before-list-desktop.png) | [inspector](fixture-before-inspector-phone.png), [list](fixture-before-list-phone.png), [320](fixture-before-inspector-narrow.png) |
| Fixture after (this branch) | [inspector](fixture-after-inspector-desktop.png), [list](fixture-after-list-desktop.png), [history](fixture-after-history-desktop.png) | [inspector](fixture-after-inspector-phone.png), [list](fixture-after-list-phone.png), [320](fixture-after-inspector-narrow.png) |

The live "before" shots are the running MS1 stack's bundle, which predates some origin/main P1 fixes; the fixture
pair is the like-for-like comparison against origin/main.

## Measurements (`tests/work-compact.spec.ts`, fixture task 0x105; px unless noted)

| Metric | desktop before → after | phone before → after | narrow before → after |
|---|---|---|---|
| `inspectorFont` | 16px → 14px | 16px → 14px | 16px → 14px |
| `title` | 22px → 18px | 18px → 18px | 18px → 18px |
| `headerHeight` | 166 → 117 | n/a | n/a |
| `statusOffset` | 167 → 118 | 272 → 200 | 324 → 247 |
| `sectionHead` | 36 → 30 | 44 → 44 | 44 → 44 |
| `attemptHeight` | 131 → 81 | 208 → 162 | 260 → 207 |
| `commentsHeadingTop` | 642 → 560 | 818 → 605 | 889 → 715 |
| `inspectorHeight` | 2354 → 1731 | 3185 → 2539 | 3662 → 2891 |
| `row` | 34 → 30 | n/a | n/a |
| `rowFont` | 16px → 14px | 16px → 14px | 16px → 14px |

`statusOffset` is the distance from the inspector's top edge to its first section (the whole header, phones
included). `commentsHeadingTop` is the Comments heading's viewport position on first load. Phone section toggles
and list rows keep 44px; the 320/390 runs assert no horizontal scroll.

Regenerate: `EVIDENCE_DIR=docs/evidence/task-view-compact pnpm exec playwright test tests/work-compact.spec.ts`
(writes `metrics-*.json` and the fixture screenshots without the `fixture-after-` prefix).
