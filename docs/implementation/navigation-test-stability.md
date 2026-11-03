# Navigation test readiness

Task `agile-current-11`, November 2, 2026. The reported baseline is PR #7's
fourth full run: the initial Overview heading timed out and returning from a
graph task failed to restore node focus.

`Shell.test.tsx` now observes the primary navigation after bootstrap, then the
index redirect's `/overview` location, before checking the page heading. The
scoped root redirect uses the same stages. `Work.test.tsx` waits for the opened
detail heading to receive focus before starting Back, and wraps the imperative
router navigation in React's `act`. The original final node-focus assertion
remains intact, and the forward-focus assertion adds coverage.

No assertion deadlines, test worker limits, production components, route
definitions or page styles change. Delivered visual subset: none; existing
desktop/phone acceptance and deferred workflows retain their status.

The initial focused check passed 44/44 tests in the two changed suites
([output](evidence/navigation-test-stability/focused.txt)). The explicitly
requested full-suite repetition stopped on run 2: run 1 passed 698/698, run 2
passed 697/698 with an unrelated initial list timeout in
`LoadedDefinitions.test.tsx:22`. Both changed suites passed in both full runs.
See the [source hashes and results](evidence/navigation-test-stability/initial-repetitions.json)
and [failure log](evidence/navigation-test-stability/loaded-definitions-failure.txt).
The supervisor authorized a narrow fix in the failing direct-navigation test
(message `msg-ec5796dfd3f34533a6154bac23ce7c8b`). It now observes the primary
navigation and Playbooks heading before awaiting the loaded definitions list;
the existing metadata/engine read-count assertions are unchanged. All three
affected suites passed 50/50 tests before the fresh qualification attempt
([output](evidence/navigation-test-stability/expanded-focused.txt)).

The restarted attempt passed **four consecutive full runs**, each 698/698
tests in 75 files, then stopped on run 5 with 696 passes and two initial-list
timeouts: `CurrentCatalog.test.tsx:18` (direct current Definitions) and
`Work.test.tsx:19` (bounded first task page). The repaired root redirects,
graph Back focus check and loaded Definitions direct read passed all five runs.
See the [source hashes and run summaries](evidence/navigation-test-stability/restarted-repetitions.json),
[first](evidence/navigation-test-stability/restarted-run-01.txt),
[second](evidence/navigation-test-stability/restarted-run-02.txt),
[third](evidence/navigation-test-stability/restarted-run-03.txt),
[fourth](evidence/navigation-test-stability/restarted-run-04.txt) and
[fifth](evidence/navigation-test-stability/restarted-run-05.txt) full logs.

**Twenty consecutive full-suite passes were not achieved.** Per the supervisor's
bounded authorization, those two remaining failures were left for the supervisor,
with no full-suite restarts or worker-filed follow-ups. These results qualify the
scoped repair; they do not establish whole-suite stability or a green main.

Checks run through the existing foreground AQ bridge:

```sh
PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='pnpm test -- src/app/Shell.test.tsx src/features/work/Work.test.tsx' \
  DASHBOARD_CHECK_LOG=/tmp/agile-current-11/focused.log \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py

PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='/home/jkern/dev/agent-queue2/.venv/bin/python docs/implementation/evidence/navigation-test-stability/repeat.py' \
  DASHBOARD_REPETITION_DIR=/tmp/agile-current-11/repetitions \
  DASHBOARD_CHECK_LOG=/tmp/agile-current-11/repetitions.log \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

The repetition driver runs `pnpm test` sequentially, stops at the first failure,
records hashes and logs, and leaves the configured `maxWorkers=2` cap intact.
The first two full runs used the initial `058e623` source plus this task's test
changes. After supervisor coordination, guarded pull incorporated PR #7's
`ad7c7fa` without editing its files, then `git merge origin/main` fast-forwarded
to `079b9ee`, which includes the merged PR. This also includes the existing
`grand-lantern-86` (`058e623`) and `wise-journey-87` (`c332f4e`) fixes.
No default-branch publication is performed by this worker.

After merging, the same focused command passed 44/44 tests again
([output](evidence/navigation-test-stability/postmerge-focused.txt)).
`git diff --check` passed. The restarted qualification uses main `079b9ee` plus
the Shell, Work and LoadedDefinitions readiness changes, with logs in
`/tmp/agile-current-11/restarted-repetitions/`.

For the three-file focused check, append
`src/features/playbooks/LoadedDefinitions.test.tsx` to the first command above.
For the bounded full attempt, use `/tmp/agile-current-11/restarted-repetitions`
and `/tmp/agile-current-11/restarted-repetitions.log` as the output paths in the
second command. Full runs used the native `pnpm test` command without any
filters or deadline/worker overrides.

The operator merged PR [#8](https://github.com/ElectricJack/aq-dashboard/pull/8)
externally as `e6a2a28`, including the Shell, Work and LoadedDefinitions fixes.
The worker performed no merge into main. A connector attempt to update the PR
description returned 403 `Resource not accessible by integration`; it was not
retried or bypassed.

Before the operator follow-up, `git merge origin/main` was already up to date. The
three-file focused command then passed 50/50 again
([output](evidence/navigation-test-stability/final-focused.txt)), and
`git diff --check` passed. No full-suite rerun followed the bounded stop.

At close, pending operator feedback (`msg-808e568e42a5477a9d4527ec8deb1b9e`)
requested a narrow repair to `SessionEvents.test.tsx`'s late different-session
report test. That explicit request extends the earlier supervisor bound only
for this named test. Guarded pull merged main `e6a2a28` into the task branch.

The test prepares fixture body digests before response/render assertions,
observes an actual in-flight old-session read before navigating, then awaits the
new-session region and new source request in separate stages. The gate still
holds the old response until the new session's gap is visible. The original
old-report absence assertion remains, and request-start assertions strengthen
the scenario. No deadlines, assertions or concurrency caps are weakened.

The four-file focused command (the three original files plus
`src/features/agents/SessionEvents.test.tsx`) passed **61/61** tests
([output](evidence/navigation-test-stability/operator-focused.txt)). The earlier
full-run evidence predates this final SessionEvents edit; no full-suite green
claim is made for the final tree. The remaining work is submitted in a new PR
against main, left unmerged; its URL and final SHA are in the task close evidence.

The named late-different-session test then passed **20/20 consecutive focused
runs**, each in a fresh native Vitest process at the configured two-worker cap
([hashes and per-run summaries](evidence/navigation-test-stability/operator-named/report.json)).
These runs select one test, with the file's other ten cases excluded by `-t`;
they are not full-suite runs. Repeat them with the AQ repetition command above,
setting these additional/replacement environment variables:

```sh
DASHBOARD_REPETITION_COMMAND='pnpm test -- src/features/agents/SessionEvents.test.tsx -t "late reports from a different session never appear after navigation"'
DASHBOARD_REPETITION_DIR=/tmp/agile-current-11/operator-named-repetitions
DASHBOARD_CHECK_LOG=/tmp/agile-current-11/operator-named-repetitions.log
```

Final follow-up submission: `git merge origin/main` was already up to date,
then the full `SessionEvents.test.tsx` file passed **11/11**
([output](evidence/navigation-test-stability/operator-final.txt)).
`git diff --check` also passed.
