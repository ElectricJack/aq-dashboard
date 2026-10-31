# Agent Q dashboard design

**Status:** Architecture baseline; implementation pending. Product design and frontend selection are expanded in the specifications below.

**Date:** 2026-10-30

aq-dashboard is an independently tested browser client of the AQ daemon. It presents work, evidence, execution, workflows and decisions through the same authorized domain operations available to other AQ clients. The [ecosystem design](../../../agent-q/docs/architecture/0001-ecosystem-and-releases.md) owns product assembly and releases.

The 2026-10-31 [product design](0002-product-design.md), [API proposal](0003-dashboard-api.md), [implementation plan](../plans/0001-dashboard-implementation.md) and [contract audit](../research/2026-10-31-contract-audit.md) extend this baseline. They select the visual/interaction direction and implementation approach without claiming that proposed APIs have shipped. U1–U14 and the authority boundaries below remain applicable.

## 1. Responsibility boundary

| Dashboard owns | Daemon owns |
| --- | --- |
| Screens, navigation, accessible controls and visualization | Authentication, authorization and domain operations |
| Form drafts, user preferences and disposable request caches | Authoritative task, graph, execution and workflow facts |
| Explaining progress and displaying pending actions | Computing consistent reasons, eligibility and action preconditions |
| Frontend unit/component and accessibility tests | API contracts, policy correctness and product integration |

The browser connects only to AQ's public API. It does not query aq-graph/PostgreSQL, call aq-git sockets or contact workers. It has no graph service or worker credentials. No dashboard-specific backend or shared UI-library repository is required initially. Scheduling, approval, task completion and integration policy stay in the daemon; hiding a button is not an authorization control.

## 2. Initial product surfaces

The first useful dashboard should support:

- Project/task views with requirements, dependencies, bounded context, decisions and evidence links.
- Attempt timelines distinguishing authority, observed execution, source retention, result acceptance and graph completion.
- Worker capacity, project eligibility, connection freshness, drain state and protected pending storage.
- Playbook runs showing active waits, child workflows, pending operations and human decisions.
- Supervisor/agent message history and explicit delivery status.
- An actionable explanation view for waiting, blocked, uncertain or failed work.
- Resolved agent/intelligence/execution profile inspection and live tmux session watch/control through AQ's central API, as specified in section 8.

These are information and interaction requirements, not a commitment to build every screen in the first UI milestone. Start with task/attempt inspection, worker status and one authorized action flow. Full v1 dashboard parity is not a launch requirement.

## 3. API and state semantics

AQ publishes versioned schemas suitable for generating frontend types and clients. The dashboard pins the API contract and uses mocks derived from its examples. An API compatibility mismatch shows an actionable error; it must not silently interpret unknown lifecycle states as success.

Read views include source identity, relevant revision/sequence, observed time, truncation and pending-operation references. Display “last reported running” separately from current execution authority. Distinguish source uploaded, source retained, result accepted and task complete. The canonical meanings come from [execution and recovery](../../../agent-q/docs/architecture/0002-execution-and-recovery.md).

Mutations send stable operation identities and required expected versions. A click can enter pending state immediately, but optimistic presentation must not fabricate approval, cancellation completion, publication or graph success. Lost responses lead to status lookup or identical-request retry. Conflicts preserve the user's draft and display current information for a deliberate revision; retries cannot silently overwrite intervening changes.

Capabilities returned by the API can guide available controls, but the server rechecks every action. Confirmation is appropriate for destructive/domain-significant actions according to product policy; the UI must not introduce a separate blanket approval system for ordinary authorized edits. Decision controls bind to the exact proposal/evidence revision shown to the user.

## 4. Authentication, caching and content

The initial static application is served by AQ at the same origin and uses the established human authentication/session boundary. Apply the daemon's CSRF/origin protections for state-changing browser requests. Do not store machine/service credentials or long-lived bearer secrets in browser storage. User identity/role changes clear protected client caches.

Treat graph content, Markdown, logs and model output as untrusted presentation input. Render safely, constrain links and never execute content-provided scripts. Limit transcript/log retrieval and show gaps or truncation. Accessibility includes keyboard navigation, focus management, semantic status announcements and non-color-only states.

