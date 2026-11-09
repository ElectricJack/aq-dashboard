# Dashboard visual requirements

The user requires pages to continue matching the approved design mockups while real infrastructure is connected.

Before changing a page, inspect its named reference in `docs/design/manifest.json` and `docs/design/*.png`, and read the corresponding section of `docs/specs/0002-product-design.md`. Follow `docs/design/visual-acceptance.md` for review and evidence.

- Preserve the reference's page hierarchy, pane proportions, typography, density, primary controls and responsive composition. Use existing shared tokens/components.
- Keep domain pages distinct: Work is a task workspace, Knowledge is a readable document library, Agents is a focused output workspace. Do not let a generic record inspector replace those designs.
- Render real or explicitly labelled fixture facts. Keep empty/unavailable states concise and within the intended layout; do not invent activity, quota, status or media to fill a mockup.
- API tests and successful navigation are separate from visual acceptance. Review actual desktop and phone screenshots before claiming visual completion. Check readable text, unclipped content, graph navigation and visible mobile exits/controls.
- Name each delivered visual subset and remaining differences. Full-page acceptance stays open while required panels or workflows are deferred.
- Coordinate shared shell, route, capability and component changes with the integration owner; feature changes should stay in their assigned files.

# Habit Hooks pilot (owner, 2026-11-09)

Before you consider a change complete, run `habit-hooks` from the repository root. It runs ESLint, knip, jscpd and a comment check, and prints a coaching guide for each code smell. A project filter (`.habit-hooks/generic/transformers/changed-lines.cjs`) limits the report to code this branch wrote, changed or made longer, so existing debt elsewhere stays out of your way.

- Fix each **enforced** smell in the way its guide describes. Change the shape of the code, not the number: splitting a function into `partA`/`partB`, merging conditions or adding a suppression to get under a limit is not a fix.
- **Suggested** smells (non-null assertions, comments, duplication) are advice. Fix them when it's cheap.
- These fixes are part of the task, not follow-up work. Don't refactor beyond what the run reports.
- Never snooze findings or edit `.habit-hooks/`, `knip.json` or `.jscpd.json` without the owner's approval.
- If the run reports `incomplete-run`, or `habit-hooks` is not installed, say so; do not treat the change as checked.
