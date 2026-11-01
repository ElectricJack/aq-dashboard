# Work and Knowledge visual fidelity increment

References inspected directly: `docs/design/02-work-explorer-v3.png` and `docs/design/07-knowledge-v2.png`, governed by product specification 0002 and `docs/design/visual-acceptance.md`.

Feature source: `e8be922`. Delivered visual subset:

- Work has a task-specific contextual inspector: recorded task state, description, acceptance criteria and actual bounded dependencies are primary. Record versions and verification are secondary disclosures. The graph stays visible with its original root when selecting another task on desktop; phone detail keeps discoverable List/Graph controls and actual panning.
- Knowledge retains searchable/filterable library and selected document composition, compact category/lifecycle/verification identity, Content/Sources/History navigation, formatted heading/list/code structure, a verification assertion, source references and secondary record details. Relationships remain visibly unavailable; exact revision lookup does not pretend that a revision list exists.
- Safe document formatting uses bounded React elements. HTML and unsupported inline constructs remain literal. No external source fetching or new dependency was added.
- Selecting a project preserves an already-linked task/document identity and its URL context.

Focused validation: 20 tests and typecheck passed. Parent's combined candidate contains this feature plus the Agents and Overview changes; 329 combined tests passed. The actual Graph → AQ → compiled browser probe passed in 3.493 seconds against `http://localhost:4196`, served manifest `sha256:85fa3dbfb790467dcaca3be6ce6ee7f448d9b2b39603f066df3b3811afbde2a8`. It checked the labelled local fixture's three tasks and two knowledge records, desktop graph selection/root persistence, phone Graph navigation/pan, current/exact pinned revisions, Back/reload, scope and both Search groups. No interception, mutations or page errors occurred.

Reviewed captures are under `/tmp/aq-human-graph-fidelity-browser/`: `work-graph-desktop.png`, `work-graph-selection-desktop.png`, `knowledge-content-desktop.png`, `knowledge-pinned-mobile.png`, and `work-graph-mobile.png`. Desktop and phone use fresh independent viewports. Reviewer: implementation owner; root performs final preview promotion/review.

Remaining differences: task creation and document authoring, scheduler-derived readiness/agent assignment, full execution/activity history, Knowledge relationship browsing and revision discovery are separate backend/UI work. The basic formatter leaves unsupported inline syntax literal. Full graph zoom/fit and further phone density refinement remain open. This is a qualified visual subset, not complete page acceptance.
