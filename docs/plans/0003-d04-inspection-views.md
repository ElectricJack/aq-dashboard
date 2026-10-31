# D04 — Overview, Work, graph, agent roster and search

Status: in progress, 2026-10-31. Executes work package D04 of the [implementation plan](0001-dashboard-implementation.md) on top of D03 ([plan](0002-d03-shell-scaffold.md)). Binding authority: [product design](../specs/0002-product-design.md) §3, §4, §6 (roster only), §9 and §10. API semantics: [API proposal](../specs/0003-dashboard-api.md) §2 and §4.

D01 has not published read models. 0003 §4 names the projections but not their fields, so this package adds **dashboard-proposed** field shapes in `src/api/wire/proposed.ts` and `contracts/proposed/`. They are input for API-02 review, not contracts. Vocabulary follows existing components where one exists: task state `draft | active | completed | canceled` and edge types from aq-graph's OpenAPI; process observation `unknown | reported_running | reported_stopped` from agent-q's lifecycle API.

## Global constraints

- All D03 constraints still apply (unknown is never zero, server time for ages, revisions stay strings, mocks never ship).
- The browser never derives readiness or runnable state from the graph. Explanations come from the server.
- Unknown enum values render as unsupported and disable dependent actions. Failed or partial reads never look like empty success.
- Collections are cursor-paged (default 25, max 100) and show `total` with its accuracy. Nothing downloads a full collection.
- Action descriptors are UI hints only. D04 renders no mutation; "next action" links navigate to the subject.
- Server-supplied text (titles, explanations, criteria) is rendered as plain text, never HTML.
- Scope is a structural part of every scoped query key.

## Tasks

1. **Proposed read shapes and adapters.** Page envelope (`items, next_cursor, has_more, snapshot_id, total`), Overview, TaskSummary/TaskDetail, TaskGraph, SessionSummary/SessionDetail, SearchHits. Adapters map wire to view models: unknown enums become `unsupported`, totals keep their accuracy, coverage is kept. Fixtures plus scenario variants (default, partial, failed, empty).
2. **Shared state presentation.** `QueryStatus` (loading, failed, unauthorized, unsupported, partial, empty-success with caller-supplied wording), `FreshnessLabel`, `CountLabel` (exact/estimated/unknown). Structural scope in query keys.
3. **Overview.** Needs attention rows (reason, impact, age, subject, next permitted action as a navigation link), counts with accuracy, Work in motion, Recent outcomes. "Nothing needs your attention" only after a complete successful read.
4. **Work list.** Paged rows (title, project, task state, execution observation, blocker/wait reason, agent, latest result), state filter in the URL, Load more, list + inspector on desktop, single pane on phone. Back restores selection and focus.
5. **Task detail.** Requirements, acceptance criteria, server dependency explanation, attempts, source/delivery facts kept distinct, links to sessions.
6. **Bounded graph.** Lazy-loaded SVG of the server-bounded neighbourhood, deterministic layered layout with stable positions, distinct hierarchy/dependency/informational edges, omitted counts, node selection, and a textual dependency list as an equivalent alternative.
7. **Agents roster and session detail.** Roster rows (task, project, provider/model/harness, observed state with freshness, wait reason, controller presence); session detail metadata. The terminal is D07 and is shown as unavailable.
8. **Search.** One dialog for button, Ctrl/⌘+K and touch; debounced scoped query; results grouped by type; keyboard navigation; bounded results.
9. **Browser checks and evidence.** Playwright and axe for the new pages at phone and desktop widths, the Back/focus restoration flow, and the evidence record.
