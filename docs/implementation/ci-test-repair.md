# Remaining CI test repairs

Task `quick-meadow-44`, source base `c332f4e`, November 2, 2026.

The CI baseline `/tmp/grand-lantern-86-ci-baseline.log` fails three
bundle-manifest tests while committing their temporary Git repositories without
an author identity. The SessionEvents401 case fails before its authorization
exercise, waiting for the initial Session details control.

`src/test/bundleManifest.test.ts` now supplies author and committer identity only
to fixture Git subprocesses. It preserves the worker environment and leaves
developer/CI Git configuration untouched. The existing three behavioral tests
also pass with empty inherited identity and global/system Git config disabled.

`src/features/agents/SessionEvents.test.tsx` waits for the visible Primary
navigation (bootstrap complete), then for Session details (session read
complete). Each step retains Testing Library's normal assertion deadline.
All source-event, paging, navigation and authorization assertions remain.
Production code, the shared test runner and `maxWorkers: 2` are unchanged.

The related Supervisor repair is owned by `grand-lantern-86`, commit
`058e623997d88b5685d7b110408560eabd70019e`, PR #6. That worker confirmed no
overlapping files or shared runner/config changes. `wise-journey-87` was also
notified of these two owned test files.

## Verification

All native commands run in the foreground under the existing AQ frontend bridge:

```sh
PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='<native command>' \
  DASHBOARD_CHECK_LOG='<log path>' \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

| Native command | Result | Evidence |
| --- | --- | --- |
| `pnpm test -- src/test/bundleManifest.test.ts src/features/agents/SessionEvents.test.tsx` | 14/14 tests, 2/2 files | [focused.txt](evidence/ci-test-repair/focused.txt) |
| `env GIT_AUTHOR_NAME= GIT_AUTHOR_EMAIL= GIT_COMMITTER_NAME= GIT_COMMITTER_EMAIL= GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 pnpm test -- src/test/bundleManifest.test.ts` | 3/3 tests | [no-git-identity.txt](evidence/ci-test-repair/no-git-identity.txt) |
| `pnpm test`, consecutive repetitions with the unchanged two-worker cap | Runs 1–3: 698/698 tests in 75/75 files. Run 4: 696/698 tests; sequence stopped. | [source hashes and per-run summaries](evidence/ci-test-repair/repetitions.json), [run 4 output](evidence/ci-test-repair/full-suite-run-04.txt) |

The requirement for **20 consecutive full-suite passes is unmet**. Run 4 fails
`Shell.test.tsx > redirects / to the Overview page` at its initial heading
deadline, and `Work.test.tsx > Back from a task opened in the graph returns
focus to its node` at the focus assertion. The assigned bundleManifest and
SessionEvents suites pass all four full-suite runs. These other failures were
reported to the supervisor for scope/acceptance direction; no additional tests
were changed or skipped.

Delivered visual subset: none. No page changes or new visual acceptance claims.
