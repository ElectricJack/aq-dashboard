# RS-I — Results discussion panel (2026-11-04)

Mock mode (`vite --mode mock`, labelled fixtures in `src/mocks/results.ts`), captured by
`FIXTURE_SHOTS=docs/evidence/rs-i-2026-11-04 pnpm exec playwright test tests/results-discussion.spec.ts`.

References: `docs/design/10-results-desktop-v2.png`, `docs/design/13-results-mobile-v2.png`.
Before: `docs/evidence/gap-audit-2026-11-03/results-comments-d.jpg`, `results-comments-m.jpg`.

| After | View |
| --- | --- |
| `results-discussion-desktop-1440.png` | 1440×900, ~420px Discussion aside, two anchor threads |
| `results-discussion-desktop-1440-composer.png` | 1440×900 scrolled, sticky panel with composer |
| `results-discussion-phone-390.png` | 390×844 full-width comments sheet |
| `results-discussion-phone-390-composer.png` | 390×844 sheet scrolled to composer |

Remaining differences from the mock:
- Header sub-line shows `Task <short id> · result <revision prefix>`, not `AQ-142 · result r2`; the wire has no task key or revision ordinal (server gap R5).
- Authors show short principal ids with id-derived initials (or "You"); there are no display names (server gap R16).
- Times read "Nm after result" (relative to submission) because comment pages carry no server time, and relative labels must not use the local clock.
- Video-range threads are labelled `mm:ss–mm:ss · Clip`, but the fixtures contain no video anchors. The image pin thread has no media thumbnail because fixture images are not offered.
- On desktop, the card's "Comments N" button still opens the modal sheet rather than focusing the aside (Results.tsx, outside this task).
