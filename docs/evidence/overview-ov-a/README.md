# OV-A Overview header: visual review

- **Reference:** `docs/design/01-overview-v3.png`, header region (title, summary line, primary "+ Create task").
- **Delivered subset:** page header only. The h1 "Overview" (`--font-size-title`) sits above a plain-language
  summary separated by `--space-2`, with no negative margin. Create task is on the right of the same flex row
  and wraps below the title block on phones. The summary is built from overview counts, with singular, plural,
  zero, estimated and unknown forms. Failed and partial reads keep the same header.
- **Captures** (`vite --mode mock`, written by `tests/overview-header.spec.ts`):
  - before: `overview-before-d.png` and `overview-before-m.png` (title and summary overlap)
  - after, all projects: `overview-A-d.png` and `overview-A-m.png` (nonempty fixture; Create task shows the existing "Choose a project first" path)
  - after, project scope: `overview-A-scoped-d.png` and `overview-A-scoped-m.png` (enabled accent button; this fixture scope has no overview rows, so it shows the zero summary)
  - failed and partial reads: `overview-A-reads-failed-{d,m}.png` and `overview-A-partial-{d,m}.png`
- **LABELLED TEST FIXTURE:** the proposed mock bootstrap does not advertise `tasks.create`. The spec enables
  it in the browser for the Create task cases. Without it, the button is hidden (also tested).
- **Remaining differences:**
  - Under All projects the button is disabled with a hint, not the mock's enabled accent button. This is the intended product behaviour.
  - Mock overview projects are not graph UUIDs, so the enabled button and nonempty rows never appear in the same mock capture.
  - The served bundle was not checked against a live stack.