Browser caches are disposable and scoped to the authenticated identity/project. Offline viewing can expose clearly stale previously fetched content under the chosen session policy; offline edits remain local drafts and cannot be represented as applied operations. Persistent offline storage of sensitive content is excluded from the initial release.

## 5. Updates and performance

Start with bounded pagination and adaptive polling through AQ's API for domain views. Coalesce repeated reads, pause unnecessary background refresh, and cap rendering work for large lists/timelines. Session terminals use the bounded watch/control transport in section 8; server-to-browser streaming does not change the outbound-only worker protocol. Do not require one full-graph reload per heartbeat or screen refresh.

Test large paginated task lists, long attempt histories and disconnected/reconnecting sessions. Include dashboard traffic in the product scale profile. Performance budgets for rendering and bundle size are selected with the frontend framework and target mobile/desktop hardware; do not claim them from graph service benchmarks.

## 6. Packaging and compatibility

The repository independently builds a static bundle and publishes a versioned archive with digest, source/build provenance and required AQ API versions/capabilities. The AQ product build verifies and embeds the selected bundle in its server image; the product manifest records its identity. Users receive one installed product and URL without another mandatory UI service.

Hashed assets may be cached immutably; the application entry document and runtime compatibility metadata must revalidate across product upgrades. A stale browser tab must detect API incompatibility and reload safely without losing an unsent draft. Avoid service-worker caching that can indefinitely pair old UI code with new APIs. Optional independent hosting requires an explicit authentication/CORS/deployment contract and is deferred.

Normal development runs against a contract-derived mock API or a local daemon. A developer may override the bundled UI without changing official release inputs. No runtime Node.js server is required for the baseline static deployment, although frontend build tooling is selected later.

## 7. Independent and product tests

| ID | Acceptance |
| --- | --- |
| U1 | Build and run component tests with mocks, without AQ workers, graph, Git or PostgreSQL. |
| U2 | Compile/type-check generated API bindings and detect drift against the pinned contract. |
| U3 | Display stale observations, unknown outcomes, pending writes and conflict responses correctly. |
| U4 | Cancel/approve/message flows call central domain APIs; server authorization rejects forged or stale requests. |
| U5 | Lost mutation response and repeated click do not create duplicate logical actions; revision conflicts preserve drafts. |
| U6 | Verify keyboard/focus/status accessibility and safe rendering of malicious graph/log content. |
| U7 | Test the actual embedded bundle against its product server, including authentication, task/attempt inspection and one decision flow. |
| U8 | Upgrade server/bundle with an existing browser tab; detect incompatible API and serve matching assets without stale success claims. |
| U9 | Show resolved agent/intelligence/execution profiles, concrete harness/model, instruction provenance and effective permissions without exposing secrets or treating requested capabilities as grants. |
| U10 | Watch remote and central tmux sessions through AQ; exclusive fenced control and message delivery remain separate, authorized operations. |
| U11 | Reconnect, output gaps, resize, unknown input delivery, controller changes and stopped sessions are explicit; no stale input replay, implicit relaunch or unsafe terminal escape handling occurs. |
| U12 | Session timelines expose transcript provenance/gaps, reported versus estimated/unknown usage and cost, stall evidence and safe nudge/recovery dispositions. |
| U13 | Wait views distinguish warm waiting, parking, retained hibernation, resume pending and running; show verified dependency outcome, continuation generation, held resources and wake/cancel conflicts. |
| U14 | Notification/escalation/digest views separate queued, transport acceptance, ambiguous/failed delivery, human acknowledgment and revision-bound decision; safe retries preserve identity. |

Framework choice, visual design, first-screen scope and rendering budgets are specified in the linked product design and implementation plan. A separate dashboard backend, direct component access and duplicate lifecycle logic are outside this baseline; new human API projections remain part of AQ.

## 8. Agent profiles and session terminals

The canonical [profiles, intelligence and terminal design](../../../agent-q/docs/architecture/0003-agent-profiles-harnesses-and-terminals.md) owns shared semantics and limits. UI-03 adds this product-required surface after the initial UI scaffold; it is required by INT-02 and the final product gate. The earlier one-action UI milestone does not qualify terminal access or the four required harnesses.

