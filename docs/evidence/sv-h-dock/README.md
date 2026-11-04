# SV-H (sharp-beacon-18): supervisor dock as a full-height edge pane

Reference: `docs/design/04-supervisor-chat.png` (dock). Before: `docs/evidence/gap-audit-2026-11-03/supervisor-docked-d.jpg`, `supervisor-msgs-docked-d.jpg`.

| Capture | Source |
| --- | --- |
| `supervisor-dock-d.png` | 1440x900, `vite --mode mock` (mock banner shown), from `tests/supervisor-dock.spec.ts` |
| `supervisor-dock-m.png` | 390x844, mock mode: no dock, `/supervisor` full page |
| `supervisor-dock-msgs-d.png` | 1440x900, production bundle against the labelled `tests/support/supervisor-fixture.mjs` test double ("[Fixture]" messages) |
| `supervisor-dock-msgs-focus-d.png` | same, keyboard focus on a short "Queued" status showing the full delivery text |
| `supervisor-dock-msgs-m.png` | same session resized to 390: the dock is not used and the app navigates to `/supervisor` |

Delivered subset: edge-pane composition (flush with header bottom, right edge and viewport bottom; left border only; no radius or outer margin; `minmax(360px, 40%)`), dock header with only ↗ and ×, and single-line dock metadata ("You · 03:05 PM · Queued") with the full delivery text on hover/focus and for assistive technology.

Re-applied onto main by solid-willow-70 (2026-11-03): `supervisor-dock-d.png` and `supervisor-dock-m.png` were recaptured on the merged tree (single-row shell header, SV-E in-flow launcher, SV-F viewport fit). The three `-msgs-` captures are from the original sharp-beacon-18 branch and predate those sibling changes.

Remaining differences (owned elsewhere): header icon/availability/history link (SV-G, server X4), composer context chips and icon send (SV-G, X5), typed result cards (wise-apex-23), the shell's two-row mock header (SH-I).
