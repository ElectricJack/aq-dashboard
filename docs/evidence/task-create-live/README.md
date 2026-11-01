# Actual human task creation and visual review

The final production candidate passed against a separate actual AQ schema 34
database and pinned aq-graph service at `http://127.0.0.1:58343`. No browser API
responses were intercepted. Both services used fresh disposable databases; the
existing Work/Knowledge Graph and canonical AQ database were not modified.
The project has an unavailable repository and unregistered node, so these task
records create no execution authority. No provider calls or agents ran.

The earlier first integration proof used bundle
`47cb250813812f3ee5c4afa0de426926a917e3918887c499f391efc6bbd1952f`:
one actual task POST, validated request digest and Graph receipt, current record
read and operation reload in 861ms. Its operation is
`5a919a9f-3a62-4321-96e3-18e33701c5eb`; see
[initial-create.json](initial-create.json). This is retained separately from final
release acceptance.

Final acceptance uses served dashboard digest
`sha256:a384e31c82f84f9ee5565512bc4ecbfad483bed0aefeac4fc7829668a5952ac5`,
AQ server SHA256
`84fbf672984584fc6f42e90bc7250581dd48c40129736fba2d4c908e400f4b82`,
and the pinned actual Graph binary recorded in [artifacts.json](artifacts.json).
The full final [creation probe](final-create.json) passed in 933ms with exactly
one new intentional task POST. It verifies first-submit URL transition, immutable
request bytes/digest, Owner/project/task identity, confirmed receipt, current
record, pure reload, and exact task-title navigation with the modal closed.
The final operation/task is `253a8e07-726d-4e1a-bf92-cb2a4c40150c`, in project
`edcc7c88-1a45-46be-8761-8610e2d99619` and workspace
`aebef69f-b5fd-4436-bbf0-115e0e4fbc1d`.

The final [read-only reflow probe](final-reflow.json) passed in 1714ms at 1440×1100,
390×844 and 320×740. Each viewport reopens that same receipt, follows its exact
task link without a lingering modal, checks native modal focus and Escape/reopen,
then composes and discards an unsent blank draft. There were no mutations or page
errors, and no horizontal overflow with the long project name. The disposable AQ
database remains state 34 with two confirmed operation intents total, one for each
intentional qualification create, and zero execution attempts. Graph owns the
actual task records; the AQ journal stores intent and proof only.

Visual reference: `docs/design/02-work-explorer-v3.png`, governed by product
specification 0002. Delivered subset: prominent violet creation action in the
existing Work heading, responsive task composer and distinct operation receipt
view. Existing task list/graph/inspector composition is preserved. Overview
shortcut, labels editing, bulk creation, task editing and agent launch are
deferred. The mockup has no separate composer panel, so its exact form is this
increment's shared-token extension rather than a redesign of the Work workspace.

The implementation owner inspected the final desktop and 390px composer/receipt
images and the320px composer. Text and controls are readable; the narrow form
scrolls inside its modal. Long Scope-picker names now shrink within the header.
Screenshots and their hashes are retained in [artifacts.json](artifacts.json),
under `/tmp/aq-create-task-browser-qualified/` and
`/tmp/aq-create-task-reflow-qualified/`. Native focus and the actual task-link
interaction were checked separately from screenshot appearance.

Source chain: `5ec8e6d`, `178b0e0`, `524af71`, `a2fb775`, `ac2986f`, `ea0eec5`.
The final source passes 77 affected tests in 5.58s and typecheck. Independent
review accepted 10 targeted operation/auth regressions in 4.69s, including frozen
A→B URL changes, held A reads versus B busy state, Back/Forward, first submit's own
URL transition, same-operation unknown observations, and 401/403 with an
unreachable bootstrap. These unit race/denial cases are labelled synthetic tests;
the positive creation and screenshots above use the actual services.
