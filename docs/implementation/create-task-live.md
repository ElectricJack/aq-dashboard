# Human task creation: first live vertical

This increment adds the prominent Create task action to the existing Work
workspace. Reference: `docs/design/02-work-explorer-v3.png`, with the primary
creation action also shown in `01-overview-v3.png`. The delivered subset is the
Work action and a responsive, accessible composer; existing task list, graph and
inspector remain owned by the Work workspace. Overview shortcut, labels editor,
agent launch, bulk creation and task editing are deferred.

The action requires the explicit `tasks.create@1` capability and one selected
project. A fresh existing human-graph task page supplies its project revision.
The composer sends title, description, acceptance criteria, empty labels and an
explicit draft/active lifecycle state. Active confers no execution authority.

One operation freezes its UUID, serialized UTF8 request and SHA256 digest before
submission. Duplicate clicks are suppressed. Retrying the same submission uses
the original string verbatim. A lost response, lookup404, admission error or
request-digest mismatch cannot prove no effect and cannot unlock an altered
submission. Only a validated typed conflict/rejection permits the preserved
draft to be deliberately revised under a new UUID and fresh project context.

Reload persists only the opaque operation UUID in the project-scoped URL. It
performs pure lookup and never reconstructs request content. Recovery requires
the explicit server-allowed Recover retained request action. No draft content,
credentials or authorization data enter local/session storage.

A confirmed receipt remains historical creation proof for its original
workspace, change set and initial revisions. The UI separately reads the exact
current task before offering Open created task; unavailable or changed current
binding does not erase a confirmed receipt or permit a retry. Start another task
is an explicit fresh blank draft with a new operation. The UI never fabricates
task records, matches titles as proof, or creates execution authority.

Contract fixture: `src/test/task-create.contract.json`, copied unchanged from
agent-q `protocol/human-task-create/v1/example.json`;
SHA256 `54a51b45614ea54eb544a80b93b5fd4a68e479647c5e9b451d41ad826856f1b6`.
`src/test/taskCreate.ts` contains explicitly synthetic UI test cases.

Focused adapter/client/composer plus existing Work/Graph regressions: 44 tests
passed in 4.61 seconds; TypeScript typecheck passed. The held-response identity
switch case confirms a new principal cannot inherit a prior draft or receipt.
Actual visual acceptance
remains pending the assembled API10 preview. The production browser probe is
`scripts/probe-create-task.mjs`: it requires an explicit disposable loopback
write flag, creates one real task, checks exact request digest/receipt/current
record, reloads by operation identity without another write, and captures both
1440px and 390px composer and receipt views. Screenshots must be inspected before
claiming this visual subset accepted.
