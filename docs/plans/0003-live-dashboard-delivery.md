# Live dashboard delivery and visual completion

Planning update: November 1, 2026. Audited AQ `468617f`, dashboard `e89da32`, and the accepted design gallery. This executes and subdivides [D00–D13](0001-dashboard-implementation.md); it does not replace the product design or claim that planned endpoints exist. Canonical task identities, ownership and dependencies live in [AQ's milestone graph](../../../agent-q/docs/plans/0001-v2-milestones.json). Writing this plan does not dispatch implementation or enable capabilities.

## Outcome and diagnosis

Every navigation destination should become a useful view of real AQ infrastructure, with the composition and interactions in the accepted mockups. Today five destinations are only `DestinationPage` stubs. Work is implemented against proposed mocks, and Overview's real response is deliberately partial. Agents and Settings have working integrations, but Agents does not yet implement the focused workspace design.

The twelve selected [mockups](../design/index.html) and their [manifest](../design/manifest.json) remain the visual reference. [Product specification 0002](../specs/0002-product-design.md) governs behavior and resolves differences between mockup generations. Colors alone are insufficient: the missing columns, inspectors, timelines, feed, conversation and focused workspace are the main visual gap. Sample numbers and media in PNGs are never production data.

This work can run alongside the native worker runner. Task/knowledge reads, review and playbook inspection, historical results, notifications, worker status and visual layout do not require a live model. Real supervisor replies and interactive terminal control do require their respective runtime owners.

## Current coverage and target per destination

Paths below are relative to the owning repository. Existing routes and proposed additions are deliberately distinguished.

| Destination | Current evidence | Next useful live delivery | Required visual composition |
| --- | --- | --- | --- |
| Overview | `src/features/overview/Overview.tsx`; real `/api/v1/overview`, but four unknown counts, empty attention/outcomes, bounded session-derived projects | Aggregate authorized task, review, result and worker facts with per-source coverage; link each attention item to a working detail page | `01-overview-v3.png`: attention/work/outcomes main column, capacity/health/pinned sessions side column, compact status band |
| Work | `src/features/work/`; list/detail/graph exist, proposed `/api/v1/tasks` routes are absent from AQ | Human project-authorized task list, exact detail and bounded dependency neighborhood from Graph; then create/edit and other explicitly supported commands | `02-work-explorer-v3.png`: list/graph switch, filters, graph controls and contextual inspector; phone list → detail |
| Knowledge | `src/features/knowledge/index.tsx` is a stub; no human Graph gateway or `knowledge.read` capability | Share Work's human Graph gateway for search, document/revision, sources, relationships and verification; authoring follows typed commands | `07-knowledge-v2.png`: searchable library plus full document/metadata panes, independent lifecycle/verification filters |
| Decisions | Stub; AQ `reviews.rs` has conditional known-ID inspect/resolve/cancel, but no eligible-user inbox | Bounded decision discovery; exact evidence and revision-bound approve/reject using the existing owner | `03-decision-workspace-v3.png`: inbox, evidence/proposal workspace, context and clear action area |
| Playbooks | Stub; conditional AQ `/api/playbooks/status`, binding and run-by-ID reads exist; lists are missing | Configured runtime status, run/admission discovery and pinned timeline; installed definition/binding/activation inspection where represented by the actual owner | `06-playbooks.png`: Runs / Definitions / Activations, list/detail and step timeline with waits, children and receipts |
| Results | Stub; AQ retains validated historical result claims, but has no human result feed | First metadata/evidence links and exact revision detail; then retained media, comments/annotations and explicit feedback tasks | `10-results-desktop-v2.png`, `13-results-mobile-v2.png`: centered feed, large evidence cards, selected comments panel; bounded mobile feed |
| Agents | Real sessions/detail, lifecycle receipts and optional literal output tail; focused layout/control absent | Focused read-only output workspace, session switcher and details drawer using existing APIs; add observation/usage panels where available | `08-agents-focus-desktop.png`, `11-agent-mobile-v2.png`: one large readable output area, compact tabs, status footer and optional details. Literal tail stays labelled; it is not a screen snapshot |
| Supervisor | Stub; AQ mailboxes exist, but no global conversation/runtime integration | Durable global conversation identity/history and explicit dispatch association; full/docked/mobile composer. Real replies require AQ-17 | `04-supervisor-chat.png`, `09-supervisor-full-desktop.png`, `12-supervisor-mobile.png`: shared history/draft/context across dock/full modes, keyboard-aware phone composer |
| Settings | Real identity, daemon, workers and project bindings | Organize existing profile/catalog, worker, notification and project reads; expose only supported Owner actions | Use the shared layout, controls and disclosures; Settings has no separate accepted PNG. Heartbeat does not establish capacity or eligibility |

Search is implemented against mocks and needs the human Graph/read adapters. Provider quota is independently missing: session token/cost accounting and provider availability cannot supply account-wide quota percentages or reset windows.

## Parallel execution with the available four agent slots

Keep one implementation agent on the native worker runner. Assign one agent to the current dashboard backend slice and one to its UI/visual work. The root owns contract coordination, review and deployment of the local preview. These are three implementation lanes plus integration, not a promise to run all feature teams simultaneously.

Start with `API-03` (human Graph reads) and `UI-05` (shared visual composition). The UI lane can immediately improve Agents and Settings using existing data under `UI-12`, then connect Work/Knowledge under `UI-06` as the Graph contract becomes available. Backend work next advances review discovery and playbook discovery. Rotate the same lanes through the following slices; avoid competing edits to bootstrap, routes and shared layout files.

| Delivery order | Backend work | UI work | Visible acceptance |
| --- | --- | --- | --- |
| 1. Working inspection | API-03; existing sessions/workers/observations/notifications APIs | UI-05, UI-06, UI-12; focused read-only portion of UI-03 | Real Work and Knowledge navigation; early partial Overview with actual task/project information; useful session/worker panels; mockup-aligned shell, inspectors and focused output |
| 2. Operator workflows | API-04 and API-05; API-10 for supported task/knowledge writes | UI-07 and UI-08; UI-02 action recovery | Real review inbox/evidence/decision; configured playbook runs/timelines; task creation and typed edits with pending/conflict recovery |
| 3. Results and Overview | API-06 then API-08 | First increment of UI-09, then UI-11 | Real result metadata/evidence and populated attention/outcomes; scope/freshness remain explicit |
| 4. Conversation and richer evidence | API-07, API-11, API-12; AQ-17 for actual replies | UI-10, remaining UI-09 | Global supervisor conversation and reply; actual retained media, comments and one explicit feedback task |
| Independent sources and terminal completion | API-09; existing AQ-21/WRK-14/observation/lifecycle owners | UI-03/UI-04, provider strip in UI-11 | Qualified account quota and terminal control appear only when their sources work; earlier read views remain useful |

Results metadata can move ahead of slice 2 if its backend lane is free; API-06 depends on the completed retained-claims owner AQ-28, not full task settlement. Provider quota can be implemented independently, but lack of provider configuration must not stall Work or Knowledge. Likewise, a missing playbook or review installation must not disable unrelated tabs.

Do not leave Overview unchanged until slice 3. API-03/UI-06 should supply its first bounded task/project contribution, with unavailable review/result sections still explicitly partial. Full aggregation and the secondary panels remain API-08/UI-11. Counts require an actual owner-provided fact and coverage; the browser must not count one loaded page as the total or infer current readiness from a task label.

## Task contracts and existing package mapping

The following are new leaf tasks in the canonical AQ graph. Parent API-02/UI-01–UI-04 remain open. Dependencies are completion gates; UI components may be developed against published fixtures while a paired adapter is being implemented. No leaf task should inherit an unrelated whole-product gate merely because its parent is broad.

| Task / owner | Existing package | Concrete scope and principal paths |
| --- | --- | --- |
| API-03 / agent-q | D01, D11 | Human-authorized Graph read adapter for tasks, dependency neighborhoods, knowledge and search inputs. Reuse `agent_access/scheduling.rs` and Graph clients through a new human actor path; publish schemas/fixtures and bounded mounted routes |
| API-04 / agent-q | D01, D05 | Eligible-user review discovery over `reviews.rs`, safe subject/evidence DTOs and action descriptors; retain exact owner authorization and existing resolve/cancel semantics |
| API-05 / agent-q | D11 | Bounded playbook run/admission and installed definition/binding discovery beside `playbooks/api.rs`; retain namespace ownership, immutable run pins and optional-runtime status |
| API-06 / agent-q | D08 first increment | Human result metadata/list/detail over `profiled_execution/results.rs`; retain source/report/revision associations and separate recorded, accepted and settled states |
| API-07 / agent-q | D06 | Global conversation identity, ordered message references/history, durable submit/reconciliation and dispatch/reply association using AQ-11; central runtime availability is explicit |
| API-08 / agent-q | D01, D04 | Overview attention/outcomes/project summaries and scoped search over the new human read owners; bounded/batched aggregation, coverage and source timestamps |
| API-09 / agent-q | D02 | Provider/account quota collection and human read projection with source, window/reset/freshness and unavailable states; one supported source first, no fabricated quota from usage |
| API-10 / agent-q | D01, D05, D11 | Human typed task creation/edit and knowledge author/correct/verify/retire commands using the existing durable Graph operation owner. Version guards and stable operation lookup; no raw Graph proxy |
| API-11 / agent-q | D08 remainder | Media/evidence upload, finalize, authorized retrieval and capture-policy evaluation, with exact result revision, retention and explicit waiver semantics. Start with managed local storage and existing database metadata; no mandatory new external service |
| API-12 / agent-q | D09 | Revision-pinned comments/region/time anchors, explicit feedback-task creation/linking and resolution; one task across lost responses. Posting a comment alone schedules nothing |
| UI-05 / aq-dashboard | D03 | Shared visual composition, responsive shell/panels/controls, empty/partial/unavailable states, and visual baselines. Own `app/`, shared components/tokens and design comparison checklist |
| UI-06 / aq-dashboard | D04, D11 | Connect `features/work/`, `features/knowledge/` and search to API-03; reuse existing list/graph components, build document/revision inspector |
| UI-07 / aq-dashboard | D05 | Build `features/decisions/`: inbox, evidence, exact-revision decision and recoverable pending/conflict draft |
| UI-08 / aq-dashboard | D11 | Build `features/playbooks/`: discovery, pinned run timeline, definitions/bindings/activations and only supported actions |
| UI-09 / aq-dashboard | D10 | Incremental `features/results/`: metadata first, media next, comments/feedback last. Each is a useful separately demonstrated increment; full task closes only with its backend owners |
| UI-10 / aq-dashboard | D06 | Build `features/supervisor/`: one shared dock/full/mobile conversation and draft; end-to-end real reply depends on AQ-17 |
| UI-11 / aq-dashboard | D04, D02 | Complete Overview's two-column composition, real aggregates/search links and provider strip using API-08/API-09. Each section reports its own coverage |
| UI-12 / aq-dashboard | D04, D12 first increment | Connect worker status, profile/catalog, existing session observation/usage and human notification inspection in Agents/Settings. Future waits/stall control stay in UI-04; no new runtime authority inferred from these reads |

Full renderer/control remains UI-03/INT-02. Full hibernation/stall/notification workflows remain UI-04/INT-03. These owners are reused, not replaced with dashboard-side lifecycle logic.

## API and component boundaries

Keep `aq-dashboard` a separately built/tested static bundle. Browser traffic goes to AQ's human listener; it never receives worker/agent credentials, connects to a worker or Graph directly, or reads component databases. Owner-only project access remains Owner-only until an explicit project-level Viewer policy is implemented and tested. Existing session inspection ACLs do not automatically authorize every task or document in that project.

For each slice publish or pin its actual DTO/validator and capability, then mount and test the route before enabling the UI capability. Existing `/api/...` human APIs may be adapted directly when their semantics fit; do not add redundant endpoints solely for URL consistency. Any `/api/v1/tasks`, knowledge/search/list or conversation path in the old proposal is still proposed until implemented. Optional playbook/review owners require configured-runtime evidence, not a bootstrap flag set to true.

Graph remains authoritative for task/knowledge records; result/review/playbook/message owners retain their own domain facts. Read aggregation may cache or index disposable projections with source revisions, but must not create a second editable task database. Mailbox receipts remain authoritative for message delivery; a conversation projection references them rather than inventing delivery state. Partial cross-owner reads are not presented as an atomic snapshot.

Use bounded polling and existing observation cursors first. A general push stream is not required to make these tabs work. Ordinary reads must not contend with worker cleanup, renewal or control pools. Reuse pagination and current-authorization fencing; keep SQL/Graph work bounded as history grows, avoid a query per displayed row, and return explicit partial/unknown status when a source is absent.

## Functional and visual definition of done

Every delivered increment has two independent gates:

1. **Working infrastructure:** public contract and actual mounted human API, supported authorization/scope, bounded pagination, loading/empty/partial/error behavior, real persisted state read through the owner, deep-link refresh, and a live browser flow. A read test uses actual Graph/runtime/result data created through domain APIs or isolated integration fixtures, not browser interception. Test fixtures are labelled and isolated; production routes never substitute mock data when a source is absent.
2. **Design completion:** compare the actual page against its named PNG and governing product spec. Check hierarchy, column/panel proportions, typography, density, controls, selection/navigation, and mobile composition. Capture at 1440px desktop and 390px phone, with 320px reflow and tablet checks where relevant. Dynamic IDs/counts/text may differ; required panels and workflows may not disappear merely to pass a screenshot comparison. Review the screenshot, not just whether a file was produced. For an incremental delivery, name its visual subset and deferred panels in advance: read-only Agents can qualify focused output/layout without a terminal controller, and Results metadata can qualify its card/detail structure before media/comments. Keep the full tab's design-complete flag open until all required compositions and workflows are delivered.

For writes, test repeated clicks, exact operation retry after response loss, stale source revision, revoked access and draft preservation. For terminal output, keep the existing real-process/browser check and explicit incomplete/gap/expiry states. An unsupported control is disabled with a useful reason; a page of disabled controls does not satisfy a tab's delivery gate.

Navigation is part of the live gate: a new task/document/result link must reach a working authorized detail view, or clearly indicate that the destination is not available. Do not replace one placeholder tab with an attractive list of links into other placeholder tabs.

Retain fast component tests in aq-dashboard and focused owner/route tests in agent-q. Run the actual daemon + compiled bundle test per delivered slice; include configured Graph/playbooks/notification adapters only when needed. Large-data cases use bounded pages representing the existing 10,000-task/1,000-session/10,000-result test targets. Carry forward the [existing performance budgets](0001-dashboard-implementation.md#5-performance-and-browser-targets): lazy heavy routes, four ordinary requests in flight, pause hidden polling, and no full graph/history download. Measure server work separately from browser rendering; no fleet-performance claim follows from an empty page.

The integration owner rebuilds the bundle, restarts the local daemon that loads assets at startup, verifies the bundle identity and actual served route, and gives the user the exact URL and visible change. Source commits or passing mock tests alone do not demonstrate that the running preview changed. Keep a short per-tab record of **API connected / interactions working / design matched / live preview verified**, rather than one misleading dashboard-complete flag.

## First implementation assignment

1. Keep the native runner owner on WRK-08.
2. Start API-03 with task list/detail and bounded dependencies; share its authorization/query layer with knowledge reads.
3. Start UI-05 with the shell, panels and focused read-only Agents composition, then UI-12's existing operational reads. Connect UI-06 as API-03 freezes its first slice.
4. Integrate and show a real Work task/detail/graph plus Knowledge document and the improved Agents page before expanding to more backend owners. Review/Playbooks are the next paired deliveries.

This gives visible progress while the native runner advances, without waiting for terminal control, real supervisor replies, media capture or account quota to be finished.
