# OV-C (bright-falcon-73): Overview Work in motion

- Reference: `docs/design/01-overview-v3.png`, Work in motion table (gap audit 2026-11-03, rows A9 and A9b).
- Data: `vite --mode mock` fixture (`src/mocks/inspectionData.ts`), labelled "Mock data" in the shell.
- Delivered subset: the Next constraint cell shows a decorative status icon (filled disc, shared `Icon`) next to a visible label coloured with `--color-attention`, `--color-error` or `--color-success`. Kinds the UI does not recognise and null constraints stay neutral (`--color-text-secondary`, help icon). Below 768px each row is a two-line card: project and running count on line 1, constraint and last progress on line 2. Project, count and age cells never wrap.
- Check: `pnpm exec playwright test tests/overview-work-in-motion.spec.ts` runs at 1440x900 and 390x844. It covers tone and colour, `aria-hidden` icons, no `scrollWidth > clientWidth` in the section, single-line identifiers via `getClientRects`, phone line placement, and full-page axe (WCAG 2.x A/AA, including colour contrast).

| Capture | Before | After |
|---|---|---|
| Desktop 1440 | `before-desktop.png` (see also `../gap-audit-2026-11-03/overview-full-d.jpg`) | `after-desktop.png`, `after-desktop-section.png` |
| Phone 390 | `before-phone.png` | `after-phone.png`, `after-phone-section.png` |

Remaining differences:
- The mock shows "None" in green for a project with no constraint. In the contract, `next_constraint: null` does not tell "no constraint" apart from "not reported", so the UI renders a neutral "Not reported". A server kind of `none` or `clear` renders as success. The mock fixture still sends `null` for outrider, and changing it is a mock-handler change that needs the integration owner.
- The fixture's counts and ages differ from the mock's sample values.
- Between 768 and 1199px, and when the Supervisor dock narrows the destination, the layout stays a table inside the existing horizontal-scroll region. Card stacking is driven by the viewport only.
