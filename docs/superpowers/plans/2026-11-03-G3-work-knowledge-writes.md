# Work and Knowledge write flows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver nine typed task and knowledge actions with immutable operation identity, explicit pending/unknown/conflict handling, and the existing domain compositions.

**Architecture:** A feature-local action client freezes the exact JSON bytes once and validates union operation responses. A shared action dialog holds separate typed forms, keeps drafts during reconciliation, polls pending/unknown operations, and invalidates graph reads only after confirmation. Work and Knowledge retain their existing list/graph/document panes.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest, MSW, Playwright.

**Spec:** Task steady-cascade-45.4 (G3); docs/specs/0002-product-design.md sections 4, 8, 10; docs/specs/0003-dashboard-api.md section 7; pinned server dashboard-actions/v1.

## Global Constraints

- Builds: each repository builds and tests alone. No sibling path dependencies, no submodules, no floating branches in release inputs.
- Authority: never add a second writable task lifecycle.
- Secrets: no secrets in templates, manifests, prompts, logs, assignment JSON or task descriptions.
- Explicit refusals: unsupported required capabilities refuse explicitly; nothing silently degrades.
- Dashboard checks: pnpm lint, pnpm typecheck, pnpm test (focused/area scope per current project velocity rules).
- Evidence goes in docs/implementation/G3.md with commands, environment, commit and limits.
- Named tests must exist and pass; zero matches are not a pass.
- No architecture/spec edits. Publish via guarded task branch push; integration owns main.

## Review Focus

1. Lost POST response or missing lookup must preserve original bytes/ID and never label failure or success (all-action unknown tests).
2. Pending cancellation must never turn into a stopped lifecycle claim (confirmation and cancellation copy test).
3. A stale large decimal Graph version must survive without number conversion (knowledge_correct_conflict_offers_reload).
4. Unavailable actions, including administrator restrictions, must show the server reason (disabled descriptor test).
5. Navigation/unmount and repeated clicks must not apply a late response to a different subject (duplicate/close/reopen tests).

### Task 1: Typed union client and action forms

**Files:** Create src/features/actions/actionClient.ts, RecordActions.tsx, RecordActions.module.css, RecordActions.test.tsx. Modify HumanTaskInspector.tsx, KnowledgeDocument.tsx and HumanNodeWorkspace.tsx. Pin contracts/live/dashboard-actions and human-graph fixtures with source hashes.

**Interfaces:** Consumes G2 payloads and operation envelopes, bootstrap.capability(kind), GraphEnvelope<GraphNode>. Produces RecordActions({record, author?, pinned?}) with action-specific forms, operation identity and current version conflict handling.

- [x] Write MSW UI tests for every action and unknown effect; named work_task_edit_handles_unknown_effect and knowledge_correct_conflict_offers_reload assert frozen retry bytes, lookup, draft retention, deliberate reload/new ID. Add rejected, pending, permission, duplicate click coverage.
- [x] Run pnpm test -- src/features/actions/RecordActions.test.tsx; expect failures for absent action controls.
- [x] Implement freezeAction(kind, record, fields): immutable {id, bytes}; sendAction/lookupAction validate dashboard-actions-1. Implement forms using native modal dialog and shared buttons/tokens. Poll pending/unknown, render confirmed receipt refs, refetch graph queries. Cancel/retire require a confirmation checkbox; cancel confirmation reads Cancellation requested. Conflicts preserve fields, show current versions, reload context deliberately before new intent.
- [x] Run same focused suite; expect all actions and dispositions pass. Commit implementation.

### Task 2: Retire proposed Work path

**Files:** Modify features/work/index.tsx and mocks/handlers.ts. Remove unused Work.tsx, TaskList.tsx, TaskDetail.tsx, graph/TaskGraph.tsx and their obsolete tests. Update Work.test.tsx and impacted browser tests to actual graph fixtures/routes.

**Interfaces:** Consumes pinned human-graph-1 task fixture, produces only /api/human/projects/{project}/tasks reads from Work in all modes.

- [x] Write migration assertions for served task routes and list/graph/inspector navigation; run and observe failure against the proposed fallback.
- [x] Add pinned graph MSW handlers, enable explicit fixture capabilities in mock bootstrap, remove proposed fallback and unused source/tests.
- [x] Run Work, graph and knowledge area tests; expect passing navigation/read/error behavior without /api/v1/tasks.
- [x] Commit migration.

### Task 3: Live and visual evidence

**Files:** Create scripts/probe-G3.mjs, docs/implementation/G3.md; update this plan's checkboxes as steps finish.

**Interfaces:** Consumes explicit local E0 origin and disposable project; produces JSON evidence and desktop/390/320 captures of production bundle and real action receipts.

- [x] Add probe that authors disposable knowledge and edits disposable task, performs lookup/replay, correction/verify/retire and dependency actions; cancel/retry must report actual daemon dispositions. Verify no horizontal overflow and close controls at 1440/390/320.
- [x] Run named test commands, focused area tests, pnpm lint, pnpm typecheck, pnpm build and local probe. Inspect actual screenshots against approved references; document subset and deferred differences separately from API evidence.
- [x] Reconcile acceptance in G3.md. G3 has no adversarial marker; perform a separate final review, fix correctness issues with regression tests.
- [x] Consolidate leaf implementation commits onto recorded base preserving main ancestry, merge origin/main, run any necessary focused checks, guarded push, settle subtasks and close with evidence.
