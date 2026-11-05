# G10 Agents Operations Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Agents focus workspace the operations view of a session (health/nudge, usage/cost, waits, notification retry, terminal reconnect, profile provenance) without changing the 08/11 composition.

**Architecture:** The existing Session details drawer (`SessionDrawer` in `Agents.tsx`) gains an operations view switch — Usage, Health, Waits, Notifications, Profile — and mounts only the selected view, so every read is on demand. New views live in `src/features/agents/operations/`. Missing server reads (stall ladder, H2 lineage/rate revision, H7 snapshot) render one concise "unavailable on this AQ server" line; nothing is invented.

**Tech Stack:** React 18, TypeScript, @tanstack/react-query, MSW, Vitest + Testing Library.

**Spec:** task steady-cascade-45.11 description; `docs/specs/0002-product-design.md` §6; references `docs/design/08-agents-focus-desktop.png`, `docs/design/11-agent-mobile-v2.png`.

## Global Constraints
- Missing values render "Unknown", never `0` / `$0`.
- Flat-subscription allocations are labelled "Flat subscription · not costed".
- Nudge only via `POST /api/v1/actions` kind `session.nudge`, stable `operation_id`; never writes terminal input.
- Waits: `GET /api/waits?project_id=` (bare JSON) filtered to this session's attempt; detail `GET /api/waits/{id}` on demand.
- Notification retry: `POST /api/notifications/retry {operation_id, delivery_id, expected_revision, accept_duplicate_risk:true}` after explicit duplicate-risk confirmation; operation id reused for re-sends of the same delivery revision.
- No webhook secrets, route configuration or credentials rendered.
- Reconnect re-reads the same terminal id; never relaunches, never acquires control.

## Review Focus
- Waits route 403/404/503 (non-owner, old server) → concise "Waits unavailable" line, no crash. (Task 3 test)
- Session without `session.nudge` permission → Nudge disabled with "unsupported" reason. (Task 2 test)
- Nudge transport failure → "Unknown" and resend posts identical bytes. (Task 2 test)
- Notification retry conflict (revision changed) → error shown, delivery refreshed, no duplicate claim. (Task 4 test)
- Phone width: view switch wraps inside the drawer; drawer close stays visible. (screenshot review, Task 6)

---

### Task 1: Operations view switch + Usage/Profile views
**Files:** Modify `src/features/agents/Agents.tsx` (drawer body), `src/features/agents/SessionUsage.tsx`; Create `src/features/agents/operations/OperationsViews.tsx`, `operations/Operations.module.css`; Test `src/features/agents/operations/Operations.test.tsx`, update `Agents.test.tsx`.
**Produces:** `OperationsNav({view, onView})`, `type OperationsView = "usage"|"health"|"waits"|"notifications"|"profile"`, `ProfileView({session})`.
- [ ] Test `agents_unknown_cost_renders_unknown`: usage fixture with `costs: []` and an unknown counter → "Unknown" text, no `$0`/`USD 0` anywhere in the region; subscription_allocation estimate → "Flat subscription · not costed"; rate card `id · version` shown as cost basis; "Task lineage totals unavailable on this AQ server".
- [ ] Profile view test: profile revisions, harness/model, "Effective permissions" list from `permissions`, requested permissions → "Requested permissions not reported by this AQ server".
- [ ] Implement; existing Agents test opens Profile view before asserting revisions/permissions.

### Task 2: Health view + nudge
**Files:** Create `operations/HealthView.tsx`, `operations/nudge.ts`; Modify `src/api/adapters/inspection.ts` (add `generation: string|null`, `lastOutputAt: string|null` to `SessionView`).
**Produces:** `freezeNudge(session, body): FrozenAction`, `nudgeState(op|null, error, controller): {kind:"queued"|"deferred"|"unknown"|"unsupported"|"not_sent", label}`.
- [ ] Tests: separate timestamped rows Heartbeat / Provider output / Semantic progress / Wait observation; "Stall state unavailable on this AQ server"; nudge posts `kind:"session.nudge"` with `payload.expected_generation`; confirmed + human controller → "Deferred"; confirmed → "Queued"; transport error → "Unknown" and resend reuses identical bytes; no permission → "Nudge unsupported".
- [ ] Implement using `actionRequest` from `features/actions/actionClient.ts`.

### Task 3: Waits view
**Files:** Create `src/api/adapters/waits.ts`, `operations/WaitsView.tsx`; MSW fixture in test.
**Produces:** `adaptWaitList(raw, attemptId): WaitRow[]`, `adaptWaitDetail(raw, id): WaitDetailView`.
- [ ] Test `waits_view_lists_registered_waits`: two waits for the attempt + one for another attempt → two rows with phase labels; opening one shows predicate members with verified source/result refs, deadline, continuation generation, admission blocker, execution label (warm / parked / retained hibernation / resume pending / running), "Cancelling a wait does not cancel the task", manual_override → "Manual early resume (override)", dependency vs producer labels.
- [ ] Test unavailable route → "Waits unavailable on this AQ server".

### Task 4: Notifications view + retry
**Files:** Create `operations/NotificationsView.tsx`; Modify `src/api/adapters/notifications.ts` (add `receipt?: string` for accepted_by_transport message id).
- [ ] Tests: inbox filtered to the session's project; delivery shows route, attempts, transport receipt, acknowledgment as separate facts; no route → "No external route was recorded"; retry requires confirm, posts once with stable operation id and `accept_duplicate_risk:true`, shows "Possible duplicate"; conflict shows error.

### Task 5: Terminal reconnect
**Files:** Create `src/features/agents/terminal/terminalSnapshot.ts`; Modify `InteractiveTerminal.tsx`.
- [ ] Test `snapshotLines(buffer, rows)` returns the last visible rows; pane shows frozen "Last observation" with a gap note after Disconnect and no control acquisition on Reconnect.

### Task 6: Verification + evidence
- [ ] `pnpm test -- -t "agents_unknown_cost_renders_unknown"`, `-t "waits_view_lists_registered_waits"`, agents folder tests, `pnpm typecheck`, lint.
- [ ] Desktop (1440) and phone (390) screenshots of focus workspace + drawers vs 08/11; write `docs/implementation/G10.md`.
