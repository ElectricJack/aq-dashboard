# WK-F — Work phone list-first density and dedicated graph view (smart-summit-15)

Reference: `docs/design/02-work-explorer-v3.png` (desktop only; no phone mockup exists) and spec 0002 §9 responsive rules.
Captured with MSW mock mode ("Mock data" fixtures) via `tests/work-phone-graph.spec.ts` (EVIDENCE env).

## Delivered subset
- Phone (<768px) list-first: subtitle dropped, title + Create task on one row, compact two-row toolbar
  (search row; state select + List/Graph), disabled-create reason moved to `aria-describedby` (visually hidden on phone).
  First task row top at y≈500 of 844 with bottom nav visible (`after-work-list-phone-390.png`).
- Phone Graph is a dedicated full-viewport view (modal `<dialog>`, region "Dependency graph", "Back to list" at top left,
  bottom nav covered/inert). Opens on the selected task's neighborhood or the first loaded task.
- Node tap keeps `view=graph` and opens a bottom sheet: state, title, acceptance summary, **Open task**, up to 3 relations.
- Desktop 1440: before/after pixel diff is identical for both list and graph (bbox None).
- 320px and 1024px: no horizontal overflow (scrollWidth equals viewport).

## Remaining differences
- Pinch/zoom graph controls depend on WK-C (not landed); phone keeps the existing Pan left/right controls.
- WK-D WorkWorkspace not landed: phone rules live in the HumanNodeWorkspace task rules.
- Phone shell header (quota block, ~232px) is a shell concern and still pushes the list down.
- Small neighborhoods leave empty canvas space in the full-viewport graph.
- Tablet (768–1199) behaviour unchanged (node tap opens task detail).
