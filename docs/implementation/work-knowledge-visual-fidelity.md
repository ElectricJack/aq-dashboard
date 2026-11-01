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


## Mobile readability and visual probe followup

Source `a076d2c` removes a nested graph card and excess spacing so a complete graph node appears within the first phone viewport. Selected phone Knowledge documents retain one horizontally scrollable tab row and omit the library tagline above the document. This preserves the task workspace and document library composition of references 02 and 07 without adding unsupported facts or changing adapters.

Validation: 21 focused tests, typecheck and production build passed (617 ms, 28 assets, no mock leakage). The actual AQ/Graph read-only probe passed in 3.503 seconds against candidate `http://127.0.0.1:4201`, proxying actual AQ4188. The candidate's served manifest bytes matched its local compiled manifest: `sha256:a2f8aae957779f4cf2d105b0c5b6c1388b71135c08e2f7e0fabd7b4d0f4d94a0`. The proxied API independently advertised its product bundle `sha256:85fa3dbfb790467dcaca3be6ce6ee7f448d9b2b39603f066df3b3811afbde2a8`; this is not claimed as the candidate's source identity.

Implementation owner reviewed actual 1440-pixel desktop and fresh 390×844 phone captures under `/tmp/aq-graph-mobile-visual-browser-final/`. Desktop graph width was 725 px versus 427 px for the inspector; both fixture nodes fit naturally without scaling. After actual phone panning, a complete readable node occupied y=642–714, above navigation at y=787. The selected document's opening paragraph occupied y=593–646. The probe also rechecked graph root/selection, scope, List/Back/reload, current and exact pinned revision, and task/knowledge Search. It made 16 human API reads with no mutations or page errors. Probe assertions wait for a whole readable node after smooth panning rather than sampling midway through the animation.

The delivered subset is natural desktop graph fit, usable phone graph panning and first-viewport document reading. General graph zoom/fit, full Knowledge relationships and revision discovery remain deferred; this does not close full-page acceptance. Root owns final integration and preview promotion.

A separate regression (`e2d3097`) confirms an ordinary feature-specific missing-record 404 retains dashboard navigation. No SessionProvider change was needed. Optional feature version/shape incompatibility may warrant future feature isolation, but scope/identity/integrity mismatch must retain a conservative global fence; a non-JSON 200 may indicate authentication or identity loss and must not be casually localized.
