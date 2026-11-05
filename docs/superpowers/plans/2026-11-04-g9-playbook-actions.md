# G9 Playbook start, cancel and activation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Owner can start a run, cancel a run, and activate or roll back a binding from the Playbooks page through the dashboard action union, pending-safe.

**Architecture:** A playbook-local request builder (`playbookActions.ts`) freezes `dashboard-actions-1` request bytes for four playbook kinds and reuses the existing `actionRequest`/`adaptActionOperation` transport. One playbook-local dialog component (`PlaybookAction.tsx`) owns the submit → lookup state machine (immediate first lookup, then every 2s) and renders pending / confirmed / conflict / rejected / unknown with the caller's draft preserved. Callers (run header, Runs roster, Activation detail) supply subject, typed fields and payload.

**Tech Stack:** React 19, react-router 8, TanStack Query 5, MSW 2 (Vitest + mock mode), Playwright + axe.

**Spec:** task steady-cascade-45.10 description; `docs/specs/0002-product-design.md` §8 (Playbooks); `docs/specs/0003-dashboard-api.md` §7; `docs/design/06-playbooks.png`.

## Global Constraints

- Every action goes through `POST /api/v1/actions` with `X-AQ-Request: 1`; outcome by `GET /api/v1/operations/{id}`; frozen bytes are retried unchanged.
- Gate each control on `dashboard.actions` then its per-kind capability; show the capability's reason when disabled.
- aq-server main (e43b0b3b) registers no `playbook.*` ActionKind and no playbook write capability. Kinds and capabilities below are the dashboard's proposed names (cross-repo request routed to D9); live they render disabled with "Not offered by this AQ server".
- Cancel is an intent: pending and confirmed both read "Cancellation requested"; the run badge is never relabelled by the dashboard.
- Activation affects future runs only; install, compile and activate are separate operations; no resume control (decisions are answered in Decisions, F5).
- Confirmation is required for cancel, activate and rollback. No raw JSON editor for start inputs.
- Out of scope: server API/union adapters, Create playbook/authoring, answering decisions, full visual/WCAG sign-off.
- Velocity: targeted tests only; no real sleeps or network.

Kinds → capabilities, subjects and payload fields (`operation_id`, `project_id`, and `expected_version` when the subject has a revision are always added):

| Kind | Capability | Subject | Payload |
|---|---|---|---|
| `playbook.run.start` | `playbooks.runs.start` | `playbook_binding` id=binding, revision=binding revision | `binding`, `artifact`, `entry`, `inputs` (object of typed values) |
| `playbook.run.cancel` | `playbooks.runs.cancel` | `playbook_run` id=run id (no revision) | `run_id`, top-level `reason` |
| `playbook.activation.activate` | `playbooks.activations.activate` | `playbook_binding` id, revision | `binding`, `artifact` |
| `playbook.activation.rollback` | `playbooks.activations.rollback` | `playbook_binding` id, revision | `binding`, `artifact` (the current one being replaced) |

## Review Focus

- Double submit / retry while an operation is unsettled → never a second operation id; Retry re-posts identical bytes.
- 409 on activate after another owner activated → "Conflict — your draft is preserved." and the chosen artifact stays selected after Reload.
- 401/403 mid-operation → controls lock, "Access changed" shown, no further lookups.
- Start input typed values: a number row with non-numeric text → validation error, no request.
- Capability `dashboard.actions` disabled but per-kind enabled → still disabled with the union's reason.

---

### Task 1: Request builder and transport reuse

**Files:**
- Create: `src/features/playbooks/playbookActions.ts`
- Modify: `src/features/actions/actionClient.ts` (`FrozenAction.kind` widened to `string`; type-only)
- Test: `src/features/playbooks/playbookActions.test.ts`

**Interfaces:**
- Produces: `type PlaybookKind = "playbook.run.start"|"playbook.run.cancel"|"playbook.activation.activate"|"playbook.activation.rollback"`; `playbookLabels: Record<PlaybookKind,string>`; `playbookCapability(kind): string`; `type PlaybookSubject = {type:"playbook_run"|"playbook_binding";id:string;revision?:string}`; `freezePlaybookAction(kind, project: string, subject, payload: Record<string,unknown>, reason?: string): FrozenAction`; `parseInputs(rows: InputRow[]): Record<string,string|number|boolean>` with `type InputRow={name:string;type:"text"|"number"|"boolean";value:string}`.

- [ ] Step 1: tests — frozen bytes for cancel have `kind`, `subject {type:"playbook_run",id}`, `expected_versions {}`, `reason`, `payload.run_id`, `payload.project_id`; activate has `expected_versions {playbook_binding: "7"}` and `payload.expected_version "7"`; `parseInputs` rejects empty/duplicate names and non-numeric numbers, maps `boolean` "true"/"false".
- [ ] Step 2: run `pnpm test -- src/features/playbooks/playbookActions.test.ts` → FAIL (module missing).
- [ ] Step 3: implement; 64 KiB limit as in `freezeAction`.
- [ ] Step 4: re-run → PASS.

