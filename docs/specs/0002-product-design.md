# Dashboard product and interaction design

Status: implementation specification proposed from the accepted visual direction. Date: 2026-10-31. The user approved the mockup direction; this document supplies implementation decisions, not a claim that the APIs or application are implemented.

Implementation status, November 1, 2026: the [current availability matrix](../plans/0003-live-dashboard-delivery.md#delivered-increments-and-remaining-gates-at-canonical-state37) and [actual canonical cutover](../../../aq-server/docs/implementation/evidence/canonical-uds-empty-owner-live/README.md) now record canonical 4188 on AQ37/source511ee99, binary17698…7b25, with unchanged bundle624707…e663 and its existing 633 passing frontend tests. Actual same-database Unix-socket Playbooks and Decisions owners are mounted. Current Definitions/Activations are successful empty catalogs; explicit startup `deployments=[]` leaves the historical loaded-definitions capability false. Decisions read/resolve are enabled with an empty queue; no canonical answer or workflow was created by acceptance. Desktop/390/320 current-catalog and all-page reads, plus bounded actual Graph/Overview/Supervisor regressions, passed without mutations or rebuilding the UI.

The populated current-catalog, parent/child run and decision-action proofs remain separately labelled disposable evidence. No authored definitions, configured pipeline automation, dashboard run mutations, live Supervisor replies, provider quota or live terminal control are claimed. The canonical media owner remains unconfigured and uploads disabled; the supplemental PNG upload proof belongs only to isolated 4206. PostgreSQL is now a promoted canonical dependency protected from proof cleanup, with original data retained and a write-aware rollback boundary. Complete requirements/routes below remain the target, not blanket implementation claims.

Read with the [architecture baseline](0001-dashboard.md), [API contract proposal](0003-dashboard-api.md), [implementation plan](../plans/0001-dashboard-implementation.md), and [contract audit](../research/2026-10-31-contract-audit.md). Where a PNG conflicts with this text, this text governs behavior. The owner-approved Agents roster and grid in [spec 0009](0009-agents-terminal-workspace.md) supersede the earlier focused-only layout.

## 1. Product outcome and boundaries

An operator should immediately understand what needs attention, what is running, what it produced, and how to intervene. Reading a result and requesting a correction should be possible on a phone. Desktop provides space for investigation and terminal work; mobile provides a deliberate single-pane composition.

AQ remains the authority for authentication, scope, scheduling, actions, lifecycle, evidence retention and decisions. The browser owns presentation, navigation, drafts and disposable caches. It connects only to AQ's human API. Component databases, worker endpoints, provider credentials and internal graph services are never browser dependencies.

The complete target includes Overview, Supervisor, Work, Results, Decisions, Agents, Playbooks, Knowledge and basic Settings. Implementation can ship coherent capability-gated slices; the first inspection release does not constitute delivery of the full design. Bulk administration, arbitrary workflow editors, offline committed edits and a separate dashboard server are outside this release.

## 2. Visual references and design system

The [visual gallery](../design/index.html) preserves twelve selected PNGs, including desktop and mobile variants. All displayed projects, sessions, quota values and media controls are illustrative. The [asset manifest](../design/manifest.json) records source paths and content hashes.

| Surface | Reference |
| --- | --- |
| Overview | [Overview](../design/01-overview-v3.png) |
| Work and Decisions | [Work](../design/02-work-explorer-v3.png), [Decisions](../design/03-decision-workspace-v3.png) |
| Supervisor | [Docked](../design/04-supervisor-chat.png), [Full page](../design/09-supervisor-full-desktop.png), [Mobile](../design/12-supervisor-mobile.png) |
| Agents | [Focused desktop](../design/08-agents-focus-desktop.png), [Mobile](../design/11-agent-mobile-v2.png) |
| Results | [Desktop](../design/10-results-desktop-v2.png), [Mobile](../design/13-results-mobile-v2.png) |
| Playbooks and Knowledge | [Playbooks](../design/06-playbooks.png), [Knowledge](../design/07-knowledge-v2.png) |

Use these initial tokens; check actual rendered contrast before release:

| Token | Value / behavior |
| --- | --- |
| Canvas / panel / raised panel | `#111418` / `#191f26` / `#222a34` |
| Main / secondary text | `#eef1f5` / `#b6c1ce` |
| Accent / focus | `#b1b2ff` / `#f3c576` |
| Border | `#36414f`; do not rely on border alone for focus |
| Attention / error / success | Amber / coral / sage, always paired with text or icon |
| Spacing | 4, 8, 12, 16, 24, 32, 48 CSS px |
| Radius | 8px controls, 12px panels; subtle shadows only on overlays |
| Typography | System sans; 14px default, 13px metadata, 12px minimum, 16/18/20px section headings, 22–26px page titles (owner request 2026-11-06: one step down from 16/14 for v1-like density; Settings › Display scales every step); system monospace for terminal/code (terminal keeps its own ≥14px setting) |
| Layout | 224px desktop rail; 24px desktop gutters, 16px mobile; content width determined per surface |
| Motion | Short opacity/position transitions; honor reduced motion; no animated live row reordering |

Prefer dense, legible rows and deliberate empty space over a grid of decorative metrics. One primary action per local context. A chart must answer a question that a count or sentence cannot.

## 3. Application shell and information hierarchy

Navigation order is **Overview, Supervisor, Agents, Work, Results, Decisions, Playbooks, Knowledge**, with Settings and identity at the bottom. Supervisor is directly below Overview. The desktop rail stays visible in full-page chat. Explicit terminal Expand may collapse it.

**Owner update, November 10, 2026:** All eight destinations use the compact Agents header: one title/action row, shared spacing, and the supervisor launcher in that row. Keep touch controls usable at 390px and 320px. Remove introductory subtitle rows; secondary summaries stay inline on desktop.

The persistent top area contains scope, provider quota, search and connection/freshness affordances. The quota strip remains above every destination, including full chat and terminal focus. Quota is account-scoped and labelled accordingly; selecting a project must not imply that an account-wide percentage became project usage.

Each provider entry shows provider/account label, **percent used**, actual window name, reset time and observation freshness. Never invert remaining percentage into used without a defined source field. Unknown is “Usage unavailable,” never zero. A stale value retains its timestamp and stale label. Multiple windows disclose their individual percentages and reset times; do not invent a combined percentage. The preferred window comes from server policy, not a hard-coded assumption that “primary” means weekly. Distinguish quota, provider availability, session token/cost accounting and worker capacity.

All projects means all projects the current principal may see, with server-derived aggregate counts. Changing scope updates applicable queries and URL state. Global supervisor identity does not change. Counts must state when partial, filtered or estimated. Search returns bounded, scoped results grouped by task, session, result, playbook and knowledge; keyboard and touch share the same search dialog.

Routes:

| Route | Purpose and restorable URL state |
| --- | --- |
| `/overview` | Scope and attention filter |
| `/supervisor` | Stable global conversation; optional message/context reference |
| `/work`, `/work/:taskId` | Scope, list/graph, filters, sort, selected task/revision |
| `/results`, `/results/:resultId/revisions/:revision` | Feed mode, filters; immutable result deep link |
| `/decisions`, `/decisions/:decisionId` | Kind/status filter and exact subject revision |
| `/agents`, `/agents/swarm`, `/agents/history`, `/agents/:sessionId` | Terminal workspace, Swarm, History and legacy session detail; `/agents/sessions` redirects to History |
| `/playbooks`, `/playbooks/runs/:runId` | Runs/definitions/activations and selection |
| `/knowledge`, `/knowledge/:nodeId` | Scope/search/category; optional pinned revision |
| `/settings` | Identity, display/accessibility preferences, authorized configuration links |

Use IDs and filters in URLs, never secrets, message bodies or draft content. Browser Back restores list/feed position and focus to the initiating item. A deep link to inaccessible content returns a neutral unavailable view, without leaking its title. Docked supervisor is shell state; expansion navigates to `/supervisor` and remembers the return location.

## 4. Overview, Work and Decisions

**Overview.** Lead with Needs attention: pending human decisions, blocked or failed work requiring intervention, and uncertain operations requiring reconciliation. Each row shows reason, impact, age, exact subject and next permitted action. Follow with active work and recent results. Capacity and operational health are secondary. Empty attention means “Nothing needs your attention” only after a successful complete query; loading or failed reads must not resemble an empty queue.

**Work.** List and graph use the same scope/filter/selection. Rows show title, project, lifecycle, execution observation, blocker/wait reason, relevant agent and latest result. Detail contains requirements, acceptance criteria, dependency explanation, attempts, evidence, source/delivery state and history. Server explanations determine readiness; the browser must not derive runnable status from a graph traversal.

The graph initially renders a bounded neighborhood around the selected task, with a 100-node target cap and explicit omitted counts/expansion controls. Hierarchy, execution dependencies and informational evidence links have distinct styling and labels. Stable positions preserve orientation when data changes. A textual dependency list offers the same navigation without graph interaction. Mobile opens a dedicated graph view deliberately; task lists remain the default.

**Decisions.** One inbox can discover reviews, questions and failure interventions, but each retains its domain-specific form and permission. Show exact source/task/result revision, requested judgment, evidence availability, previous responses and downstream effect. Approve/reject/answer binds that revision. A newer subject shows a superseded warning; no automatic retargeting. The mobile action bar must not hide evidence or keyboard focus. Submission remains pending until the server confirms; a conflict retains the draft and presents a deliberate refresh/review path.

**Owner update, November 10, 2026:** Work offers Delete task with only “Are you sure?” confirmation. Deletion has no workflow gate or dependency refusal: incident links are removed and other tasks survive. Cancel task needs no entered reason and immediately records canceled task lifecycle; the server and worker complete native stop/disposition automatically.

Cancellation is an intent, not proof the process stopped. Source retained, result submitted, result accepted, task complete, candidate published and change merged/deployed are distinct facts wherever shown.

## 5. Supervisor: docked and full-page conversation

**Owner update, November 10, 2026:** support both a global supervisor and separate project supervisors. An explicit Supervisor selector chooses the recipient. Each conversation retains its own history, draft and unresolved operation identity across dock/full-page views. Saved intelligence profiles and Start/Stop controls operate on that supervisor. Verified task receipt links carry their project into Work.

**Implementation choice (my call):** keep controls inline on desktop and in a compact disclosure on phones. A fresh enabled controller reports Ready between real turns and Working during a turn. Confirmed enqueue releases the composer for the next message; uncertain requests retain exact-body retry and lookup. This delivered slice is text chat and verified task receipts; context/attachment composition and richer result/media cards below remain separate requirements.

The docked panel and full-page view share one conversation state, message collection, attachments, draft and reading position. Full page fills the area beside the rail and below the provider strip; message text has a comfortable maximum reading width. The phone always uses a full-page conversation. No duplicate conversation or new supervisor session is created by changing presentation.

The header names the selected supervisor. Global remains the default; changing the application project filter never silently changes the conversation recipient. A context chip identifies the exact task/result/document revision and can be removed before send. Result cards link to retained evidence. Message history is paginated; auto-scroll only when the reader is already at the bottom. Otherwise show a new-message marker.

The composer supports plain text and authorized artifact/context references. Enter sends on desktop; Shift+Enter adds a newline; mobile provides a labelled Send button. IME composition must not send prematurely. A local pending message remains identifiable through send retries. Show admitted/queued, delivery evidence, unknown and failure separately; an acknowledgement is not proof that the requested work was performed.

The supervisor can propose a feedback task. Display its editable draft and the explicit Create action unless an existing configured workflow already authorizes creation. An ordinary chat message must not imply blanket approval of later actions. If central supervisor authority is unavailable, show a clear unavailable state and preserve the draft; do not route messages to an arbitrary worker.

## 6. Agents and terminal workspace

**Swarm controls revision (owner, 2026-11-11):** the [revised Swarm prototype](../design/swarm-tree-v4.html) replaces the v3 header sliders. Provider-by-intelligence-class integer concurrency limits live in directly linkable Settings › Swarm, with saved Normal and Reduced usage profiles. Task requirements drive routing; a task waits for a matching slot without being downgraded to fill idle capacity. Limit reductions let running agents finish. A compact Swarm header shows running/waiting totals, provider usage and active mode, with a Reduced usage switch and Adjust limits link. Its details are collapsible; the collapsed state retains those essential controls and any pending/failure status. Remember the viewer's disclosure preference, keep keyboard access, and preserve tree pan, zoom and selection while toggling it. This prototype uses labelled sample data; the production controls and scheduler integration remain to be implemented under aq-server spec 0007 phase 3.

The roster shows current sessions with task, project, chosen provider/model/harness, observed state/freshness, wait reason and controller presence. Session detail distinguishes profile/configuration revisions, effective permissions, actual execution authority and last observed process activity. Secrets and unscoped prompts are excluded.

**Owner update, 2026-11-10:** Agents opens a searchable, narrow roster and up to four independently connected terminals. One fills the workspace, two are side by side, and three or four use a two-by-two grid. Below 1000px, a drawer and quick switcher show one selected terminal. Expand temporarily shows one pane; restoring preserves selections. Terminal text stays readable and uses internal horizontal panning. Closing disconnects the pane without stopping the agent. See [spec 0009](0009-agents-terminal-workspace.md) for lifecycle, scope and history behavior. This grid and roster intentionally supersede the focused desktop reference's two-pane and permanent-roster restrictions.

**Owner update, 2026-11-10:** opening a terminal automatically connects for interactive input. There is no watch/edit mode selector or Take/Release control workflow. The transport still obtains and renews the confirmed server controller lease/fence before enabling keystrokes, paste or resize. Display connection readiness and controller conflicts without offering a mode switch. On mobile, use internal horizontal terminal panning and a minimum 14px monospace default; provide text-size controls. The transcript remains an alternative output view.

Connection loss freezes input and retains the last observation. Reconnect requests authorized output for the same identity and epoch, then automatically restores interactive control; it never relaunches the process or replays buffered keystrokes. Unknown input delivery pauses typing until a fresh-capture resolution. Keep finite/epoch identity checks and published input limits. Manual agents stay running across dashboard disconnects and turns, until explicitly stopped. Manual launch chooses a project without an assignment or popup, and immediately shows a graph node with pending/preparing/ready progress. Selected-worker slot controls show and change that project's capacity; removing busy capacity drains it without killing an agent.

**Owner layout update, 2026-11-10:** keep the Agents heading and launcher on a compact row. Selected-agent identity, model, status and actions use a compact header; the terminal takes most of the properties pane and fills the remaining viewport height. On-screen keyboard controls appear only on phones.

On phones, Back returns to the roster. Hide normal bottom navigation in focused terminal mode. Use visible viewport height and safe-area insets when the keyboard opens; keep quota, terminal status and essential input controls visible while collapsing secondary chrome. Offer Esc, Tab, Ctrl and arrows with clear active modifier state. Rotation must not acquire control or restart; a controller resize is debounced and sequenced, never sent from a viewer. Test real IME, paste, selection, alternate-screen programs and wide Unicode.

Disable unsafe terminal escape actions, automatic clipboard access and untrusted links. Bound scrollback, frame queues and renderer work. Durable Message and domain Cancel remain separate from terminal input; Ctrl-C is not authoritative cancellation.

## 7. Results, capture requirements and feedback

Results is a first-class media feed: Latest, Needs review and Following. Scope, task, media type and time filters apply consistently. Latest sorts by submitted time and stable identity. New arrivals create a “New results available” prompt without moving the current card. Load bounded pages with a keyboard-accessible Load more option, thumbnails first, and no autoplay with sound. Pause offscreen video and retain a bounded window of cards while restoring reading position.

Each card contains a summary, task/project, originating attempt, exact result revision and source commit where applicable, submission time, required-evidence status, artifacts and separate acceptance status. A result may have no Git commit; it must declare the applicable source identity rather than inventing one. Open images at full resolution, clips with native accessible playback controls, and before/after comparisons with explicit artifact identities. Expired, processing, withheld, missing or failed media has an informative placeholder.

Capture requirements are a versioned task policy snapshot. Visual changes ordinarily request named desktop/mobile screenshots; interaction changes request a short clip demonstrating named steps; backend work requests tests, logs or API evidence. A backend task does not need a meaningless video. Server policy evaluates applicability and required evidence; the client displays its explanation.

Required artifacts must be finalized, retained and bound to the evaluated result revision before a configured completion gate passes. Presence alone does not prove correctness, acceptance or completion. A waiver requires the authorized actor, reason, requirement identity and policy revision. Editing requirements after an attempt starts is an explicit versioned change; it cannot silently make old evidence applicable to new criteria.

Comments may attach to a whole result revision, a normalized screenshot region or a video time/range. The UI shows exact pinned artifact/revision and the original annotation even if a later result supersedes it. Author and time are visible. Mobile uses a full-width comments sheet/page and an explicit media-expand action; touch placement is adjustable before posting.

Feedback flow:

1. Post a comment. This creates discussion only; it does not reopen or schedule work.
2. Choose Create feedback task, or Link existing task. A draft contains the requested change, acceptance criteria, project, parent task, result/artifact revision and annotation. The user can edit it.
3. Submit with a stable operation ID and required version guards. Display pending/unknown/conflict faithfully; repeated clicks cannot create extra tasks.
4. Follow the linked work. A later result references the original feedback and prior result.
5. Show “Fix submitted” until the authorized reviewer or configured verification policy resolves the thread against an exact result revision. A successful task alone does not resolve the comment.

Capture only the intended application/test scenario. AQ enforces authorized upload/retrieval and media limits. Keep artifact references and tombstones when bytes expire so existing discussion still has intelligible provenance. The API proposal defines retention holds, bounds and partial-failure recovery.

## 8. Playbooks and Knowledge

**Playbooks.** Separate Runs, Definitions and Activations. A run shows its pinned artifact and transitive dependency versions, step timeline, current wait, child runs, pending operations, receipts and authorized actions. Updating an active definition does not relabel existing runs. Source editing, compilation, installation and activation are separate operations. Compilation validates structure; it is not proof of faithful policy translation. Human gates appear only where configured. Resuming a run cannot bypass the outstanding domain decision. Mobile uses a vertical step timeline and one detail page.

**Knowledge.** Search/filter by scope, category, lifecycle and verification independently. Detail shows document content, exact revision, author/provenance, sources, linked work, revision history, verification assertions and validity/review dates. Current and pinned history are unmistakable. A verifier's assertion is not proof of task completion. Retirement and successor links do not erase historical revisions. Authoring, correction, verification and retirement use separate permitted actions and expected versions; no generic JSON editor. Mobile opens one full document, with section navigation and metadata disclosures.

## 9. Responsive and accessible behavior

| Surface | Wide desktop, typically ≥1200px | Tablet, typically 768–1199px | Phone, <768px |
| --- | --- | --- | --- |
| Shell | Rail, quota header, optional inspector | Compact rail; one optional overlay | Menu + persistent compact quota; bottom destinations |
| Overview / Work | List and selected inspector | List then detail | Single list then full detail |
| Supervisor | Docked or full workspace | Full page by default | Full page, keyboard-aware composer |
| Agents | Roster and up to four terminal panes | One terminal with switcher and roster drawer below 1000px | One terminal with switcher and roster drawer |
| Results | Centered feed + selected comment panel | Feed, comments overlay | One feed, full-width comments |
| Decisions | Evidence + decision form | Stacked evidence/form | Evidence first, safe sticky actions |
| Playbooks / Knowledge | List + detail | One detail pane | Timeline/document page |

These breakpoints are initial design values; content fit and font scaling govern adaptations. Phone bottom destinations are Overview, Results, Supervisor, Agents and More. More includes Work, Decisions, Playbooks, Knowledge and Settings. Focused text entry may collapse bottom navigation; return restores it. At 320px, provider entries may wrap into two rows; never force whole-app horizontal scrolling. Essential two-dimensional content may scroll inside its own labelled region.

Target WCAG 2.2 AA, including keyboard operation, visible/unobscured focus, semantic headings/landmarks, labelled icons, contrast, status announcements and reduced motion. Use 44px primary touch targets as a product choice (shell navigation everywhere; every control on touch and phone layouts — secondary controls on fine-pointer desktop layouts use the 36px `--control-height`); WCAG's AA minimum target criterion is 24px with defined exceptions. Reflow exceptions for terminals/graphs do not exempt the rest of the application. See [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [Reflow guidance](https://www.w3.org/WAI/WCAG21/Understanding/reflow).

Drawers/dialogs trap focus only while modal and restore it on close. Never announce every terminal frame through a live region. Provide a bounded transcript/read mode and explicit status changes. Clip instructions should have text equivalents; audio-bearing evidence needs captions/transcript when required for understanding. Color never carries a state alone. Static PNGs do not establish conformance.

## 10. Shared state and failure presentation

Every surface supports initial loading, successful empty, partial/truncated, stale, disconnected, unauthorized, unsupported and failed states. Keep previously fetched content only within the active identity/scope and mark its age. Unavailable data must not become a zero count. Server time/freshness drives age and expiry labels; local timers never authorize actions.

Permitted-action descriptors explain why an action is unavailable, but the server rechecks authorization on every request. Pending operations display their identity and reconciliation link. A lost response is unknown, not failure or success. Conflicts preserve the draft; changing the payload after conflict requires explicit resubmission with a new operation identity. Logout/identity change clears protected caches and drafts; display/layout preferences may persist without content.

Acceptance is defined by the scenario matrix in the implementation plan. The original U1–U14 remain required; this specification adds quota, responsive composition, expanded chat and the Results/feedback lifecycle.
