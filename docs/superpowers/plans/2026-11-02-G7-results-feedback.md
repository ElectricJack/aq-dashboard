# Results feedback Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. The held task explicitly requires completion in this session; execute inline without a separate plan approval gate.

**Goal:** Deliver the Results feed and explicit comment-to-feedback-task loop against the published G6 contract.

**Architecture:** Pin server-owned Results and action schemas/fixtures from aq-server commit `72b69f45568ac636a2c6210d4764ca5f3245a2cf`. Keep untrusted wire validation and durable operation recovery in dedicated Results modules. Compose the existing verified PNG gallery/upload with responsive cards and a selected discussion panel; retain the legacy metadata adapter for existing media tests and bindings.

**Tech Stack:** React 19, TypeScript, TanStack Query, React Router, Vitest/MSW, Playwright.

**Spec:** Held task steady-cascade-45.8; docs/specs/0002-product-design.md §7 and §9; docs/design/10-results-desktop-v2.png and 13-results-mobile-v2.png; G6 protocol/results-feedback/v1/README.md.

## Global Constraints

- Each repository builds and tests alone. No sibling path dependencies, no submodules, no floating branches in release inputs.
- A wire change publishes schemas and fixtures from the contract owner, and both endpoints consume a pinned version. Valid, invalid, replay and compatibility cases must pass.
- Never add a second writable task lifecycle. aq-graph owns task state; AQ owns grants, attempts and dispositions.
- No secrets in templates, manifests, prompts, logs, assignment JSON or task descriptions.
- Unsupported required capabilities refuse explicitly; nothing silently degrades.
- Evidence goes in docs/implementation/G7.md, recording exact commands, environment, commit and remaining limits.
- Changes are pushed through the project's integration policy. No independent merge into a shared branch.
- No edits to docs/specs. G7 is not marked review: adversarial.
- Focused and related-area tests run with aq test; lint/typecheck/build use pnpm. Named tests must exist and pass.

## Review Focus

1. Lost mutation response: freeze one operation ID and payload; lookup/recover the same operation without creating another task.
2. Scope/identity change during a request: cancel reads and unmount local mutations by principal, authorization revision and exact result identity.
3. Superseded revision: show original comment, artifact digest and exact revision; never silently retarget feedback to a new revision.
4. Small phones and keyboard entry: visible close controls, full-width discussion and readable editable draft at 390/320px.
5. Snapshot expiration/new arrivals: preserve the current card, explicit refresh and bounded keyboard-accessible paging.

## Known contract limits

G6 Detail has no current-principal direct-follow boolean. Following membership also includes opted-in threads, so membership alone cannot prove the direct-follow setting. Comments expose open/resolved state but no linked-task/follow-up projection, and native revision addressed_feedback is always empty. Do not invent Fix submitted from a successful task. Record a cross-repository follow-up; expose only confirmed operation facts and exact server state. The repository has origin/main but no origin/dev; request integration-owner direction before final publication.

### Task 1: Pinned wire contract and Results client

