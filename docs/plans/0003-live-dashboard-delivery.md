# Live dashboard delivery and visual completion

Planning update: November 1, 2026. Audited AQ `468617f`, dashboard `e89da32`, and the accepted design gallery. This executes and subdivides [D00–D13](0001-dashboard-implementation.md); it does not replace the product design or claim that planned endpoints exist. Canonical task identities, ownership and dependencies live in [AQ's milestone graph](../../../agent-q/docs/plans/0001-v2-milestones.json). Writing this plan does not dispatch implementation or enable capabilities.

## Outcome and diagnosis

Every navigation destination should become a useful view of real AQ infrastructure, with the composition and interactions in the accepted mockups. At the audited planning baseline, five destinations were only `DestinationPage` stubs, Work used proposed mocks, and Overview was partial. Subsequent live integrations and visual corrections are recorded in `docs/implementation/` and `docs/evidence/`; the delivered matrix below records the current canonical preview and keeps isolated qualification separate.

The twelve selected [mockups](../design/index.html) and their [manifest](../design/manifest.json) remain the visual reference. [Product specification 0002](../specs/0002-product-design.md) governs behavior and resolves differences between mockup generations. Colors alone are insufficient: the missing columns, inspectors, timelines, feed, conversation and focused workspace are the main visual gap. Sample numbers and media in PNGs are never production data.

This work can run alongside the native worker runner. Task/knowledge reads, review and playbook inspection, historical results, notifications, worker status and visual layout do not require a live model. Real supervisor replies and interactive terminal control do require their respective runtime owners.

## Delivered increments and remaining gates at canonical state35

The [canonical Events35 promotion](../../../agent-q/docs/implementation/dashboard-canonical-events35-2026-11-01.md)
now binds actual `http://localhost:4188` to compiled bundle
`sha256:5c0fcfa4fe11cd95a9081edeb7323ef07f9d2c66bcf24b2add1ef546200ac667` and the retained 8ad state35 binary.
The database remains 35 even though latest source now includes internal media
migration 36. Composed 539 tests passed in 23.68s; typecheck and 1.65s/29-asset build
passed with no mocks. Canonical Source events passed in 1668ms (zero reports,
two explicit reads, zero writes), Supervisor in 2206ms (empty history/zero enqueue),
Graph in 4018ms (16 reads/zero mutations), and Overview in 889ms. The earlier 35/2b
and 34 records remain historical. Full parent feature/design tasks remain open.

| Destination | Canonical state35 delivered subset | Separate qualification | Remaining functional / visual gate |
| --- | --- | --- | --- |
| Overview | Recorded task/project contribution, partial attention/outcomes and accepted two-column grouping; account usage stays unavailable. | [Core Overview](../implementation/core-overview.md), actual canonical 889ms probe. | Complete review/result aggregation, actual capacity/provider sources, pinned-session persistence and full 01 composition. |
| Work | Authorized task list/detail/dependency graph, scope/navigation and task-create composer. | [One actual task creation](../implementation/create-task-live.md) uses disposable Graph/AQ state; canonical probes are read-only. | Editing, complete lifecycle/explanation/activity and remaining 02 controls. |
| Knowledge | Scoped library/search, readable current/pinned document, sources/verification metadata. | [Actual Work/Knowledge visual subset](../implementation/work-knowledge-visual-fidelity.md); canonical Graph 16-read proof. | Author/correct/verify/retire commands, richer history/relationships and full 07 design. |
| Decisions | Optional review owner is not configured; unavailable is not a successful empty inbox. | [Actual discovery/revision-bound answers](../implementation/decisions-live.md), including disposable response-loss recovery. | Mount actual optional owner; richer document/media evidence, discussion/comparisons and full 03 design. |
| Playbooks | Optional runtime/real UDS owner remains unavailable. | [Configured parent/child runs](../implementation/playbooks-inspection.md) plus [startup definitions 8fe proof](../evidence/loaded-definitions-browser/README.md): max 4, historical configuration, `current_catalog=false`, exact immutable pins. | Actual optional runtime/UDS qualification, current installed catalog/activation discovery, actions/editor and full 06 design. |
| Results | Retained legacy metadata/revision inspection. Bundled media UI remains capability-off; no image bytes are served. | [Metadata subset](../implementation/results-metadata.md); 44 media UI source checks; [internal SQL/managed-file owner](../../../agent-q/docs/implementation/API-11-storage-owner.md) passed 14 owner + 3 migration/drift cases, separate from pure PNG core. | Actual HTTP/config/capability binding, upload/image browsing and UI qualification, capture policy, comments/feedback and full 10/13 design. Source migration 36 is not canonical 35. |
| Agents | Focused read-only output, switcher/details, on-demand accounting and explicit Source events. Current canonical reports/accounting are absent. | [Usage inspection](../implementation/session-usage-inspection.md), [actual source-event proof](../implementation/session-source-events.md): empty canonical 1668ms plus three real-ingest synthetic usage records 1885ms; [shared header](../evidence/shell-mobile-responsive/README.md) retains 62px focused row/phone exit. | Transcript bytes/current producers, renderer/control, live interaction and full 08/11 design; historical reports do not grant authority or establish current accounting/quota. |
| Supervisor | One stable global human conversation; canonical history empty, runtime unavailable, text composer and pending-safe receipt/recovery. | [Exact 2b3d full-page visual and owner proof](../implementation/supervisor-conversation-foundation.md) enqueued one human message only in disposable state. Current 5c canonical scope/draft probe passed 2206ms and enqueued none; historical 2b owner proof remains retained. Pure AQ17/mapper source is not a live central runtime. | Dock/full shared draft/reading state, context/attachments/evidence cards, central dispatch/replies and full 04/09/12 design. Queued history is not an assistant reply. |
| Settings | Real identity/status/worker/project reads and current-account notification inspection. | [Notification owner/browser proof](../implementation/notification-inspection.md) has no external route/delivery. | Broader profile/observation/admin panels and supported actions; heartbeat does not establish capacity or eligibility. |
| Shared shell | Compact 114px phone brand/project + Search/usage/connection header at 390/320; 69px desktop; bounded reason overlay preserves composer allocation. | [Actual compiled-bundle screenshots](../evidence/shell-mobile-responsive/README.md), 44px controls, Close/Escape/search/scope focus. Earlier dev results are explicitly source-only. | Populated account-quota producer qualification and the remaining full shared-shell/feature acceptance. |

Search now uses the authorized human Graph adapter. Provider quota remains a
separate missing producer; session accounting and provider availability cannot
supply account-wide percentages or reset windows. No illustrative mockup facts
are substituted for absent data.

Native named/scoped source, KERNEL/static and isolated actual-tool proof remain
bounded; terminal output 409 and production capsule/key/context/provider gates
remain open. AQ17 now has a pure 16-test authority model and shared mapper source,
not durable dispatch/reply authority. [Native and central source/evidence limits](../../../agent-q/docs/implementation/dashboard-canonical-events35-2026-11-01.md)
are separate from these useful human dashboard increments.

## Parallel execution with eight subagents

The session has eight concurrent subagent slots plus the root coordinator. This is Codex development capacity, distinct from AQ worker/worktree capacity. Use two native lanes and six dashboard lanes initially. Each lane owns a concrete output and may cover backend and frontend for its isolated feature. Root reviews and integrates; eight agents do not require eight frontend writers or eight simultaneous builds.

| Subagent | Initial assignment | Ownership and next handoff |
| --- | --- | --- |
| 1. Native adapter | WRK-17: concrete pinned harness adapter, private configuration/startup delivery, observed readiness and process ownership | `aq-worker` adapter/host integration and `native/launch/*`; hands a narrow executor/preflight interface to lane 2. Actual provider qualification remains WRK-08 |
| 2. Native runner | WRK-18: production configuration/foreground command and native lifecycle orchestration | `main.rs`, configuration, new `native/runner/*`; tests orchestration with an explicit executor peer while lane 1 implements it. Joins the real adapter before enabling runtime admission |
| 3. Human Graph API | API-03: tasks, dependencies, knowledge/revision and scoped search inputs | New human Graph authorization/query modules and contracts. Freeze common human authorization first, then task and knowledge DTOs independently; next API-10 typed commands |
| 4. Shared visual and Agents | UI-13 shared interfaces, UI-05 visual composition, UI-17 focused read-only Agents | Shared tokens/components/shell, then `features/agents/`; next existing operational panels/UI-12. Publish component interfaces early so other UI owners can proceed |
| 5. Work and Knowledge | UI-06: real Work/list/graph/detail, Knowledge and Search UI | Feature-local modules/adapters/fixtures. Build layout against the published DTOs while lane 3 implements routes; complete task and knowledge increments independently |
| 6. Decisions vertical | API-04 + UI-07: actual discovery, evidence and revision-bound decisions | Review discovery module/tests and `features/decisions/`. Once delivered, take API-07/UI-16 conversation/history presentation; real supervisor replies still depend on AQ-17 |
| 7. Playbooks vertical | API-05 + UI-08: configured discovery, pinned run timeline and supported actions | Playbook discovery modules/tests and `features/playbooks/`. Once delivered, take API-11/UI-18 media, followed by feedback when API-10 is ready |
| 8. Results and Overview | API-06 + UI-14: real result metadata and exact evidence links | Result read modules/tests and metadata UI. After its first delivery take API-13/UI-15 partial Overview, then API-08/full UI-11 as source owners become ready |
| Root, additional coordinator | Shared integration, reviews, contract publication and actual preview | Own router/bootstrap/capability wiring, contract-lock integration, migration number allocation, merged checks and preview publication. Do not reserve a subagent solely to wait for other work |

Start all eight once assignments and file ownership are established. First exchange the native executor interface and the human Graph/review/playbook/result DTO sketches; freeze these narrow interfaces before paired implementations depend on them. Use actual schemas/fixtures as the handoff, with exact errors, scope, revision and capability semantics. A UI may build against its proposed fixture before freeze, but it cannot claim live integration from that fixture.

WRK-17 and WRK-18 can progress independently after their executor/preflight interface is agreed. The runner must not advertise an eligible runtime while only a fake executor exists. Both owners review the final join. After that join, collapse native work to one owner if the remaining steps are sequential; move the freed slot to the earliest unblocked dashboard feature, quota source, or integration qualification. If a backend feature is not yet configured, develop its mounted owner tests in an isolated configured fixture rather than waiting for a model to run.

### Integration order and reassignment

1. Freeze UI-13's panel/control/layout interfaces and initial read DTOs. This releases the feature UI work while UI-05's visual refinement continues.
2. Integrate the first completed vertical immediately. Reviews, Playbooks and Results metadata do not wait for all Graph reads or the native runner. Publish each visible change in the live preview after its own route/adapter/browser check.
3. Integrate Work/task/detail/dependencies and Knowledge as their respective Graph DTO/read slices stabilize. Keep API-03/UI-06 open until both scopes pass; do not withhold a working task view for unfinished document history.
4. Deliver API-13/UI-15's partial Overview when task/project facts are available. Reviews/results add source contributions independently. Missing contributions remain partial; page-local counts never become global totals.
5. Move completed owners to the next ready task: conversation/history, media, typed task/knowledge writes, notification/usage panels, then feedback and quota. A blocked real supervisor reply does not occupy a slot needed for ready read/UI work.
6. Join the native adapter and runner, then qualify the real runtime under WRK-08. Full supervisor reply, terminal control, hibernation and final product acceptance remain with their existing owners.

Provider quota is an independent source task. It does not gate core Overview delivery. Results metadata, media and feedback have separate child tasks. Supervisor presentation/history has a child task independent of the actual hosted reply. Each full parent remains open until all its declared behavior passes.

### File ownership and contracts

Each implementation agent uses isolated worktrees and one feature branch per repository it changes. A full-stack vertical may change both repositories, but declares a commit pair and integration order; it does not require a shared source checkout at runtime. No two agents write the same implementation file concurrently.

- **Root wiring:** AQ `lib.rs`, shared dashboard router/bootstrap/capability aggregation and public contract locks; UI `routes.tsx`, `destinations.ts`, `session.tsx`, generic query/client plumbing, global mock-handler composition and the existing shared live-test file. Feature owners supply small registration patches for root to apply after review. Existing feature `index.tsx` files are feature-owned, so replacing a stub usually needs no route edit.
- **Visual lane:** shell layout/CSS, shared tokens and generic controls. Freeze exports early; features use them without copying CSS or changing global styles. Root owns route registration; shell ownership does not include the whole `app/` directory.
- **Feature lanes:** own their directories and dedicated API adapters, DTO/fixture/handler modules, route tests and `tests/live/<feature>.spec.ts`. Avoid simultaneous expansion of `inspection.ts`, `inspectionData.ts`, `handlers.ts` or `framework.spec.ts`.
- **Native lanes:** lane 1 owns launch/host integration; lane 2 owns command/configuration/runner. Both review executor/preflight changes; promotion of the synthetic host is not an adapter implementation. Reuse the existing material owner and exact lifecycle journals.
- **Shared state:** reserve any new migration numbers through root. Frozen component archives/contracts are not edited in place. Each contract change identifies the consuming owner before it is integrated.

Enable a capability only after its mounted route and UI adapter are present in the same assembled candidate. An ordinary feature-specific missing-resource 404 stays within that feature; it does not disable dashboard navigation. A bootstrap 404 is a dashboard compatibility failure, and current SessionProvider globally fences protected contract failures (including shape/integrity mismatches), unsupported required contracts, and authentication/authorization failures. Optional feature version/shape isolation is a separate design decision; preserve scope/identity integrity and authentication fences, and do not assume that a non-JSON 200 is a harmless feature response. Independent features must not break otherwise working pages through premature capability publication. Navigation links reach a working detail or clearly indicate unavailability.

### Source concurrency and test concurrency

Eight source lanes share this host. Current observation: approximately 31 GiB RAM and 25 GiB free disk. These are resource facts, not a throughput qualification. Do not create a fresh multi-gigabyte Cargo cache for every worktree.

Root assigns exclusive access to existing compatible target caches; never run Cargo concurrently against the same target directory from different worktrees. Start with at most two heavy Rust build/link processes globally, each using `CARGO_BUILD_JOBS=2`. Allow one frontend production build or full browser qualification at a time. Fast isolated component tests and source work may continue concurrently. Reduce concurrency if memory, disk or timing evidence requires it; do not widen deadlines to make overloaded tests pass.

Use focused feature checks first and one composed check of the integrated candidate. Coordinate short quiet windows for the fixed-deadline Git/tmux/native process tests, then release the build slots immediately. Root updates/restarts the asset-loading preview and verifies the served bundle identity. Batch cross-feature reviews only when necessary; do not wait for all eight branches before showing the first useful delivery.

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
| UI-05 / aq-dashboard | D03 | Shared visual composition, responsive shell/panels/controls, empty/partial/unavailable states, and visual baselines. Own shell layout/CSS, shared components/tokens and design comparison checklist; root retains routes/session/query plumbing |
| UI-06 / aq-dashboard | D04, D11 | Connect `features/work/`, `features/knowledge/` and search to API-03; reuse existing list/graph components, build document/revision inspector |
| UI-07 / aq-dashboard | D05 | Build `features/decisions/`: inbox, evidence, exact-revision decision and recoverable pending/conflict draft |
| UI-08 / aq-dashboard | D11 | Build `features/playbooks/`: discovery, pinned run timeline, definitions/bindings/activations and only supported actions |
| UI-09 / aq-dashboard | D10 | Incremental `features/results/`: metadata first, media next, comments/feedback last. Each is a useful separately demonstrated increment; full task closes only with its backend owners |
| UI-10 / aq-dashboard | D06 | Build `features/supervisor/`: one shared dock/full/mobile conversation and draft; end-to-end real reply depends on AQ-17 |
| UI-11 / aq-dashboard | D04, D02 | Complete Overview's two-column composition, real aggregates/search links and provider strip using API-08/API-09. Each section reports its own coverage |
| UI-12 / aq-dashboard | D04, D12 first increment | Connect worker status, profile/catalog, existing session observation/usage and human notification inspection in Agents/Settings. Future waits/stall control stay in UI-04; no new runtime authority inferred from these reads |

### Bounded handoff and delivery tasks added for eight-way execution

| Task | Completion boundary |
| --- | --- |
| WRK-17 / aq-worker | Concrete pinned adapter and final exec/readiness/ownership boundary; integrates through the agreed executor interface |
| WRK-18 / aq-worker | Production runner/configuration/orchestration against that interface; final real execution remains WRK-08 |
| UI-13 / aq-dashboard | Shared component/layout interface handoff; feature tasks depend on this rather than all UI-05 visual refinement |
| API-13 / agent-q | Actual bounded task/project Overview contribution after API-03, before review/result aggregation |
| UI-14 / aq-dashboard | Results metadata and revision detail after API-06; independent of media/comments |
| UI-15 / aq-dashboard | Core Overview composition and actual partial summaries; independent of account quota |
| UI-16 / aq-dashboard | Conversation/history/composer increment after API-07; real hosted replies remain UI-10/AQ-17 |
| UI-17 / aq-dashboard | Focused read-only Agents workspace using existing APIs; full renderer/control remains UI-03 |
| UI-18 / aq-dashboard | Actual retained media browsing after API-11; independent of feedback creation |
| UI-19 / aq-dashboard | Comments/anchors and explicit feedback task UI after API-12 |

Full UI-09 rolls up UI-14/UI-18/UI-19. Full UI-11 requires UI-15 and the remaining aggregate/quota owners. Full UI-10 requires UI-16 plus AQ-17. UI-01 retains UI-05's complete shared visual acceptance, even though feature development and completion can proceed after UI-13. This distinction is represented in the validated dependency graph rather than left only in prose.

Full renderer/control remains UI-03/INT-02. Full hibernation/stall/notification workflows remain UI-04/INT-03. These owners are reused, not replaced with dashboard-side lifecycle logic.

## API and component boundaries

Keep `aq-dashboard` a separately built/tested static bundle. Browser traffic goes to AQ's human listener; it never receives worker/agent credentials, connects to a worker or Graph directly, or reads component databases. Owner-only project access remains Owner-only until an explicit project-level Viewer policy is implemented and tested. Existing session inspection ACLs do not automatically authorize every task or document in that project.

For each slice publish or pin its actual DTO/validator and capability, then mount and test the route before enabling the UI capability. Existing `/api/...` human APIs may be adapted directly when their semantics fit; do not add redundant endpoints solely for URL consistency. Any `/api/v1/tasks`, knowledge/search/list or conversation path in the old proposal is still proposed until implemented. Optional playbook/review owners require configured-runtime evidence, not a bootstrap flag set to true.

Graph remains authoritative for task/knowledge records; result/review/playbook/message owners retain their own domain facts. Read aggregation may cache or index disposable projections with source revisions, but must not create a second editable task database. Mailbox receipts remain authoritative for message delivery; a conversation projection references them rather than inventing delivery state. Partial cross-owner reads are not presented as an atomic snapshot.

Use bounded polling and existing observation cursors first. A general push stream is not required to make these tabs work. Ordinary reads must not contend with worker cleanup, renewal or control pools. Reuse pagination and current-authorization fencing; keep SQL/Graph work bounded as history grows, avoid a query per displayed row, and return explicit partial/unknown status when a source is absent.

## Functional and visual definition of done

The user's requirement that pages continue to match the mocks is tracked in the [visual acceptance checklist](../design/visual-acceptance.md). Feature owners must use its named references and composition checks during implementation and before preview promotion.

Every delivered increment has two independent gates:

1. **Working infrastructure:** public contract and actual mounted human API, supported authorization/scope, bounded pagination, loading/empty/partial/error behavior, real persisted state read through the owner, deep-link refresh, and a live browser flow. A read test uses actual Graph/runtime/result data created through domain APIs or isolated integration fixtures, not browser interception. Test fixtures are labelled and isolated; production routes never substitute mock data when a source is absent.
2. **Design completion:** compare the actual page against its named PNG and governing product spec. Check hierarchy, column/panel proportions, typography, density, controls, selection/navigation, and mobile composition. Capture at 1440px desktop and 390px phone, with 320px reflow and tablet checks where relevant. Dynamic IDs/counts/text may differ; required panels and workflows may not disappear merely to pass a screenshot comparison. Review the screenshot, not just whether a file was produced. For an incremental delivery, name its visual subset and deferred panels in advance: read-only Agents can qualify focused output/layout without a terminal controller, and Results metadata can qualify its card/detail structure before media/comments. Keep the full tab's design-complete flag open until all required compositions and workflows are delivered.

For writes, test repeated clicks, exact operation retry after response loss, stale source revision, revoked access and draft preservation. For terminal output, keep the existing real-process/browser check and explicit incomplete/gap/expiry states. An unsupported control is disabled with a useful reason; a page of disabled controls does not satisfy a tab's delivery gate.

Navigation is part of the live gate: a new task/document/result link must reach a working authorized detail view, or clearly indicate that the destination is not available. Do not replace one placeholder tab with an attractive list of links into other placeholder tabs.

Retain fast component tests in aq-dashboard and focused owner/route tests in agent-q. Run the actual daemon + compiled bundle test per delivered slice; include configured Graph/playbooks/notification adapters only when needed. Large-data cases use bounded pages representing the existing 10,000-task/1,000-session/10,000-result test targets. Carry forward the [existing performance budgets](0001-dashboard-implementation.md#5-performance-and-browser-targets): lazy heavy routes, four ordinary requests in flight, pause hidden polling, and no full graph/history download. Measure server work separately from browser rendering; no fleet-performance claim follows from an empty page.

The integration owner rebuilds the bundle, restarts the local daemon that loads assets at startup, verifies the bundle identity and actual served route, and gives the user the exact URL and visible change. Source commits or passing mock tests alone do not demonstrate that the running preview changed. Keep a short per-tab record of **API connected / interactions working / design matched / live preview verified**, rather than one misleading dashboard-complete flag.

## First implementation assignment

1. Root establishes file ownership, the executor/preflight interface between WRK-17/WRK-18, and the first read/UI contract handoffs.
2. Dispatch the eight rows above concurrently: two native, Graph, shared visual/Agents, Work/Knowledge, Decisions, Playbooks, and Results.
3. Land UI-13 early. Feature lanes may then close their own live/design increments without waiting for UI-05's entire refinement.
4. Publish the first completed real vertical, then continuously pull ready work into freed slots. Keep the full parent gates open until actual runtime, media, feedback and control behavior is qualified.

This replaces the earlier three-subagent allocation. It is a reviewed execution plan; updating it does not itself start implementation agents or change runtime capabilities.
