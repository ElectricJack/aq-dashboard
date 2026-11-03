# Frontend release-gate test repair

November 2, 2026; task `keen-vault-60`, source base `eee9d83`, integrated with
`main` at `d862145` before publication.

The assigned source did not include the linked E3 report or test log. The named
suites were investigated directly. No production page, route, adapter, CSS or
contract behavior changes are included.

## Repair

- `src/test/setup.ts` supplies jsdom's missing `matchMedia` and `ResizeObserver`
  interfaces when a browser environment exists. Media queries remain nonmatching
  and resize observation performs no layout simulation. Browser checks retain
  responsibility for measured layout.
- `src/test/renderApp.tsx` resolves the real production lazy route exports in
  `beforeAll`, then renders those components with the same route definitions.
  This places cold compilation and initial lazy hydration in setup. Each app's
  router and query cache are disposed after cleanup so pending work cannot leak
  into the next test. Production cache timing is retained.
- `TerminalTail.test.tsx` explicitly opens Transcript, matching the current
  default Terminal view. Its watch, byte escaping, gap, authorization, expiry
  and output-clearing assertions remain intact.
- Vitest's configured worker cap is reduced from four to two to leave CPU for
  rendering on the shared Rust build host. Isolation, assertion deadlines and
  test coverage are retained; no tests are skipped or assertions removed.

## Evidence and repeatable checks

The installed `aq test` runner supports pytest and Bazel. The retained
[subprocess bridge](evidence/frontend-test-repair/aq_frontend_bridge.py) runs the
native frontend command in the foreground while aq holds a test slot. Example:

```sh
AQ_WORK_DIR="$PWD" DASHBOARD_CHECK_COMMAND='pnpm test' \
  DASHBOARD_CHECK_LOG=/tmp/dashboard-unit.txt \
  aq test -n 0 docs/implementation/evidence/frontend-test-repair/aq_frontend_bridge.py
```

Replace `DASHBOARD_CHECK_COMMAND` with a focused `pnpm test <files>`,
`pnpm typecheck` or `pnpm build`. The bridge uses one pytest process; Vitest
enforces its own configured worker cap. The explicit `-n 0` does not change the
native frontend test set.

The first focused run after adding `matchMedia` reported 25 failures and 57
passes; [full output](evidence/frontend-test-repair/initial-focused.txt) records
cold route hydration and missing resize observation. After browser shims and
route preparation, the original six suites passed **82 tests**
([output](evidence/frontend-test-repair/focused.txt)). The initial full check at
four workers reported 640 passes and four failures
([output](evidence/frontend-test-repair/initial-unit.txt)). Materializing route
exports left one initial root-navigation timeout among 127 extended focused
tests ([output](evidence/frontend-test-repair/extended-focused-before-cap.txt));
that redirect passed in isolation. The configured two-worker `pnpm test` gate
then passed **644 tests in 69 files**, with no skipped tests, in 122.80 seconds
([full output](evidence/frontend-test-repair/unit.txt)).

After integrating `main`, the same nine browser suites passed all 127 tests. The
new Node-environment bundle-manifest suite exposed an unguarded `window` reference
in the added shim ([output](evidence/frontend-test-repair/postmerge-before-node-guard.txt)).
Both browser shims now guard the environment before accessing browser APIs.
The final post-merge check passed **130 tests in 10 files**, with no skips, in
40.56 seconds ([output and exact file list](evidence/frontend-test-repair/postmerge.txt)).

`pnpm typecheck` passed after the final route-helper change
([output](evidence/frontend-test-repair/typecheck.txt)). The final post-merge
`pnpm build` passed TypeScript, Vite, the mock-leak check and bundle-manifest generation
([output](evidence/frontend-test-repair/build.txt)).

## Visual and delivery boundary

Delivered visual subset: none; this is test infrastructure and test navigation.
No new desktop or phone screenshots or full-page visual acceptance are claimed.
Existing page designs and their deferred workflows retain their prior acceptance
status. jsdom's canvas diagnostic remains visible; its missing canvas layout is
not treated as terminal-rendering qualification.

The generic startup instructions name `origin/dev`. The guarded pull confirms
that this repository has no such ref. Its fetch exposed `origin/main` at
`d862145` and the linked E3 report. That report records the same missing-dev
failure and establishes `aq git pull --branch main` as the actual integration
workflow. The supervisor was notified of the evidence and resolved base choice;
the guarded main pull completed without conflicts. Default-branch publication
remains integration-owned.