**Files:** Create contracts/live/results-feedback/* and contracts/live/dashboard-actions/* (schema, fixtures, source pin); src/api/adapters/resultsFeedback.ts; src/api/resultsFeedbackClient.ts; src/api/adapters/resultsFeedback.test.ts. Retain src/api/adapters/results.ts for legacy media bindings.

**Interfaces:** Consumes G6 read envelopes and dedicated write routes; produces ResultDetail, ResultComment, ResultsPage, ResultAnchor, adaptResultsFeed(raw, scope), adaptResultDetail(raw, exact), adaptResultComments(raw, project), adaptResultOperation(raw, operationId), mediaBinding(detail), and bounded client requests.

- [x] Write adapter tests using pinned valid/invalid/replay/compatibility fixtures, wrong scope/revision, normalized region bounds and operation identity assertions.
- [x] Run aq test --help, then the focused adapter test through the configured runner; observe failures before implementation.
- [x] Implement strict shape/semantic checks, exact pins and legacy PNG binding conversion. Never infer acceptance from evidence presence.
- [x] Run focused tests and commit the adapter/client increment.

### Task 2: Feed and media cards

**Files:** Modify src/features/results/Results.tsx, Results.module.css; create ResultCard.tsx and ResultsFeed.test.tsx. Reuse ResultMedia.tsx and ResultMediaUpload.tsx; add an optional selected-artifact callback for anchors.

**Interfaces:** Consumes Task 1 ResultDetail and mediaBinding(detail); produces bounded Latest/Needs review/Following queries, task/media/time filters, scope picker, selected card and review navigation.

- [x] Write tests asserting mode/filter query parameters, stable snapshot reading, exact links, duplicate rejection, explicit Load more and new-arrival prompt without replacing cards.
- [x] Run focused tests and observe the legacy page failures.
- [x] Implement max four pages of ten results; disable automatic snapshot replacement; compare fresh first pages separately; restore reading anchor by scoped URL. Keep verified PNG thumbnails and explicit expansion.
- [x] Render required evidence and acceptance separately, declared source base and exact revision. Follow writes use explicit desired booleans and version guards; present initial direct-follow state as unavailable if server does not supply it.
- [x] Run area tests and commit.

### Task 3: Comments and feedback operations

**Files:** Create src/features/results/ResultDiscussion.tsx, FeedbackDraft.tsx, useResultOperation.ts and ResultsFeedback.test.tsx. Modify Results.tsx/Results.module.css to compose discussion.

**Interfaces:** Consumes ResultDetail/ResultComment; produces whole-revision or normalized image-region comment requests, editable FeedbackDraft and existing-task link requests with exact comment/thread/artifact pins. Uses GET /api/v1/operations/{id} and explicit feedback recover under the original operation ID.

- [x] Write results_feedback_creates_linked_task: posting discussion creates no task, editing draft pins exact comment/revision, double-click creates exactly one task, confirmed link names the retained task.
- [x] Write results_mobile_review_flow_completes: open full-width comments, adjust image-region coordinates, post, create feedback task, close comments and navigate Review result to Decisions.
- [x] Add lost-response, pending/unknown/conflict, invalid title/UTF-8, revision supersession and scope-change tests.
- [x] Run named tests and observe failures.
- [x] Implement frozen requests with synchronous click guard; pending/unknown states expose lookup/recover while keeping draft frozen. Conflicts require explicit refreshed draft. Comments remain discussion; successful feedback creation never resolves a thread.
- [x] Run named and area tests; commit.

### Task 4: Visual evidence and submission

**Files:** Create scripts/visual-results-feedback.mjs and docs/implementation/G7.md; preserve existing shared shell/navigation.

- [x] Run pnpm lint, pnpm typecheck, targeted aq test Results/client/adapter area checks and the two exact named pnpm test filters; run pnpm build.
- [x] Serve the compiled bundle, intercept labelled pinned fixtures and capture 1440, 390, 320px (plus tablet discussion overlay and empty/disabled states).
- [x] Inspect actual captures for hierarchy, proportions, readable text, unclipped controls, selector strip, feedback primary action and mobile exits.
- [x] Record reference/delivered subset/deferred differences, environment, checks, served bundle and commit in G7.md. Self-review the diff and reconcile every acceptance item.
- [ ] Squash this leaf's implementation history to one preserved-tree commit before first passing close; merge the integration owner's confirmed base, rerun targeted checks, guarded aq git push, record SHA and close truthfully with evidence flags.

## Execution reconciliation

The implementation uses `contracts/pinned` to preserve the owner check.py layout; `src/api/adapters/resultsFeedback.ts` contains wire guards and `src/api/wire/resultsFeedback.ts` contains wire types. The feed/card remain in Results.tsx; named and integration cases are consolidated in Results.test.tsx. Draft, discussion and operation recovery have dedicated modules. The task requires one unpublished leaf commit, so intermediate commit steps are consolidated at submission. `aq test` cannot run JS in this installation; the required pnpm filters and bounded Vitest area check are used. Full-suite CI and G11 sign-off remain outside this task.

Integration-owner approval `msg-eaf7efcc075747819ddc99430ac0d176` selects fetched origin/main and accepts the named server read gaps as limits of this increment. Source pins, checks, review dispositions, rendered subsets and exact source snapshot are recorded in `docs/implementation/G7.md` and its evidence directory.
