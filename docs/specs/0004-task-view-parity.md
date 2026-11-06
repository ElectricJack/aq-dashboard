# Task view parity with v1

Status: approved by the owner on 2026-11-06 ("Lets move forward with task parity now"), with the defaults in §7. Phase 1 is in progress. Date: 2026-11-05.

This is the first section of the v1 → v2 dashboard parity program. Sections are delivered one at a time. The owner verifies each finished section on a running stack before work on the next one starts.

The field-by-field inventory this spec is built from is [aq-server `docs/research/2026-11-05-task-view-parity-inventory.md`](../../../aq-server/docs/research/2026-11-05-task-view-parity-inventory.md). It compares v1's task drawer, task page and `aq task show` with v2's Work view and human API.

## 1. Intent

The owner runs AQ through the task view. In v1, one task view answers several questions:

- what the task is;
- whether it is running and, if not, why;
- who is working on it and how to reach that agent;
- what agents and people have said about it;
- which attempts ran, how they ended, and what code came out.

The v2 Work inspector answers only the first question. In the owner's words (2026-11-05): "The new dashboard is nice looking but the v2 system is missing a lot that felt very critical in v1… I don't see comments, or task ids, or ways to copy task ids."

**Goal.** An operator can run day-to-day work from the v2 task view without falling back to the v1 dashboard or the CLI. That means seeing the task's state and its reason, reading and writing the discussion, following the attempts and the agent, and taking the common corrective actions.

**Non-goals for this section:**

- other dashboard sections (Overview, Agents, Results and so on), which are later parity sections;
- bulk task administration;
- editing playbooks or routing policy from the task view;
- the items deferred in §6.

**Anti-goals.** Any of these makes the section a failure even if every item ships:

- the view becomes a cluttered dump of raw fields;
- an action quietly bypasses an AQ policy, such as D3 completion, replacement budgets or recovery holds, that the server would enforce for the CLI;
- a section shows data the server didn't supply, so the view is wrong while looking right;
- the view is unusable on a phone.

## 2. Scope

The scope is items 1–15 of the inventory, plus item 16 (compact list rows, an owner request), delivered in three phases. Each phase is owner-verifiable on its own. Item numbers match the inventory's tiers: A (data already on the server), B (small server additions) and C (new server models).

### Phase 1: identity, live state, agent, history and comments

1. **Task ID and copy.** The header shows the full task ID next to the title in a monospace chip, with a copy button. The same copy control is used for every ID in the view: attempt, session, decision, result and commit. A copied ID can be pasted straight into `aq` commands or chat.
2. **Readiness.** A status badge from `GET /api/human/projects/{p}/tasks/{t}/work` → `readiness.state`, using the labels in `features/work/labels.ts`. When the state isn't `ready`, `running` or `completed`, the badge shows the most specific reason the server gave. Phase 1 uses the unsatisfied blockers from `/work`; phase 2 adds the full reason (item 10).
3. **Agent and session.** From `/work` → `execution{attempt_id, session_id, status}`: the holding attempt and its status, with a link to `/agents/{session_id}` that opens the agent's terminal. If no attempt holds the task, the view says so.
4. **Attempts.** From `/history` → `attempts[]` (up to 16), newest first. Each attempt shows:
   - its ID (copyable) and status;
   - whether it holds the task;
   - provider, model and harness, and its start and stop times, from `/api/v1/sessions/{session_id}`;
   - a link to the session.
5. **Change history.** From `/history`: who changed what and why (operation, actor, reason, time), newest first. The list is collapsed by default to the last 5, with "Show all".
6. **Hierarchy.**
   - The parent appears as a link above the title.
   - Epics show child counts by state from `/summary`.
   - Dependency rows show the dependency's reason (`edge.description`) and whether it is satisfied (from `/work`).
   - The neighborhood adapter must stop dropping `parent`, `omitted` and `expansion`. When the neighborhood is truncated, the view says so.
