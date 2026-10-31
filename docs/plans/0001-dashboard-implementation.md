# Dashboard implementation plan

Status: proposed executable work breakdown, 2026-10-31. This plan completes the [product design](../specs/0002-product-design.md) through the [contract boundary](../specs/0003-dashboard-api.md). It expands the existing API-02/UI-01–UI-04 milestones without changing their status or silently modifying the ecosystem task graph. No tasks have been submitted to a daemon by writing this plan.

## 1. Architecture and stack decision

Use React with strict TypeScript and Vite to produce a static client bundle. Use React Router for addressable routes, TanStack Query for disposable server-state caching, CSS custom properties/modules for the design system, xterm.js for the terminal renderer, and native image/video elements for evidence. Use Vitest and Testing Library for components, Mock Service Worker for contract-derived HTTP scenarios, and Playwright with axe integration for browser tests. Use one package manager and committed lockfile; pin exact tool/runtime/package versions in UI-01 after a compatibility build. This specifies tools, not an unverified claim about their latest versions.

The static deployment and bounded client responsibilities are the reasons to choose this stack. No SSR, runtime Node service, persistent global domain store or browser graph replica is required. The existing v1 implementation may supply interaction lessons, but import no legacy client policy or internal API assumptions. TanStack Query's [official overview](https://tanstack.com/query/latest/docs/framework/react/overview) describes its server-state role; keep local drafts and terminal transport outside that cache.

Proposed source layout:

```text
src/
  app/                 shell, router, identity, capabilities, error boundaries
  api/generated/       pinned generated wire types and validators
  api/adapters/        existing/new wire -> explicit view models
  api/operations/      durable operation client and recovery UI
  components/          tokens, controls, tables, sheets, status, evidence viewers
  features/
    overview/ supervisor/ work/ results/ decisions/
    agents/ playbooks/ knowledge/ settings/
  terminal/            transport, epochs, input/control state, renderer adapter
  state/               in-memory drafts, navigation anchors, safe preferences
  mocks/               generated-contract fixtures and scenario handlers
tests/                  browser flows, compatibility, visual/accessibility checks
contracts/              pinned schemas, semantic vectors, provenance lock
```

Route modules are lazy loaded. Graph and terminal code do not inflate the first Overview route. Native semantic HTML precedes custom widgets. Use shared components for ScopePicker, ProviderUsageStrip, FreshnessLabel, ActionBar, OperationNotice, RevisionLink, EvidenceViewer, ResponsiveDetail, DraftComposer and Empty/Error states. Components receive typed view models; only the API layer understands wire-version differences.

## 2. State, polling and failure behavior

Query keys include principal, authorization revision, project scope, filter, entity identity/revision and contract version. On identity change, abort requests and clear protected caches, drafts, media object URLs and terminal subscriptions. Persist only harmless preferences such as font size, density and panel layout. Drafts remain in memory across route/layout changes; unexpected page/process termination may lose them in the first release and must not be described as durable saving.

Do not automatically hard-reload an incompatible tab with unsent drafts. Keep a local read-only draft recovery view, allow copy/export under the current user, and ask the user to reload after preserving it. An expired authenticated session can hold an inaccessible in-memory draft pending reauthentication by the same principal; a different principal clears it.

Starting polling budget: foreground overview/active roster 10s, detail 5s, inactive history 30s, provider quota 60s subject to server freshness and limits. Pause hidden ordinary pages; refresh on focus with jitter and deduplication. Pending operations poll at 1s then exponential backoff to 15s, respect Retry-After, and remain pending/unknown after a bounded foreground wait. Only one request per query key in flight. A client-wide scheduler caps ordinary domain requests at four concurrent and staggers refreshes. These are initial measurement targets, not accepted server capacity.

Terminal output follows its negotiated bounded transport independently. Do not invent a WebSocket requirement: the current adapter exposes bounded HTTP output reads and specialized mutations. Rendering occurs outside React message-by-message state; batch frames within the transport limits, signal gaps and request legitimate resynchronization. Watch acquisition and controller acquisition use distinct state machines. Terminal input never uses a generic optimistic mutation/retry helper.