### Task 2: PlaybookAction dialog + run cancel (named test)

**Files:**
- Create: `src/features/playbooks/PlaybookAction.tsx`, `src/features/playbooks/PlaybookActions.test.tsx`
- Modify: `src/features/playbooks/Playbooks.tsx` (RunInspector header: `<CancelRun>`), `Playbooks.module.css` (action row)

**Interfaces:**
- Produces: `PlaybookAction(props:{kind:PlaybookKind;label?:string;project:string;subject:PlaybookSubject;blocked?:string;intro?:ReactNode;confirm?:string;fields?:(locked:boolean)=>ReactNode;payload:()=>{payload:Record<string,unknown>;reason?:string};pendingText:string;confirmedText:string;onSettled?:()=>void;onReload?:()=>Promise<unknown>|void})`. Renders the trigger button (+ reason text when gated) and a modal `<dialog>` reusing `RecordActions.module.css`.
- Status copy: pending → `pendingText`; confirmed → `confirmedText`; conflict/rejected/unknown/retired copy identical to RecordActions.

- [ ] Step 1: test `playbook_cancel_shows_pending_safe_state`: with `dashboard.actions` + `playbooks.runs.cancel` enabled, open run, click "Cancel run", Submit without confirmation → alert "Confirm this action before submitting."; tick confirm, submit → POST body `kind:"playbook.run.cancel"`; server answers pending, lookups pending → status "Cancellation requested — awaiting confirmation."; run badge still "Waiting"; trigger reads "Cancel run · operation"; "Retry exact submission" re-posts identical bytes; lookup turns confirmed → "Cancellation requested".
- [ ] Step 2: test gating: without union capabilities the button is disabled with "Not offered by this AQ server"; finished run shows "This run has finished".
- [ ] Step 3: run `pnpm test -- -t "playbook_cancel_shows_pending_safe_state"` → FAIL.
- [ ] Step 4: implement dialog and CancelRun (confirm text "Confirm cancellation request. This does not prove the run stopped."); invalidate `playbook-run`/`playbook-runs` queries on confirmed.
- [ ] Step 5: re-run → PASS.

### Task 3: Start run (Runs roster, typed inputs)

**Files:** Modify `Playbooks.tsx` (Recent runs panel action), create `src/features/playbooks/StartRun.tsx`; tests in `PlaybookActions.test.tsx`.

- Binding select from activations catalog page 1 (`playbookCatalogJson("activations", …)`), entry select from the definitions catalog entry list of the bound artifact (free-text entry when the definition is not represented), input rows (name, type select, value). Subject = binding with its revision. Copy: "Starts a new run pinned to the binding's current definition."
- [ ] Test `playbook_start_posts_typed_inputs`: rows `limit` number 3 + `dry_run` boolean true → POST payload `inputs {limit:3, dry_run:true}`, `binding`, `entry`, `expected_version`; confirmed → "Run start confirmed"; a number row "abc" → alert, no POST. No `<textarea>` JSON editor present.

### Task 4: Activate and roll back (Activation detail)

**Files:** Modify `CurrentCatalog.tsx` (`ActivationDetails` gains "Activation for new runs" panel), create `src/features/playbooks/ActivationActions.tsx`; tests in `PlaybookActions.test.tsx`.

- Copy: "Definition <short digest> is active for new runs · binding revision N." and "Activation affects future runs only. Existing runs keep their pinned definition. Installing and compiling are separate operations."
- Activate: artifact select from definitions catalog page 1 (excluding the current artifact), confirm "Confirm activation for new runs." Rollback: confirm "Confirm rollback for new runs."; payload artifact = current.
- [ ] Test `playbook_activate_conflict_preserves_selection`: 409 with current_versions → "Conflict — your draft is preserved.", selection kept, "Reload current versions" refetches catalog and re-enables Submit.
- [ ] Test `playbook_rollback_requires_confirmation_and_confirms`: no confirm → alert; confirmed → "Rollback confirmed for new runs".
- [ ] Test rejected (422) for activate → rejected copy.

### Task 5: Mock mode, live spec, captures, evidence

**Files:** Modify `src/mocks/playbooks.ts` (labelled proposed capabilities + `/api/v1/actions` / `/api/v1/operations/:id` handlers for `playbook.*` kinds only: POST → pending, first lookup → confirmed); create `tests/live/playbook-actions.spec.ts` (asserts each control is either enabled by an advertised capability or disabled with its reason; skips without AQ_LIVE_URL); extend `tests/playbooks-fixture.spec.ts` to capture cancel dialog and activation detail at 1440 and 390 into `docs/evidence/playbooks-g9/`; write `docs/implementation/G9.md`.

- [ ] `pnpm typecheck`, `pnpm lint`, targeted vitest files, `pnpm exec playwright test tests/playbooks-fixture.spec.ts`; review PNGs against 06-playbooks.
