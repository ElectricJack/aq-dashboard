# Overview source coverage presentation

Owner request, 2026-11-09: move internal source counts out of Overview and show a plain warning only when incomplete information affects the page.

Overview now omits the source list and internal coverage reasons. An incomplete overall read or source contribution shows a short warning with a scope-preserving link to Settings. A complete read shows neither that warning nor a diagnostics link. Existing failed-refresh and offline notices remain responsible for retained data.

Settings → Framework connection → Overview diagnostics holds the source names, counts, coverage, observation ages, project labels and technical reasons. The disclosure starts closed unless opened through the Overview link. Its read mounts only while expanded and shares the scoped Overview query cache.

## Validation and visual record

- `pnpm test src/features/overview/Overview.test.tsx src/features/settings/FrameworkStatus.test.tsx`: 24 passed.
- `pnpm build`: typecheck, production compilation, mock exclusion and bundle manifest checks passed.
- `PW_PORT=4196 pnpm exec playwright test tests/overview-header.spec.ts tests/overview-attention.spec.ts tests/settings-panels.spec.ts --workers=2`: 11 passed, including accessibility checks.
- Browser qualification at 1440, 390 and 320 pixels: complete reads stay quiet, partial reads warn, the diagnostics link preserves project scope and opens the disclosure, and Settings has no horizontal overflow. The compiled preview was also exercised against real aq-ms1 reads at all three widths, with no browser errors.
- Evidence: `/home/jkern/dev/aq-platform/qa/2026-11-09/overview-source-coverage/`, including `checks.json`, complete/partial fixture captures and compiled live-preview captures.
- Reference: `docs/design/01-overview-v3.png` and product design §4. Delivered subset: removal of Overview's technical source disclosure, a concise incomplete-data notice, and technical details inside the existing Settings panel. Status counts, attention/work/outcomes hierarchy and the secondary capacity/pinned-session column retain their composition.
- Visual reviewer: Codex, by inspecting desktop and phone captures. This records the narrow visual change, not an independent code review or full-page acceptance. Existing unrelated capacity, provider, terminal and other deferred features remain outside this change.

The local aq-ms1 deployment uses the compiled branch bundle. Its deployed manifest and rollback copy are recorded with the local evidence; merging the branch remains subject to the existing review process.