Ordinary mutations allocate one operation ID when a draft is submitted, freeze bytes until a known disposition, and expose lookup/reconciliation. A click handler cannot allocate multiple actions while the first is unresolved. Only a deliberate changed submission creates a new ID. Persisted server operation discovery must allow recovery after a tab reload without persisting sensitive request bodies locally. Telemetry records route, capability, latency and opaque correlation IDs, never terminal text, chat bodies, raw input or media contents.

## 3. Delivery work packages and dependencies

IDs below are planning IDs, not existing AQ task IDs. Each package delivers source, schema/fixtures where applicable, tests and a short evidence record with exact artifact revisions. A separate owner can implement a package after its hard dependencies; no calendar or staffing estimate is implied.

| ID / owner | Deliverable | Hard dependencies | Acceptance / existing milestone |
| --- | --- | --- | --- |
| D00 / AQ + UI | Reconcile audit with selected runtime candidate; publish human route/contract inventory and capability bootstrap | Current component evidence | No reserved URL mistaken for live route; contract hashes pinned; API-02 |
| D01 / AQ | Task/session/overview/search read models and typed human actions, operation recovery, auth/scope/cursors | D00, relevant AQ domain adapters | Scope and stale/conflict/unknown fixtures plus mounted route tests; API-02 |
| D02 / AQ | Provider quota collector/aggregation contract and human endpoint | D00, selected provider sources | Used/window/reset/stale/unknown semantics, no secret exposure or double-counted accounts |
| D03 / UI | Static app scaffold, tokens, shell, navigation, responsive panels, mock harness | D00 published minimum schemas | Independent build/component checks; quota placeholders honest; UI-01 |
| D04 / UI | Overview, Work list/detail/bounded graph, workers/session roster and search | D01, D03 | Filter/back restoration, complete/partial/stale states, bounded rendering; UI-01 |
| D05 / AQ + UI | Pending-safe domain actions and Decisions | D01, D04, actual decision adapter | Exact-revision decision/cancel flow, lost response recovery, conflict draft; UI-02 |
| D06 / AQ + UI | Global conversation projection and dock/full/mobile chat | D00, D03, AQ-11 and AQ-17 | Stable global recipient, shared draft/scroll, reply history and unknown delivery |
| D07 / UI + relay owners | Focused terminal, safe watch/control, transcript and mobile keyboard | D03, session discovery from D01, qualified AQ-21/worker bridge contracts | Actual renderer/relay tests, no view resize/input replay; UI-03 / INT-02 |
| D08 / AQ + storage/producer owners | Results/artifact persistence, upload/finalize/retrieval, capture policy and completion-gate integration | D00, task/source authority, existing completion adapter | Required retained evidence enforced; bounded media and versioned waiver; new API-02 scope |
| D09 / AQ | Comments, anchors, feedback-task intent/link reconciliation and resolution | D08, task creation/receipt adapter | One task under lost response/crash; exact annotation stays pinned |
| D10 / UI | Results feed, media viewer, annotations, feedback draft and review states | D03, D08, D09 | Desktop/mobile flow, feed position, accessible media, no implicit work from comment |
| D11 / AQ + UI | Playbook and Knowledge authorized projections/forms | D00, D03, qualified playbook/graph adapters | Immutable run pins; correct revision/verification/retirement behavior |
| D12 / UI + AQ | Usage/waits/notifications views and recovery | D04, published observation/lifecycle/delivery adapters | Truthful incomplete accounting/wait/delivery states; UI-04 / INT-03 |
| D13 / UI + release owners | Package/compatibility manifest, embedded static assets, integration and mobile acceptance | D02, D05–D07, D10–D12 | Exact server+bundle test; stale-tab upgrade; REL-03 / INT-02 / INT-03 |

