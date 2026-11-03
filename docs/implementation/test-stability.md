# Dashboard test stability

November 2, 2026; task `sound-stone-19`, source base `2168d32`.

The [G12 baseline](G12.md) records eight TerminalTail failures from missing
jsdom browser APIs and cold-route assertion timeouts in catalog/media checks.
The completed prerequisite `aq/keen-vault-60` (`836cf4b`) already repairs the
browser APIs, Transcript navigation, route preparation and app cleanup. This
task merges that existing repair with current main, preserving its history;
it does not duplicate those changes. See its
[implementation and evidence](frontend-test-repair.md).

The additional source change is confined to `TerminalTail.test.tsx`:

- Follow-up gap and access-failure responses wait until the test has observed
  the preceding bytes. The real application still polls and processes the
  actual MSW responses; observing the first state no longer races a 250 ms poll.
- The expiry check uses a controlled monotonic/timer clock with the real
  15-second Watch intent. It checks retained bytes at 14,999 ms, clearing at
  15,000 ms, and no renewal after another 30 seconds. It replaces the former
  500 ms fixture deadline and retains all eight behavioral cases.

No assertions are removed, no tests are skipped, and assertion deadlines are
unchanged. The inherited Vitest worker cap remains two. Catalog/media specs
need no additional edits because the prerequisite prepares all real route
exports before assertions start.

## Verification

Node `v24.15.0`, pnpm `10.34.5`. Final tests use the prerequisite's retained
[AQ frontend bridge](evidence/frontend-test-repair/aq_frontend_bridge.py), with
one pytest process holding the AQ resource slot and the native Vitest worker
cap controlling frontend concurrency:

```sh
PYTHONDONTWRITEBYTECODE=1 \
  DASHBOARD_CHECK_COMMAND='<native command below>' \
  DASHBOARD_CHECK_LOG="$PWD/<output path>" \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

| Final-tree command | Result | Evidence |
| --- | --- | --- |
| `pnpm test -- src/features/agents src/features/playbooks src/features/results src/api/interactiveTerminalClient.test.ts src/api/adapters/terminalTail.test.ts src/api/terminalClient.test.ts` | 123/123 tests, 14/14 files | [native output](evidence/test-stability/related.txt), [AQ slot result](evidence/test-stability/related-aq.txt) |
| `pnpm test -- src/features/agents/TerminalTail.test.tsx src/features/playbooks/CurrentCatalog.test.tsx src/features/results/ResultMediaUpload.test.tsx --maxWorkers=1 --sequence.shuffle --sequence.seed=19` | 44/44 tests, 3/3 files | [native output](evidence/test-stability/shuffled-single.txt), [AQ slot result](evidence/test-stability/shuffled-aq.txt) |
| `pnpm typecheck` | Pass | [output](evidence/test-stability/typecheck.txt) |
| `git diff --check` | Pass | No whitespace errors |

Before reconciling the overlapping prerequisite, the independent implementation
also passed `pnpm test` at the former four-worker cap: 671/671 tests in 72/72
files ([output](evidence/test-stability/pre-reconciliation-full.txt)). That is
pre-integration evidence, not a full-suite result for the final merged tree.
Final post-merge testing is deliberately targeted. `pnpm lint` passed before
the merge; this task changes no scripts.

jsdom's existing canvas diagnostic remains visible. The checks exercise xterm
mount/disposal and transcript behavior, not browser layout or pixel rendering.
Delivered visual subset: none; no pages or production behavior change and no
new desktop/phone visual acceptance is claimed.

`origin/dev` is absent: both the required local merge and guarded dev pull
failed. Supervisor message `msg-4615853dcf7546efb19d070d005efef5` approved
`origin/main`; the guarded main pull succeeded and `git merge origin/main`
reported up to date. Publication stays on `aq/sound-stone-19`; delivery to main
belongs to the integration owner. The final publication SHA is recorded by AQ.
