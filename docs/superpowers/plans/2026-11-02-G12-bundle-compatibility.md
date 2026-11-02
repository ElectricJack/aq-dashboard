# Bundle compatibility and draft recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Detect bundle/API incompatibility without automatic reload or loss of unsent task and supervisor drafts.

**Architecture:** Capture the first successful bootstrap digest for this page load; compare subsequent non-null values on the existing 30-second refresh. Share E3's requirement data between the manifest generator and app, gate dependent capabilities, and preserve validated draft values in tab-scoped sessionStorage under principal/revision/key identities. A small shell notice offers explicit reload and compatibility guidance.

**Tech Stack:** React, TypeScript, TanStack Query, Vitest/MSW, Vite, Playwright.

**Spec:** Task steady-cascade-45.13 (G12); docs/specs/0001-dashboard.md §6/U8; docs/specs/0003-dashboard-api.md §8.4; docs/specs/0002-product-design.md §§3–5,10. Program constraints: aq-server/docs/superpowers/plans/2026-11-02-v2-full-application-plan.md §Global Constraints.

## Global Constraints

- Builds: each repository builds and tests alone. No sibling path dependencies, no submodules, no floating branches in release inputs.
- Explicit refusals: unsupported required capabilities refuse explicitly; nothing silently degrades.
- For aq-dashboard: `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- Evidence goes in `docs/implementation/G12.md`, recording exact commands, environment, commit and remaining limits.
- Changes are pushed through the project's integration policy; never publish the default branch.
- No secrets in manifests, logs or task descriptions; no drafts in URLs/localStorage; no service worker.
- Only A-series and docs tasks edit `docs/specs/*`; E3 owns manifest/archive formats.
- Preserve approved Work/supervisor composition. Visual sign-off remains G11's responsibility.

## Review Focus

- A null initial digest must not acquire a misleading baseline later; null means no comparison for this page load.
- Logout, another principal, or authorization revision change must erase drafts, including drafts from an earlier page load.
- Blocked/quota-exhausted sessionStorage must not crash a composer or falsely claim reload preservation.
- A feature request returning 426 must lose its stale cached read and remain disabled without hiding other destinations or discarding drafts.
- Reloading an uncertain mutation must restore text but never reconstruct or automatically replay its POST.

---

### Task 1: Digest prompt, draft store, and composer adoption

**Files:** Create `src/app/drafts.ts`, `src/app/useDraft.ts`, `src/app/BundleNotice.tsx`, `src/app/BundleNotice.module.css`, `src/app/bundleCompatibility.test.tsx`, `src/app/drafts.test.tsx`. Modify `src/app/session.tsx`, `src/app/Shell.tsx`, `src/api/adapters/bootstrap.ts`, `src/features/work/CreateTask.tsx`, `src/features/supervisor/SupervisorConversation.tsx`, and their tests.

**Interfaces:** Consume `Bootstrap.product.dashboard_digest` and `QueryContext`. Produce `useDraft<T>(draftKey: string, initial: T, validate: (value: unknown) => value is T)` returning a value and React-compatible setter; a draft identity lifecycle/clear API; Session update/compatibility state used by `BundleNotice`.

- [x] Write `digest_change_prompts_reload_preserving_draft`: enter supervisor text, refresh a changed bootstrap digest, observe a non-blocking Reload prompt, invoke explicit reload, remount, and verify restored text with no mutation/no body in URL. Test Work's title/body/acceptance/state across remount.
- [x] Add null/unchanged digest cases, draft isolation and logout/revision-change cases, invalid stored values, storage denial/quota cases, successful-send clearing and uncertain-operation reload cases.
- [x] Run focused tests, expect failures for absent prompt/persistence.
- [x] Implement the first-bootstrap baseline (including null), reusable validated sessionStorage hook with synchronous saves, identity cleanup, explicit reload with storage failure disclosure, and adopt only the two existing composers.
- [x] Run focused suites; expect all tests to pass. Commit.

### Task 2: Shared requirements and feature-local compatibility

**Files:** Create `src/app/bundle-requirements.json`, `src/app/compatibility.ts`; modify `scripts/bundle-manifest.mjs`, bootstrap adapter/session, both composers, `src/api/taskCreateClient.ts`, and affected tests including `src/app/liveConnection.test.tsx` and `src/test/bundleManifest.test.ts`.

**Interfaces:** Share `{required_api_versions: string[], required_capabilities: string[]}` unchanged from E3. Bootstrap adaptation consumes the version list explicitly for live bootstrap (proposed fixture mode remains labelled). Session reports 426 for a dependent capability; query failures map existing resource keys to capabilities and remove that resource's cached data.

- [x] Write tests proving missing required contracts/capabilities and unsupported capability versions refuse dependent requests with upgrade guidance; disabled grants retain their server reason. Assert an unrelated view remains usable after 426 and drafts survive.
- [x] Verify requirements used by a generated manifest equal the compiled app requirements. Update live-bootstrap test fixtures to publish the real dashboard-read contract; update the previous global-426 expectation to the new feature-local requirement.
- [x] Run the focused tests; expect failures for missing enforcement/local handling.
- [x] Share E3's exact lists, enforce contracts/capabilities without coercion, latch 426 per resource/capability, preserve drafts and remove stale success. Ensure task 426 is typed before body parsing and composer mutation paths report it.
- [x] Run focused suites; expect all tests to pass. Commit.

### Task 3: Verification and delivery

**Files:** `docs/implementation/G12.md`, screenshot evidence under `docs/implementation/evidence/G12/`.

- [x] Run `pnpm test -- -t "digest_change_prompts_reload_preserving_draft"`; expect a real matching pass.
- [x] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; expect success, record any unrelated failures by name.
- [x] Capture and inspect served-bundle desktop/phone notices and composers against the named references; record delivered subset and deferred differences without claiming full visual sign-off.
- [x] Reconcile scope/deliverables, self-review the whole branch (G12 has no adversarial marker), write evidence, squash this task's unpublished implementation history to one feature commit preserving the tree.
- [x] Attempt the required `origin/dev` merge and record its unavailable ref; prepare the assigned branch with targeted checks and the evidence needed for guarded publication and AQ close. Publication result is recorded in AQ.

## Execution decisions and ledger

- The task explicitly authorizes completion in this session; proceed inline after committing the plan without another approval round.
- AQ provides this isolated worktree and branch. Native `aq test` selects pytest, not this JS runner; retain Vite's four-worker cap and use the repository's explicit pnpm checks. Coordination report sent to the integration owner.
- Shared interfaces reviewed: draft identity is exactly QueryContext principal/revision; contract version does not key drafts (upgrades must retain them); compatibility uses E3's unchanged manifest fields.

- Task 1 complete: initial RED 5 failures; draft/composer focused GREEN 41/41. Later stale-writer and confirmed-clear regressions both observed RED, fixed and included in 70/70 focused GREEN.
- Task 2 complete: compatibility RED 5 failures; requirements/local 426/manifest suites included in 70/70 GREEN; task POST 426 test GREEN 18/18 Work suite. TypeScript passes.
- Ruling: retain the native 30-second bootstrap timer and use Playwright clock advancement only in deterministic browser qualification — this exercises the deployed polling path without a test-only production API; cost if wrong is missed real-time/background-tab timing differences.

- Final review: fresh gpt-6-astra reviewer found three Important issues, no Critical/Minor. All fixed: erase every composer draft on direct task 401/403 even if bootstrap fails; gate task verification and decision resolution on 426; expose retained text on uncertain task reload without replay. Five regressions failed before fixes, then 64/64 related tests passed.
- Final checks: named acceptance 1/1; lint/typecheck/build pass; production browser proof passes at 1440/390/320px. Full suite final 663 pass, eight pre-existing TerminalTail failures from unavailable jsdom matchMedia. Follow-up sound-stone-19 tracks suite stability.
- Ruling: full visual acceptance remains with G11; this delivery reviews notice/composer/recovered-text and Decisions refusal subsets only — page-wide work is outside G12 — cost if wrong: broader workflows may still differ.
- Ruling: report existing test failures separately — baseline d862145 reproduces terminal/catalog failures and varying media timeout, while final catalog/media pass — cost if wrong: a timing regression could be missed; final suite rerun narrows the remaining failures to unchanged terminal code.
- Ruling: do not invent or substitute an integration branch when origin/dev is absent — both git merge origin/dev and guarded aq git pull --branch dev refuse; report to supervisor and publish only the assigned branch for integration-owner delivery — cost if wrong: branch may need an additional integration merge.