Work on visual components and proposed mocks may precede completed backend adapters, but a package's live acceptance still requires its hard dependencies. Existing milestones remain authoritative until owners incorporate this expansion. D02 and D08–D10 must be explicitly added to the product task graph; they were not implicit in the earlier one-action dashboard milestone.

## 4. Release slices

**Inspection slice:** D00–D04, excluding unsupported future capabilities. Deliver authenticated task/attempt inspection, agent roster, responsive shell and truthful quota states. A provider with no qualified source says unavailable. This slice is useful but not the complete approved dashboard.

**Operator slice:** D05–D07 and available D11/D12 projections. Deliver actual decisions, full/docked supervisor and a large controlled terminal only when their owner adapters qualify. Mock buttons are never enabled in a live build. Central supervisor and remote terminal readiness are independent.

**Evidence slice:** D08–D10, complete provider sources and D11/D12. Deliver media-backed Results and explicit comment-to-feedback workflow, then D13 assembled release acceptance. The full design is delivered only when all required surfaces and runtime workflows pass; a hidden capability cannot count as feature completion.

Feature flags represent negotiated backend capabilities, not local assertions that an endpoint probably exists. Unsupported routes have an explanatory landing state and preserve shareable navigation, without accidental network fallback to machine APIs.

## 5. Performance and browser targets

Initial acceptance budgets, to be measured on a named midrange phone and desktop plus reproducible CI throttling:

| Measurement | Target |
| --- | --- |
| Initial shell + Overview JavaScript | ≤300 KiB gzip, excluding lazy terminal/graph/media modules |
| Shell + selected route CSS | ≤75 KiB gzip |
| Initial visible interface | ≤2.5s under documented 4× CPU / 1.6 Mbps / 150ms RTT lab profile |
| Local interaction response | p95 ≤200ms for selection, tabs, drafts and menus in the measured fixture profile |
| Large data | 10,000 tasks / 1,000 sessions / 10,000 results represented through bounded pages, never full downloads |
| Live rendered collections | Typically ≤100 task rows and ≤40 result cards; use pagination/virtualization with accessible focus preservation |
| Result thumbnails | Target ≤150 KiB each; lazy originals; zero automatic audio playback |
| Terminal | Preserve published limits; measure actual output/input latency with INT-02; no additional unqualified latency guarantee |

Support current and previous stable desktop Chromium, Firefox and Safari plus current/previous iOS Safari and Android Chrome at release qualification. Record exact tested versions/devices in the release report. Browser emulation does not replace a real mobile keyboard test. Server latency and app rendering are reported separately. These budgets are requirements to test, not results of this documentation pass.

## 6. Acceptance scenarios

