# Shared async assertion timeout

Task `azure-harbor-91`, source base `0634356`, November 3, 2026.

Dashboard CI has timed out on different async UI assertions near Testing
Library's default 1000 ms deadline. Prior individual readiness repairs retained
that deadline and did not eliminate the failure class under CPU contention.

`src/test/setup.ts` now configures Testing Library's `asyncUtilTimeout` to
5000 ms for all `findBy` and `waitFor` assertions. `vite.config.ts` sets
`testTimeout` to 15000 ms so multiple async assertions can finish within one
test. The two-worker cap, assertions and individual tests remain unchanged.
These are failure deadlines; successful assertions still resolve immediately.

The installed MSW 3.0.3 uses `onUnhandledFrame: "error"` rather than the former
`onUnhandledRequest` spelling. Every existing `setupServer` suite already
uses that strict option. The qualification driver additionally fails if any
run logs `[MSW] Error:`, even if the application catches the rejected request.
No bypass policy or fabricated fixture handler was added.

## Verification

The exact [qualification driver](evidence/async-timeout-stability/qualification-driver.py)
runs five complete suites sequentially. It pins itself and its descendants to
two CPUs and runs one continuous CPU-bound process on the same CPUs while
Vitest retains `maxWorkers: 2`. It stops on the first failing test or MSW error,
records per-run exit codes and log hashes, verifies source hashes after the
last run, and terminates the load process in `finally`.

```sh
PYTHONDONTWRITEBYTECODE=1 AQ_WORK_DIR="$PWD" \
  DASHBOARD_CHECK_COMMAND='/home/jkern/dev/agent-queue2/.venv/bin/python /tmp/azure-harbor-91/qualify.py' \
  DASHBOARD_CHECK_LOG=/tmp/azure-harbor-91/qualification.log \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

The retained driver is the exact `/tmp/azure-harbor-91/qualify.py` snapshot.
To reproduce, create that temporary directory and copy the driver there.

All **five consecutive loaded full-suite runs passed 698/698 tests in 75/75
files**, with no skipped tests, failures, restarted sequence or MSW errors.
Runner durations were 188.87, 219.45, 201.03, 215.39 and 178.17 seconds.
The foreground [AQ bridge](evidence/async-timeout-stability/aq-qualification.log)
passed; the [summary](evidence/async-timeout-stability/qualification.log),
[report](evidence/async-timeout-stability/report.json) and five full logs in the
same directory retain the results. Source hashes were verified unchanged
throughout. The report records the load process's measured CPU time and shared
CPU affinity.

`pnpm typecheck` passed ([output](evidence/async-timeout-stability/typecheck.txt)). CI acceptance requires three consecutive green
`Typecheck, unit tests and build` jobs on `main`; local qualification does
not establish that outcome. Delivery and CI follow-through belong to the
integration owner.

The final guarded `aq git pull --branch main` and `git merge origin/main`
confirmed that `origin/main` remained at `0634356`; no source changes were
introduced. The required final targeted check passed **93/93 tests in six
files**, with zero MSW errors ([native output](evidence/async-timeout-stability/postmerge-focused.txt),
[AQ output](evidence/async-timeout-stability/postmerge-focused-aq.txt)):

```sh
PYTHONDONTWRITEBYTECODE=1 AQ_WORK_DIR="$PWD" \
  DASHBOARD_CHECK_COMMAND='pnpm test -- src/features/supervisor/SupervisorConversation.test.tsx src/features/agents/SessionEvents.test.tsx src/features/agents/SessionUsage.test.tsx src/app/Shell.test.tsx src/features/playbooks/CurrentCatalog.test.tsx src/features/work/Work.test.tsx' \
  DASHBOARD_CHECK_LOG=/tmp/azure-harbor-91/postmerge-focused.txt \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

`git diff --check` passed.

Delivered visual subset: none. No production pages or styles changed.
Existing desktop/phone visual acceptance and deferred workflows retain their
prior status.
