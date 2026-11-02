# Promoted human actions and session usage

Local preview: **http://localhost:4188**. Verified served bundle:
`sha256:a384e31c82f84f9ee5565512bc4ecbfad483bed0aefeac4fc7829668a5952ac5`.
The [qualification record](qualification.json) preserves the actual owner/browser
results and their limits. The paired [AQ qualification](../../../../aq-server/docs/implementation/dashboard-actions-preview-2026-11-01.md)
describes state34 migration and rollback.

- Work has a real Create task action after selecting a project. Creation returns
  a retained receipt, verifies the current task, supports reload lookup and opens
  the task without leaving the composer over it. Operation changes and access
  denial cannot retain another operation's private draft or result.
- Settings has a current-account notification inbox and delivery detail. The
  canonical inbox is empty; nonempty qualification used an actual persisted
  no-route fixture with zero external deliveries.
- Agents' Session details reads exact session accounting on demand. The
  canonical session has no projection and reports that explicitly. Nonempty
  evidence uses persisted synthetic partial categories and unknown costs.
- Work, Knowledge and Overview passed fresh desktop/phone checks through the
  canonical AQ/Graph services. The task composer also passed 320px reflow.

The combined suite passed 413 tests in 19.29 seconds. Typecheck, a 548 ms
production build and production mock exclusion passed. The preview was restarted
and its actual bundle checked; source readiness alone was not used as evidence.

Visual subsets preserve the [approved references](../../design/visual-acceptance.md):
Work's primary action and task workspace, readable Knowledge content, focused
Agents output with optional details, and shared Settings panels. Actual desktop
and phone captures were inspected. Full media, conversation, terminal control,
workflow and quota designs remain open. Canonical checks were read-only; actual
task creation occurred only in the separate disposable fixture.
