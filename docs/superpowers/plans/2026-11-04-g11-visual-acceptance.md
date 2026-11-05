# G11 — Visual acceptance, WCAG 2.2 AA, tablet breakpoints, display preferences

Task `steady-cascade-45.12`. Scope is the task description; references are
`docs/design/visual-acceptance.md` and `docs/specs/0002-product-design.md` §2, §9, §10.

## Global constraints

- No page features (G3/G5/G7/G8/G9/G10), no bundle compatibility (G12), no server changes, no new mockups.
- Manifest `sha256`/`bytes` untouched; acceptance records live in a sibling file.
- Fixture data is labelled; live captures use real API responses from the compiled bundle.
- Targeted tests only (velocity rules); no slow tests beyond the visual suite itself.

## Tasks

1. **Display preferences (test first).**
   - `src/app/preferences.ts`: `readPreferences`, `writePreferences`, `applyPreferences` and a
     `usePreferences` hook. Keys: `textSize` (`default|large|larger`), `motion`
     (`system|reduce`), `terminalFontSize` (12–20 px). Stored under one localStorage key,
     presentation only, never cleared by logout (0002 §10).
   - Applied as `data-text-size` / `data-motion` on `<html>` and `--terminal-font-size`.
     `tokens.css` scales the root font size and honours `data-motion="reduce"` like the media query.
   - Terminal font size: the xterm terminal reads the preference as its default size.
   - `features/settings/DisplayPreferences.tsx`: a Settings panel with labelled native controls.
   - Vitest: `src/app/preferences.test.ts`, `src/features/settings/DisplayPreferences.test.tsx`.
2. **Visual suite.**
   - `playwright.visual.config.ts`: `fixture` project against `vite --mode mock`; a `live`
     project only when `AQ_VISUAL_LIVE_URL` names a preview of the compiled bundle proxied to a
     daemon (`pnpm preview` with `AQ_DAEMON_URL`).
   - `tests/visual/pages.ts`: one entry per manifest asset plus Settings: route, ready locator,
     optional labelled fixture injection, viewport set.
   - `tests/visual/visual.spec.ts`: for every page × viewport (1440, 1024, 768, 390, 320):
     ready, no horizontal overflow, axe (`wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`) clean,
     viewport + full-page capture into `VISUAL_OUTPUT` (default `test-results/visual`).
   - `tests/visual/tablet.spec.ts`: 0002 §9 tablet assertions (compact rail; one overlay;
     Supervisor full page; Results comments overlay; one detail pane for Playbooks and Knowledge).
   - `tests/visual/a11y.spec.ts`: keyboard/focus checks for the manual checklist that can be
     automated (focus visible and unobscured, modal trap/restore, reduced-motion preference,
     44 px primary targets in the shell).
   - `tests/visual/live.spec.ts`: live project, served-bundle digest check against
     `dist/dashboard-manifest.json`, read-only (fails on any non-GET request), captures.
   - `package.json`: `"test:visual": "playwright test --config playwright.visual.config.ts"`.
3. **Fixes.** Run the suite, review every capture against its PNG, and fix axe violations,
   overflow and material composition/readability regressions, including tablet behaviour.
4. **Acceptance records.** `docs/design/acceptance.json` keyed by manifest file name (plus
   `settings`): reference, delivered subset, deferred differences, captures, reviewer, served
   bundle digest. A vitest (`src/components/designAcceptance.test.ts`) asserts every manifest
   entry has an accepted record and that the manifest still matches the PNG digests.
5. **Evidence.** `docs/implementation/G11.md` with commands, captures, manual WCAG checklist
   and limits; captures under `docs/implementation/evidence/G11/`.
