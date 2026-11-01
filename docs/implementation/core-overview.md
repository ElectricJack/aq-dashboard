# Core Overview — UI-15

The core Overview now has the accepted desktop composition: attention/work/outcomes and recorded tasks in a primary column, with worker heartbeat observations, scoped session snapshots and dashboard connection in a secondary column. Phone/tablet layouts stack these panels. Existing status counts and outcome semantics remain supplied by their original owner.

The new contribution adapter consumes `human-overview-tasks-1` from `GET /api/human/overview/tasks`, gated by `human.overview.tasks.read@1`, with optional project scope and bounded four-project / sixteen-task requests. It shows observed task lifecycle counts, a small selection of working project-scoped task links, source timestamps and partial/unavailable project coverage. The default Graph view excludes retired/disputed records. Active records establish neither running processes nor current scheduling readiness; no page-local counts become global totals.

Worker observations come from the existing authorized worker endpoint and are labelled installation-wide heartbeats. Slot capacity and project eligibility remain unreported. Session snapshots use the existing scoped read API and distinguish reported process state, stale observation and recorded stop. Provider quota stays in its existing top-bar source; no account quota is inferred here.

An unavailable task contribution does not hide successful project sources or other infrastructure panels. A failed base Overview read can still display separately available task/infrastructure sources. Protected authorization/contract failures retain the application's existing cache fencing. Ordinary source reads remain bounded and hidden-page polling uses the existing query defaults.

Validation before actual assembly: 19 focused Overview/adapter tests and typecheck pass; the full frontend suite passes **321 tests** in 13.88 seconds. The production build succeeds with 28 manifest files and no mock fixtures. Actual API-13-backed desktop/phone browser verification and screenshot review remain the integration gate. This is the core visual/partial-read increment, not full quota, review/result aggregation or terminal control.