7. **Results.** `GET /api/v1/results?task_id=` lists the task's results: summary, submitted time, conclusion and process outcome, check and evidence references. Each links to the Results page.
8. **Labels and reprioritize.** Labels appear as chips. `task.reprioritize` is exposed in the action menu; the capability is already published. The current priority is shown once item 9 makes it readable. Until then the action takes a value and shows the confirmed result.
16. **Compact task list rows (owner request, 2026-11-05).** Today each Work list row shows a neutral `ListChecks` icon and two lines: the title (which wraps) and a meta line such as "Active · r3". Change rows to:
    - **One line.** The title is truncated with an ellipsis, and the full title shows on hover and to assistive technology. The visible status label and the `r<revision>` meta are removed. Retired and deleted records keep a short inline marker, because they are rare and need to stand out.
    - **The icon carries the status.** The bullet icon takes the status colour from the design tokens: ready, running, waiting/blocked, draft, completed and canceled. Each status also gets a distinct icon shape, so the list doesn't rely on colour alone (WCAG 1.4.1). The status is the icon's accessible name, and also shows in its tooltip.
    - **Status source.** Until per-task readiness is available in the list read, the list uses the Graph lifecycle state plus "running" when the list response's `executions` field shows an attempt holding the task. The current adapter ignores that field. Once the list read carries readiness, the icon uses it.
    - **Density.** The row height drops so that roughly twice as many tasks fit on a 1440×900 screen. On a phone (390 px) a row is still at least 44 px tall to tap.

13. **Comments.** These are a new server model, specified in §4.1.
    - The thread shows newest first, 50 per page, with "Load older".
    - Each comment shows the author (owner, agent session, supervisor or system), with a link for agent authors, and its time. Bodies are rendered as Markdown.
    - A composer posts as the owner.
    - The author can edit or delete their own comment. A deleted comment leaves a "comment deleted" placeholder.
    - Agents can add comments to their own task through the agent API. That is how they leave findings, the way v1's `aq task comment` works.

### Phase 2: priority, type, why not running, attempt outcomes, route

9. **Priority and type.** The node read exposes `priority` (from `aq:priority`) and `task_type` (from `aq:task_type`). Both are shown in the header. `task.edit` accepts `task_type`, and priority changes through `task.reprioritize`.
10. **Why it isn't running.** A new read, `GET …/tasks/{t}/explain`, returns an ordered list of `{code, summary, detail, refs[]}`.
    - It covers:
      - unsatisfied blockers;
      - a draft task;
      - an ingest or playbook hold (`aq:hold`);
      - a recovery hold;
      - replacement refusals (budget exhausted, or source not retained or settled; the `replacement_*` reasons in `profiled_execution/replacement.rs`);
      - provider or capacity unavailability for the task's route;
      - "waiting on {wait}", with a link.
    - A refused `task.retry` or `task.cancel` returns the same codes in its rejection, instead of a bare `Rejected`.
    - The view shows the list under the status badge, next to the badge's reason from item 2.
11. **Attempt outcomes.** `/history` attempts gain:
    - `outcome`: succeeded, failed, cancelled, expired, rework or unknown;
    - `exit_reason`, as short text;
    - `started_at` and `ended_at`;
    - `result_id`, when the attempt has one.

    The attempts list shows them, and failed attempts can be expanded to show their reason.
12. **Route.** A new read, `GET …/tasks/{t}/route`, returns:
    - the create-time hints (`profile_hint`, `intelligence_hint`, `task_type`);
    - for the latest attempt, the sealed selection: profile, intelligence class, provider, model, harness, the selection rule or reason, and any override.

    The view shows a compact line, for example "standard-high · claude · claude-opus · Claude Code 2.1.318 · rule: default". Details are in a disclosure.

### Phase 3: code delivery and task-state actions

14. **Branch, PR and commits.** A new read, `GET …/tasks/{t}/delivery`, returns:
    - the task's source branch or ref;
    - the publication receipts: commit SHAs (copyable), the aq-git repository, PR URL or fast-forward, and when each was published;
    - the integration state when delivery is required.

    The data comes from D1 publication receipts and aq-git. Until D1 is live for a project, the read returns `{state: "not_published", source_revision}` from the result's retained source. The view must not show an empty "Commits" list as though nothing happened.
