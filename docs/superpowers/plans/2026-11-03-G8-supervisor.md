# Supervisor dock and live conversation Implementation Plan

> **For agentic workers:** Execute natively in this session under the assigned G8 task. Steps use checkbox syntax.

**Goal:** One pending-safe global conversation in desktop dock, full page and keyboard-aware phone layouts.

**Architecture:** Keep a single conversation mounted in the shell; change its presentation and URL without remounting or creating a session. Preserve the existing frozen-message and draft recovery boundaries, consume mixed human/supervisor history, and send immutable G1b actions.

**Tech Stack:** React, TypeScript, React Query, React Router, Vitest, Playwright.

**Spec:** Task steady-cascade-45.9; docs/specs/0002-product-design.md §3/§5; docs/specs/0003-dashboard-api.md §5; design references 04, 09, 12.

## Accepted execution amendment

Integration-owner message `msg-f6c0d9013c2f4249b667f10fe38b6f3c` authorizes the labelled local test double as this increment's send/reply evidence: no verified live origin is available. F2 PR #48 has no typed conversation proposal/receipt attachment contract. Deliver typed standalone card boundaries and file the owner follow-up; do not infer attachments from prose. Actual live qualification and full proposal/receipt conversation wiring remain operator/owner steps, recorded in `docs/implementation/G8.md`.

## Global Constraints

- Use shared tokens, preserve rail/quota and responsive composition; hide unsupported context/attachments.
- Never infer task creation or delivery from acknowledgement or arbitrary prose; consume published receipts only.
- No second writable lifecycle, backend dispatch implementation or invented reply facts.
- Verify focused tests, lint/typecheck, compiled-browser captures and actual live send/reply. Evidence: docs/implementation/G8.md.
- Publish only the assigned branch through aq git; integration owner owns main.

## Review Focus

- Presentation changes during an ambiguous send retain the exact IDs/body and operation.
- Reply cursors A.R round-trip unchanged and delivery updates do not replace immutable message facts.
- Reader scrolled away from bottom is not moved when a reply arrives.
- Capability/runtime loss preserves drafts and prevents sending.
- IME/Shift+Enter do not send; phone Send and exits remain visible above keyboard/navigation.

### Task 1: Wire replies and action transport

**Files:** src/api/adapters/supervisor.ts, src/api/adapters/supervisor.test.ts, src/test/supervisor.ts, contracts/live/supervisor-conversation/*; new src/features/supervisor/supervisorAction.ts.
**Interfaces:** Consume F1b History and G1b supervisor.message.send. Produce validated SupervisorMessage union and immutable action bytes; operations bind original ID, conversation and digest.

- [x] Write failing mixed-reply, A.R pagination, delivery-update and action identity tests.
- [x] Run `pnpm test -- src/api/adapters/supervisor.test.ts` and observe red.
- [x] Implement published union and action request/lookup; update pinned owner schema/fixtures with provenance.
- [x] Run focused adapter/client tests and observe green, including the unchanged G1b owner confirmation digest.
- [x] Include wire increment in the final unpublished squash.

### Task 2: Shared dock/full presentation

**Files:** src/features/supervisor/SupervisorConversation.tsx/.module.css/.test.tsx; new SupervisorWorkspace.tsx; src/features/supervisor/index.tsx; src/app/Shell.tsx.
**Interfaces:** Shell mounts SupervisorWorkspace once per principal/authorization identity. Workspace chooses dock/full presentation with return path and retains conversation DOM/state.

- [x] Add failing `supervisor_dock_send_shows_pending_then_reply`: open dock, send pending, expand, receive actual fixture reply, dock back, assert same operation and return route.
- [x] Run named test and observe red.
- [x] Implement shell mount, presentation controls, pending item, live history refresh, delivery labels, action recovery, conditional availability and scroll marker.
- [x] Add focused tests for IME, unavailable draft retention, scrolled reader, mobile/tablet presentation and receipt links/proposals where published contracts support them.
- [x] Run supervisor area tests and Shell checks; include in the final unpublished squash.

### Task 3: Browser and live evidence

**Files:** scripts/probe-supervisor.mjs; docs/implementation/G8.md; docs/implementation/evidence/G8/*.
**Interfaces:** Probe uses real live server discovery/action/operation/history, records correlated reply and served bundle; fixtures are labelled separately.

- [x] Update probe to require an available supervisor and actual correlated reply after one action send.
- [x] Run lint/typecheck and focused named/area tests; build compiled bundle.
- [x] Capture and inspect 1440 desktop dock/full, 390/320 phone, tablet and reduced viewport; compare references and record differences.
- [x] Run the owner-authorized labelled fixture probe and record endpoint, candidate, result and limits. Record actual live qualification as deferred, not passed.
- [x] Review whole diff, reconcile every acceptance item, commit evidence, squash unpublished implementation to one feature commit, merge origin/main, rerun targeted checks, guarded push and explicit truthful close.
