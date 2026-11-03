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
Twenty consecutive full passes have **not** been established. The supervisor
was asked to decide whether the additional test belongs in this task before
further qualification.

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
`git diff --check` passed. Qualification remains blocked as described above.