15. **Pause, resume, reopen and activate.** These are new dashboard actions, each enforced by the server.
    - `task.pause` puts a task hold on the task that blocks new attempts. A running attempt continues unless the action's `stop_running` flag is set. The hold appears in `/explain`.
    - `task.resume` removes that hold.
    - `task.reopen` moves a completed or canceled task back to active, and requires `feedback`. The feedback is posted as an owner comment that the reopen links to. The next attempt sees it, because comments are agent-readable (§4.1).
    - `task.activate` moves a draft to active.
    - Each action uses `expected_versions`, returns a structured rejection (item 10's codes), and appears in change history.

## 3. Layout

**One task view: the inspector on the right.** There is no separate "full task" page.
- The "Open full task" link in `HumanTaskInspector.tsx` points at the same `/work/{id}` route the list rows already open, so it does nothing visible (owner report, 2026-11-05). It is removed.
- Everything in this spec lives in the right-hand inspector.
- `/work/{id}` stays the deep link. It opens the list with that task selected and the inspector showing it.
- To fit everything without a second page:
  - **Width.** In list view the inspector keeps its ~60% share (`.panes` is `0.8fr / 1.2fr` today). In graph view the graph currently takes 62% and the inspector 38%. When a task is selected, the split flips to 40% graph / 60% inspector.
  - **Expand.** An "Expand" toggle in the inspector header collapses the list or graph so the inspector takes the full width. It is reflected in the URL (`?focus=1`), so the expanded view can be linked and survives a reload. Esc or the toggle restores the split. This replaces the full-page link's purpose.
  - **Sections fold.** Each section below is collapsible. Its open or closed state is remembered per browser, using local storage guarded by try/catch. Sections that can grow long (Comments, Attempts, History) show a bounded preview and a "Show all" link, so the most-used parts (header, status, comments) are visible without scrolling at 1440×900.
  - **Sticky header.** The inspector header, with title, ID, status chips and the action menu, stays pinned while the sections scroll. Focused controls scroll clear of it.
  - **Phone.** The inspector is a full-screen page with Back, as it is today. Expand doesn't apply there. Only a compact bar is pinned: the title on at most two lines, the status on one line, and one "Task actions" menu that holds every action. Location, ID and labels scroll away with the content (QA P1-02).

Inspector sections, top to bottom:

1. **Header:**
   - a breadcrumb with project › parent;
   - the title;
   - the ID chip with copy;
   - chips for status, priority and type;
   - the action menu: edit, reprioritize, pause/resume, retry, cancel, reopen/activate, copy link.
2. **Status:**
   - the reason list (items 2 and 10);
   - the holding agent with an "Open terminal" link (item 3). When the holding attempt has ended but the server still reports the task as running, the badge says "Held by a finished attempt" (or the attempt's ended status), and the link opens the session instead of a terminal;
   - the route line (item 12).
3. **Comments** (item 13): open by default, because this is the section the owner reads most. It sits directly under Status, so at 1440×900 the composer and the newest comment are on the first screen (QA P1-03, 2026-11-06).
4. **Description and acceptance criteria:** these exist today. Both fold, and a long description shows a bounded preview.
5. **Attempts** (items 4 and 11).
6. **Results** (item 7) and **Delivery** (item 14).
7. **Dependencies and hierarchy** (item 6).
8. **History** (item 5): collapsed.
9. **Record details:** the existing disclosure, with created and updated times and revisions.

Every section that depends on a capability the server doesn't advertise shows a one-line "not available on this server" note. It never blocks the whole view (retrospective W69).

## 4. Server work

All new routes are owner-authenticated human routes under `/api/human/projects/{p}/tasks/{t}`, unless stated otherwise. They follow the existing human-graph conventions: an envelope with `api_version`, `server_time`, opaque cursors and observation metadata. They are added to `protocol/human-graph/v1` (or `protocol/dashboard-read/v1`, wherever the task reads live today), with schema, fixtures and digests regenerated, and `check.py` must pass. New capabilities are advertised in bootstrap, so the dashboard can gate each section separately.

### 4.1 Task comments (new model)

- **Owner:** aq-server. It holds authentication, agent access and the existing `result_comments` precedent. Comments are keyed by `(project_id, task_id)`, not stored in aq-graph. This is my call, not an owner decision. The graph stays the record of task structure and content, and the discussion is operational. The owner can overrule this in review.
- **Table `task_comments`:**
  - `comment_id`, `project_id`, `task_id`;
  - `author_kind` (`owner|agent|supervisor|system`) and `author_ref` (the user ID, or the session and attempt IDs);
  - `body`: Markdown, 16 KiB maximum;
  - `created_at`, `edited_at`, `deleted_at`;
  - `revision`.

  A delete is a tombstone: the body is cleared and the row is kept. One migration, numbered with the next free number when it merges.
- **Human routes:**
  - `GET …/comments?cursor&limit` lists newest first; `limit` defaults to 50 and is capped at 100.
  - Dashboard actions `task.comment.add`, `task.comment.edit` and `task.comment.delete` go through `/api/v1/actions`, with idempotent operation IDs and `expected_revision` on edit and delete. The owner can edit or delete only owner comments.
- **Agent routes:** `POST /v1/agent/comments` (add) and `POST /v1/agent/comments/list`, under the attempt's credential. An agent can comment only on its own task and can read the task's thread. aq-worker's `aq-agent comment add|list` client follows; that is cross-repo work in aq-worker.
- **Capabilities:** `tasks.comments.read` and `tasks.comments.write`.
- **Prime/context:** a later attempt on the same task gets the thread in its context, as v1 prime does. This is how reopen feedback (item 15) reaches the agent.

### 4.2 Read additions

- **Node read:** add `priority`, `task_type` and a `hold` summary (item 9).
- **`/history` attempts:** add outcome, exit reason, times and `result_id` (item 11).
- **`/explain`:** new (item 10). The reason codes are shared with action rejections.
- **`/route`:** new (item 12). It reads `intelligence_attempt_selections` and the execution profile.
- **`/delivery`:** new (item 14). It reads D1 receipts and aq-git, with the `not_published` fallback.

### 4.3 Actions

- `task.edit` gains `task_type`.
- New actions: `task.pause`, `task.resume`, `task.reopen` and `task.activate` (item 15).
- Rejections of `task.retry` and `task.cancel` carry the `/explain` codes.
- `protocol/dashboard-actions/v1` is regenerated.
- Policy checks stay server-side. In particular, `task.reopen` must not bypass D3 or replacement budgets: reopening creates eligibility for a new attempt, and the attempt is still admitted by the normal path. Any change to completion or replacement policy gets an independent review before merge.

## 5. Acceptance and owner verification

Each phase is done when all of the following hold:

- its items work against a **running local stack**, http://127.0.0.1:18080 or the MS1 stack, on a task with real history from an MS1 Claude run: attempts, a result, comments from an agent and from the owner, a failed attempt;
- unit and contract tests cover every new read and action, including the refusal paths;
- Playwright specs cover desktop 1440 and phone 390;
- dashboard and aq-server CI are green, and the change is merged to main;
- a verification checklist for the phase is handed to the owner: each item, where to click, and what they should see;
- the owner signs off.

The next phase starts only after sign-off.

**Phase 1 checklist:**

- [ ] The task ID is visible and copies with one click. Pasting it into `aq` or chat gives the full ID.
- [ ] The status shows the real readiness and, when blocked, which blocker.
- [ ] "Open terminal" opens the holding agent's session.
- [ ] Attempts list: provider, model, harness and times, plus copyable attempt and session IDs.
- [ ] History shows who changed what.
- [ ] The parent link, child counts and dependency reasons are shown.
- [ ] The task's results are listed and link to Results.
- [ ] Labels are shown, and Reprioritize works.
- [ ] There is no "Open full task" button. Everything fits in the right-hand inspector:
  - "Expand" gives it the full width, and survives a reload;
  - sections fold;
  - the header stays visible while scrolling.
- [ ] Task list:
  - each row is a single line;
  - the bullet icon is coloured, and shaped, by status;
  - there's no status label or revision;
  - noticeably more tasks fit on screen;
  - the status is still announced to a screen reader.
- [ ] Comments:
  - an agent's comment from a real run appears;
  - the owner can add, edit and delete a comment;
  - the thread pages back past 50 comments.

**Phase 2 checklist:**

- [ ] Priority and type are shown.
- [ ] A blocked, held or out-of-budget task explains itself in plain words.
- [ ] A refused retry says why.
- [ ] Attempts show how they ended and why.
- [ ] The route line matches what actually ran.

**Phase 3 checklist:**

- [ ] A published task shows its commits and PR or fast-forward, with copyable SHAs. An unpublished task says "not published" and shows its source revision.
- [ ] Pause blocks new attempts and shows in the explanation, and Resume clears it.
- [ ] Reopen with feedback puts the feedback in the thread, and the next attempt sees it.
- [ ] Activate starts a draft.

## 6. Deferred (inventory tier D)

These wait until the owner has used the new view and asks for them:

- attachments and screenshots on tasks;
- the subtask checklist;
- collaboration threads;
- delete and skip;
- provider reroute and undo per task;
- a related-knowledge section;
- keyboard shortcuts.

Comments (item 13) can carry pasted image links in the meantime.

## 7. Decisions (2026-11-06)

The owner approved going ahead without changing the proposed defaults:

1. **Scope:** items 1–16 in three phases; tier D is deferred.
2. **Where comments live:** aq-server (§4.1). New server code for comments goes in a new workspace crate, not the aq-server lib, so it stays within the lib-size ratchet and fits the planned crate split.
3. **Pause:** blocks new attempts by default. Stopping the running attempt is an explicit option.

Some items already landed in the QA fix PRs (aq-dashboard #74–#80):
- item 1 in part: the task ID is shown with a copy button;
- labels are displayed;
- "Open full task" is removed;
- the inspector names the attempt holding the task.

Phase 1 completes them to this spec.
