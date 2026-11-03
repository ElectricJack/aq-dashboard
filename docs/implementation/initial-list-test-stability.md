# Initial-list test readiness

Task `agile-harbor-34`, source base `e6a2a28`, November 2, 2026.

The retained baseline from `agile-current-11` is
`/tmp/agile-current-11/restarted-repetitions/run-05.log`: 696/698 tests passed,
with initial-list timeouts in the first tests of `CurrentCatalog.test.tsx` and
`Work.test.tsx`. Both files' remaining tests passed. This follows the earlier
[navigation readiness repair](navigation-test-stability.md).

The tests started the list's assertion deadline immediately after `renderApp`.
That helper preloads production lazy routes, but bootstrap still has to identify
the principal and capabilities, activate the session, mount the shell and page,
and then complete the first feature read. The single list wait therefore also
measured those prerequisite stages. Cold rendering and shared-host contention
could exhaust that deadline before the final list appeared.

Both direct-navigation tests now observe the Primary navigation and their page's
level-one heading before waiting for the list. These are visible readiness
conditions, with the existing assertion deadlines. The catalog test retains its
zero unrelated-read and no historical-metadata assertions. Work retains the
25-of-47 first-page assertion, explicit load-more interaction, 47-row result and
absence of a further load-more control.

Production components, shared test setup, route loading, worker limits and
timeouts are unchanged. Delivered visual subset: none. Existing desktop/phone
visual acceptance and deferred page workflows retain their prior status.

## Verification

All native checks use the existing foreground AQ test-slot bridge:

```sh
PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='pnpm test -- src/features/playbooks/CurrentCatalog.test.tsx src/features/work/Work.test.tsx' \
  DASHBOARD_CHECK_LOG=/tmp/agile-harbor-34/focused.log \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py

PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='/home/jkern/dev/agent-queue2/.venv/bin/python docs/implementation/evidence/navigation-test-stability/repeat.py' \
  DASHBOARD_REPETITION_DIR=/tmp/agile-harbor-34/repetitions \
  DASHBOARD_CHECK_LOG=/tmp/agile-harbor-34/repetitions.log \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

The [focused check](evidence/initial-list-test-stability/focused.txt) passed
28/28 tests in the two changed files. The task-required qualification completed
**20 consecutive whole-suite passes**, each with **698/698 tests in 75/75 files**,
with no skips, failures or restarted sequence. This closes the unmet repetition
qualification from `agile-current-11`.

The existing sequential driver stops on the first failure. Its
[summary](evidence/initial-list-test-stability/repetition-summary.txt),
[all 20 full logs](evidence/initial-list-test-stability/whole-suite.txt) and
[per-run report](evidence/initial-list-test-stability/repetitions.json) preserve
the results. The report includes the source base, all 283 source hashes, driver
hash, original log hashes, log line locations, exit codes and durations. All
source hashes were verified unchanged after run 20. Vitest retained
`maxWorkers: 2` and normal assertion deadlines throughout. The foreground AQ
bridge passed in 1879.47 seconds.

Before qualification, `aq git pull --branch main` and `git merge origin/main`
confirmed the assigned branch was up to date at `e6a2a28`. The exact
[qualification driver snapshot](evidence/initial-list-test-stability/qualification-driver.py)
is retained with its source commit and hash.

The final guarded main pull and `git merge origin/main` brought in `b6d9f44`.
The only difference among the 283 recorded source files is the upstream
`SessionEvents.test.tsx` readiness repair; its accompanying documentation also
updates the repetition driver. The 20 full runs above apply to the recorded
`e6a2a28` source plus this task's two test changes. The required final targeted
check on the updated branch passed **28/28 tests in both changed files**
([output](evidence/initial-list-test-stability/postmerge-focused.txt));
`git diff --check` passed. No additional full-suite qualification is claimed
after the upstream update. Publication remains integration-owned; no
default-branch merge or deployment is claimed.