The session inspector displays profile/catalog revisions, chosen intelligence and execution settings, concrete provider/model/harness versions, explanation/provenance and the current execution authority separately from last observed process state. Prompt inspection is scoped and redacted by AQ. Display missing/unsupported optional harness capabilities and reasons; do not infer capability from a visible terminal.

Opening a terminal acquires a scoped watch subscription through AQ. The browser never knows a worker credential, tmux socket path or inbound worker endpoint. It renders the initial snapshot/epoch and sequenced frames, showing output gaps and resynchronization explicitly. A disconnect shows last observation time. Reconnect requests replay or a fresh snapshot for the same session; it never starts a new agent. Closed sessions expose only authorized retained output.

Watch mode is read-only. Taking control is a distinct authorized action with one controller lease, visible controller identity, expiry and handoff state. Only the controller sends literal input/paste or changes terminal dimensions. Viewers adapt their viewport without resizing the actual pane. Keyboard shortcuts cannot bypass watch mode; multi-tab reconnect does not acquire a new lease automatically. Show pending/applied/unknown input accurately. Unknown injection pauses new interactive input until an explicit resolution with a fresh view; never replay unsent/stale queued keystrokes after reconnect.

The message composer uses AQ's durable mailbox and displays delivery status. It is separate from literal terminal input. Stop/cancel uses the typed execution API; a terminal Ctrl-C gesture is not proof of cancellation or stopped writers. Profile/grant changes and domain approvals use their authorized domain actions even when a terminal is open.

Treat output as untrusted terminal data. Disable automatic clipboard writes and unsafe escape-triggered actions, constrain links, and bound renderer memory/scrollback. Do not persist terminal contents or raw input in browser storage by default. Provide keyboard-accessible watch/control controls, a plain-text read view and accessible connection/delivery status. Maintain snapshot/output barriers across alternate screen, Unicode and resizing; a screenshot or static text pane alone does not pass interactive acceptance.

Component tests use contract-derived fake streams and clocks for multiple viewers, controller races, revoked scope, stale epochs, gaps, dropped acknowledgements, full-screen UI output and upgrades. INT-02 runs browser integration against the actual AQ relay and worker bridge for Codex CLI, Claude Code, Gemini CLI and OpenCode at their pinned versions. Measure the shared latency/buffer profile; no separate Node.js runtime service or worker tunnel is introduced.

## 9. Session operations, waiting and human delivery

UI-04 implements the [shared operations and waits design](../../../agent-q/docs/architecture/0004-session-operations-waits-and-notifications.md).
Extend the existing inspector with bounded transcript events, parser/source
freshness, usage completeness, cost basis/currency/rate revision and task-lineage
totals. Missing accounting is unknown, not zero. Show separate heartbeat, provider
activity, semantic-progress and wait observations. Stall actions expose the current
rung, evidence, deferred/unknown nudge and quarantine scope; control does not grant
permission to override stop/retention requirements.

The wait view shows the actual predicate and its verified source/result references,
deadline policy, summary/source retention, continuation generation and admission
blocker. Distinguish released compute from protected disk and resolved dependency
from successful producer outcome. A wake can be pending capacity or held by missing
source/stop proof. Manual early resume is labelled as an override, not dependency
success; task cancellation differs from cancelling only a wait. Repeated actions
use stable IDs and expected revisions, preserving pending/conflict states.

Notification views expose logical message, configured route, delivery attempts,
transport receipt, unknown/failed delivery and separate escalation acknowledgment.
Show a missing external route plainly. Decisions reached through Discord links
still authenticate against AQ and the exact question/subject revision. Digest
history identifies its reporting window and winning message. Never show webhook
secrets or make ambiguous delivery look safely unsent. A retry with possible
external duplication must present that known disposition.

Use contract-derived mocks for core rendering/action tests. INT-03 qualifies the
assembled browser and CLI for hibernation/cross-node wake, stall recovery, corrected
usage and notification failure/decision flows. No direct provider/worker access,
separate notification backend or browser-owned lifecycle state is introduced.
