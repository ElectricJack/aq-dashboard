# PB-B evidence: Playbooks header, tab bar and phone detail composition

Reference: `docs/design/06-playbooks.png`. Mock mode (`vite --mode mock`), labelled fixtures. Captured by `tests/playbooks-header.spec.ts`.

- Before: `docs/evidence/gap-audit-2026-11-03/playbooks-fx-d.jpg`, `playbooks-fx-m.jpg`, `playbooks-run-d.jpg`, `playbooks-run-m.jpg`, `playbooks-act-d.jpg`, `playbooks-act-m.jpg`.
- After: `playbooks-{d,m}.png` (runs list), `playbooks-run-{d,m}.png` (`/playbooks/runs/run-0000000000000284`), `playbooks-act-{d,m}.png` (`?view=activations&activation=…`).

Delivered subset: H1/subtitle rhythm (4px, no negative margin); one-row segmented view tablist at 390 (Admissions kept as a fourth tab, compacted on phone, `overflow-x:auto` fallback); view toolbar hidden on phone detail pages; one `All runs` / `All definitions` / `All activations` link (same tag and class) directly above the detail H2; run H2 in the first 390x844 viewport.

Remaining differences (other tasks): no "Create playbook" action (G9); filters copy, time range, row density and ISO timestamps (PB-C); inspector meta line, pin strip and the H2 programmatic-focus ring (PB-D); inspector tabs, step timeline, evidence table (PB-E); typed wait and child rows (PB-F); "Open supervisor" float above the title at 1440 (shell, G11).
