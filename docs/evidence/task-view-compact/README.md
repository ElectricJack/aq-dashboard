# Dashboard density: one type step down, compact task view (2026-11-06)

Owner requests (2026-11-06): "make it cleaner, more compact, closer to v1"; then "one type step down on the entire
dashboard" and "no wrapping of buttons and controls that should be horizontally aligned".
Comparison, findings and targets: `qa/2026-11-06/task-view-style/compare.md` (aq-platform workspace).

## Task view: v1, v2 before, v2 after (live MS1 data)

| | Desktop 1440×900 | Phone 390×844 |
|---|---|---|
| v1 list (agent-q, read-only) | [v1-list-desktop](v1-list-desktop.png) | [v1-list-phone](v1-list-phone.png) |
| v1 task drawer (`bright-orbit-34`) | [v1-task-desktop](v1-task-desktop.png) | [v1-task-phone](v1-task-phone.png) |
| v2 before, list | [v2-before-list-desktop](v2-before-list-desktop.png) | [v2-before-list-phone](v2-before-list-phone.png) |
| v2 before, task …0011 | [v2-before-task-desktop](v2-before-task-desktop.png), [tall](v2-before-task-desktop-tall.png) | [v2-before-task-phone](v2-before-task-phone.png) |
| v2 after, list | [v2-after-list-desktop](v2-after-list-desktop.png) | [v2-after-list-phone](v2-after-list-phone.png) |
| v2 after, task …0011 | [v2-after-task-desktop](v2-after-task-desktop.png), [tall](v2-after-task-desktop-tall.png) | [v2-after-task-phone](v2-after-task-phone.png) |

"Before" is the running MS1 stack's bundle; "after" is this branch's bundle served on a private port and proxied
read-only to the same API.

## Task view on fixtures (origin/main → this branch)

| | Before | After |
|---|---|---|
| Inspector 1440 | [before](fixture-before-inspector-desktop.png) | [after](fixture-after-inspector-desktop.png), [history](fixture-after-history-desktop.png), [one-line rows 1440](fixture-after-nowrap-1440-full.png), [1024](fixture-after-nowrap-1024-full.png) |
| Inspector 390 / 320 | [390](fixture-before-inspector-phone.png), [320](fixture-before-inspector-narrow.png) | [390](fixture-after-inspector-phone.png), [320](fixture-after-inspector-narrow.png) |
| List 1440 / 390 / 320 | [1440](fixture-before-list-desktop.png), [390](fixture-before-list-phone.png), [320](fixture-before-list-narrow.png) | [1440](fixture-after-list-desktop.png), [390](fixture-after-list-phone.png), [320](fixture-after-list-narrow.png) |

Measurements (`tests/work-compact.spec.ts`, fixture task 0x105; px):

| Measure | 1440×900 | 390×844 | 320×640 |
|---|---|---|---|
| Body text | 16px → 14px | 16px → 14px | 16px → 14px |
| Inspector text | 16px → 14px | 16px → 14px | 16px → 14px |
| Page title (h1) | 32px → 26px | 24px → 22px | 24px → 22px |
| Task title | 22px → 18px | 18px → 16px | 18px → 16px |
| Inspector top → first section | 167 → 122 | 272 → 195 | 324 → 195 |
| Inspector top → first comment | 485 → 376 | 685 → 525 | 738 → 570 |
| Comments heading, viewport y | 642 → 543 | 818 → 598 | 889 → 661 |
| Section head row | 36 → 30 | 44 → 44 | 44 → 44 |
| One attempt | 131 → 81 | 208 → 162 | 260 → 207 |
| Whole inspector (task 0x105) | 2375 → 1739 | 3206 → 2554 | 3683 → 2839 |
| Task list row | 34 → 30 | n/a | n/a |
| Task rows per first screen | 13 → 16 | (1024×768: 9 → 12) | |

## Every page (visual fixture suite, before | after side by side)

| Page | Desktop | Phone |
|---|---|---|
| overview | [1440](pages/overview-desktop-1440-before-after.png) | [390](pages/overview-phone-390-before-after.png) |
| supervisor-full | [1440](pages/supervisor-full-desktop-1440-before-after.png) | [390](pages/supervisor-full-phone-390-before-after.png) |
| work | [1440](pages/work-desktop-1440-before-after.png) | [390](pages/work-phone-390-before-after.png) |
| results | [1440](pages/results-desktop-1440-before-after.png) | [390](pages/results-phone-390-before-after.png) |
| decisions | [1440](pages/decisions-desktop-1440-before-after.png) | [390](pages/decisions-phone-390-before-after.png) |
| agents | [1440](pages/agents-desktop-1440-before-after.png) | [390](pages/agents-phone-390-before-after.png) |
| playbooks | [1440](pages/playbooks-desktop-1440-before-after.png) | [390](pages/playbooks-phone-390-before-after.png) |
| knowledge | [1440](pages/knowledge-desktop-1440-before-after.png) | [390](pages/knowledge-phone-390-before-after.png) |
| settings | [1440](pages/settings-desktop-1440-before-after.png) | [390](pages/settings-phone-390-before-after.png) |

## Regenerate

`EVIDENCE_DIR=<dir> pnpm exec playwright test tests/work-compact.spec.ts` writes the metrics and fixture screenshots;
`VISUAL_OUTPUT=<dir> pnpm test:visual` writes every page at 320/390/768/1024/1440.