Original U1–U14 in [0001](../specs/0001-dashboard.md) remain applicable. Add these scenarios to contract fixtures, component tests or assembled integration as indicated. Automated accessibility checks supplement manual assessment; [Playwright's accessibility guidance](https://playwright.dev/docs/accessibility-testing) explicitly describes that combination.

| ID | Scenario / required result | Level |
| --- | --- | --- |
| D-A01 | All projects aggregates only authorized data; changing scope/identity cannot show another cache's items/counts | API + browser |
| D-A02 | Every route, full chat and focused terminal retains provider names/used percentage or explicit unknown; multiple windows and stale data remain truthful | Component + mobile |
| D-A03 | Failed/partial reads never render empty-success or zero; unknown lifecycle enums disable dependent actions | Contract + component |
| D-A04 | List/graph/filter/task navigation and Back restore selection, focus and reading anchor; refresh does not move click targets | Browser |
| D-A05 | Repeated click, dropped response, server restart and lookup uncertainty produce one logical action; changed payload conflicts | API + assembled |
| D-A06 | Decision on superseded source is refused, draft preserved; approval never marks merge/deploy without its receipt | API + browser |
| D-A07 | Dock/full/project navigation preserves one supervisor draft/history/context/scroll; phone keyboard leaves Send usable; IME Enter does not send | Browser + real phone |
| D-A08 | Global supervisor unavailable never sends to a worker; successor delivery uncertainty does not duplicate injection | API + assembled |
| D-A09 | Two viewers and two competing controllers: viewers cannot resize/input, only acknowledged controller operates, expiry/revocation stops input | Relay + assembled |
| D-A10 | Terminal gap/epoch change/disconnect/unknown injection, Unicode/full-screen app and stale lease all render faithfully; no replay or automatic reacquisition | Renderer + actual bridge |
| D-A11 | 320/390 portrait, landscape with keyboard, 768 tablet and 1440/1920 desktop preserve usable single-pane layouts; no tiny terminal tiles | Browser + real phone |
| D-A12 | Results paginate without jumping on arrival, return from media/comments to prior card, pause offscreen video and avoid eager original downloads | Browser |
| D-A13 | Missing/processing/expired required artifact blocks the configured gate; an authorized exact-policy waiver is auditable; presence does not equal acceptance | API + assembled |
| D-A14 | Region/time comment remains pinned after a new artifact/result revision; invalid anchors and foreign-scope refs are refused | API + browser |
| D-A15 | Post comment creates no task. Create feedback after response loss/crash creates exactly one task and reconciles link; Fix submitted remains unresolved | API + assembled |
| D-A16 | Forged MIME, oversized decode, digest mismatch, expired upload, permission revocation and range fetch receive bounded safe outcomes | Artifact API |
| D-A17 | Playbook definition update does not change run manifest; waits/unknown effects stay distinct; resume cannot bypass a decision | API + browser |
| D-A18 | Knowledge correction/conflict, pinned history, verification and retirement/successor remain separate and scoped | API + browser |
| D-A19 | Keyboard-only use, screen-reader route/overlay flow, contrast, reduced motion, 200% text/400% zoom and media text equivalents | Automated + manual |
| D-A20 | Malicious Markdown, task names, URLs, logs and terminal escapes cannot execute script or trigger clipboard writes; secrets absent from telemetry | Security fixtures |
| D-A21 | Actual embedded bundle authenticates, deep-links and recovers an incompatible old tab while preserving an unsent draft until deliberate reload | Product upgrade |
| D-A22 | Bounded fixtures meet recorded budgets; graph histories, thumbnail loading and terminal streams cannot starve controls | Performance |

Terminal integration must follow the [xterm.js security guidance](https://xtermjs.org/docs/guides/security/) and the stricter AQ watch/control contract. Run automated contrast/axe tests plus manual VoiceOver or NVDA flows; do not declare accessibility from screenshots or a passing scanner alone.

## 7. Packaging, rollout and definition of done

Build produces hashed static assets, an entry document and a manifest containing dashboard version, source revision, asset digests, schema digests, required/optional capabilities, toolchain provenance and test-report references. AQ verifies and embeds the bundle; its product manifest pins it. Entry/compatibility metadata revalidates on upgrade, hashed assets may be immutable. Deep links return the application entry only for known UI paths; API errors must never return HTML. Initial release has no service-worker cache.

Release qualification uses the selected immutable server, worker/relay and dashboard artifacts. Exercise a viewer and owner, scope restriction, unavailable services, a decision, terminal control, supervisor reply, media capture, feedback creation and stale-tab upgrade. Record limitations alongside the release, including terminal receipt/capacity limits and unsupported central authority. Feature rollout cannot claim unqualified providers or mobile platforms.

Rollback selects a compatible whole product manifest and respects backend migration constraints; replacing only the UI with an incompatible older bundle is not a recovery plan. Stop mutation features when contract compatibility cannot be established, while offering safe draft recovery.

Done means product behavior, published contracts, mounted authorized adapters, failure recovery, responsive/accessibility checks, measured budgets and embedded-bundle qualification all pass for the declared feature set. No new implementation, schema publication, integration test pass or deployment is asserted by this specification.
