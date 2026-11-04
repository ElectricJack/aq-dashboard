# DC-M evidence: decision evidence/proposal workspace (reference 03, middle column)

Date: 2026-11-03. Task calm-vault-46.2. Mock mode (`vite --mode mock`), Chromium, 1440×900 and 390×844.

## Delivered subset

`src/features/decisions/DecisionEvidence.tsx` replaces the generic "Review task" panel on `/decisions/:id`. It shows:

- A breadcrumb: project / task, linked to Work.
- An H2 task title from the human-graph task read. If no title is available, it falls back to "Review task <short id>".
- Two chips: "Task version N" and a status chip. The status chip shows "Awaiting your decision", "Historical review" or "Recorded decision: X".
- A "Decision requested" note callout showing the validation policy id.
- Numbered acceptance criteria.
- "Related evidence" link cards: the result report (Results) and the task (Work).
- A source block: repository, base object and resulting object, shortened, each with a copy button.
- When `current_report_head` is false, a warning status is the panel's first child: "A newer result report exists. This review is historical and can't be answered." It links to the task's results.

The answer form (DC-K) and the context column (DC-J) are unchanged.

## Screenshots

| State | Desktop 1440 | Phone 390 |
| --- | --- | --- |
| Before (generic panel) | `before-desktop-1440.png`, `before-full-desktop-1440.png` | `before-phone-390.png`, `before-full-phone-390.png` |
| After (titled task) | `after-desktop-1440.png`, `after-full-desktop-1440.png`, `after-panel-desktop-1440.png` | `after-phone-390.png`, `after-full-phone-390.png`, `after-panel-phone-390.png` |
| After (superseded) | `after-superseded-desktop-1440.png` | `after-superseded-phone-390.png` |

The mock decision's task is not part of the labelled human-graph fixture. For the titled and superseded cases, the Playwright spec rewrites the mock responses in the page. It does not use `page.route`, because MSW runs in a service worker. The titled case reuses graph fixture task `…0104` ("Fixture: Approve recovery plan"), re-addressed to the decision's task. Without that overlay the H2 falls back to "Review task 00000000".

## Checks

| Command | Result |
| --- | --- |
| `pnpm exec playwright test tests/decision-evidence.spec.ts tests/decision-context.spec.ts` | 8/8 passed, including axe on `main` at both widths and no horizontal overflow |
| `pnpm exec vitest run src/features/decisions/Decisions.test.tsx` | 7/7 passed |
| `pnpm exec tsc -b` | Passed |

## Remaining differences from reference 03

- No Proposal / Changes / Discussion tabs, and no "What changed in revision N" section. The server offers no revision diff or discussion.
- No "Submitted by … · N minutes ago" line, because no submitter is exposed. The callout shows a generic request plus the validation policy id, not a requested-judgment sentence. The adapter exposes neither a review-policy label nor the judgment text.
- The superseded warning links to the task's Results list, not to the newer report itself. The decision read does not carry the newer report id.
- The title and project name appear only when the human-graph or projects reads cover the decision's project.
- On desktop, the title chips wrap below long titles. Reference 03 keeps them inline with a short title.
