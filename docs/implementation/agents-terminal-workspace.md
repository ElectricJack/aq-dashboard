# Agents terminal workspace and retained history

Qualified November 11, 2026, after recovering the November 9–10 session
`01a1c24f-8051-71e0-8755-30fe44fc2cb9`. Implementation follows
[spec 0009](../specs/0009-agents-terminal-workspace.md).

## Delivered behavior

Agents sits directly below Supervisor. `/agents` opens the searchable roster and
up to four independent terminal panes. Swarm remains at `/agents/swarm`; retained
history is at `/agents/history`. Old graph links preserve their selection and old
`/agents/sessions` links redirect with their query parameters intact.

Pane selections survive route changes per identity and project scope. Expand,
focus, search and responsive switching keep existing terminal attachments.
Closing a pane disconnects its attachment; Stop ends a manual agent. Ended panes
freeze input and retain their last observed output until saved output is ready.
Unavailable saved panes remain removable. Protected read failures clear both the
terminal and cached private roster metadata.

History provides metadata filters, bounded transcript pages, search over retained
output, unloaded match navigation across UTF-8/chunk boundaries, scoped copy and
complete paginated downloads. Search changes cancel stale work. Transcript reads
validate session identity, project, advancing cursors and frozen snapshots.
Refused reads remove displayed output. Unsupported servers and unrecorded sessions
have separate states; history never obtains terminal control.

The worker captures output before the provider starts without a browser or
extra resizing attachment. Capture and upload persist separately, with ordered
idempotent chunks and finalization. Raw output stops at 128 MiB without blocking
the agent; normalized archives stop at 64 MiB with partial coverage. State loss
releases the sandbox and finalizes only server-acknowledged bytes as partial;
unrecoverable repeated conflicts stop automatic recovery and retain local chunks.

## Revisions and verification

The dashboard implementation is `43552ac` on `feat/agents-terminal-workspace` in
`wt/agents-terminals-dashboard`. It includes T4 history fixes through `b5beff1`.
The archive implementation is `a17106c5` on `feat/session-transcript-archive` in
`wt/agents-history-server`; worker implementation is `29415877` on
`feat/manual-session-recording` in `wt/agents-history-worker`.

- The full dashboard unit run passed 126 files / 1,280 tests before final focused
  integration changes; the subsequent six affected suites passed 51 tests.
- Typecheck, lint and the production build passed. Bundle validation found no
  shipped mock code. `pnpm test:workspace` passed all five compiled-preview tests.
  Every served asset matched its production manifest hash.
- Browser tests cover four fixture panes across two providers and workers, isolated input,
  the four-pane limit, preserved connections through search/Expand/Restore,
  closing without stopping, explicit stop/history, disconnect/reconnect without
  replay, cross-page search, full download and legacy scoped redirects.
- Tablet/phone checks cover 900/390/320 px, visible Expand/Restore exits, readable
  terminal text, unclipped Type/Ctrl controls, no zero-sized resizes and no
  page-level horizontal overflow. Desktop WCAG-tagged axe checks passed.
- Server SQL/router tests cover older-than-one-day history beyond 256 records,
  retries, finalization, enrollment/ownership/revocation fences, Unicode search,
  byte/response limits and concurrent searches. A large archive remains readable
  through newly constructed routers.
  The final complete `manual_agents::` module passed 7 tests, including real
  WebSocket bytes/input fencing; its two ignored cross-repository tests passed
  separately.
- Ten worker recorder tests pass, including actual tmux fast exit/backlog,
  upload resumption after a local HTTP listener restart, uncertain acknowledgements,
  persisted boundaries and corrupt-state recovery. Formatting and build budgets
  pass. Scoped server Clippy passed.
- Two opt-in cross-repository tests use the actual worker recorder and ServerLink
  against a private SQL-backed server over TCP. The Docker production runner
  captured 114,828 bytes / 1,402 lines with no inference or browser attached; a
  fresh reader retrieved and searched beginning, middle and final output. Corrupt
  recorder state retained both accepted chunks and finalized partial coverage.
- The separate raw-producer check reached exactly 134,217,728 bytes while the
  disposable agent continued and exited normally after drain.

To repeat browser checks, run `pnpm test:workspace`. To repeat Docker capture and
the producer cap, run `python3 scripts/qualify-manual-recording.py` with and without
`--raw-limit` from the worker checkout. The server's ignored tests
`manual_agents::retained_transcript_real_worker_docker_capture` and
`manual_agents::retained_transcript_real_worker_corrupt_recovery` require a private
test `DATABASE_URL`, `AQ_RECORDING_WORKER_DIR`, Docker and the existing
`aq-bootstrap-tmux-proof:26.04` fixture image. Every Cargo invocation uses a timeout
and each checkout's own target directory. Private fixture credentials are never
included in saved evidence.

## Visual review and limits

References reviewed: `08-agents-focus-desktop.png`, `11-agent-mobile-v2.png` and
`14-swarm-tree-v3.png`. The approved roster/four-pane grid intentionally supersedes
the earlier focused desktop composition. This delivery retains the shared dark
shell, compact headers, readable 14px terminal text and output-dominant workspace.
Phones show one selected pane, a quick switcher, a roster drawer and touch input;
with an open terminal, the quota strip remains while ordinary bottom navigation
yields its space to the terminal. History retains a substantial transcript surface
and a visible return to its roster.

Root inspected the actual compiled-preview desktop and phone captures in
[the evidence directory](evidence/agents-terminal-workspace-2026-11-11/).
`served-bundle.json` records source `43552ac`, clean working tree at build time,
toolchain and all 61 asset hashes. Screenshots use labelled fixtures; they do not
claim a production worker or account connection.

Durable capture in this increment covers newly launched manual Claude/Codex
agents. Existing sessions cannot gain missing earlier history. Native queue
sessions use their existing inspection and terminal APIs; no native stop operation
or new native transcript recorder is claimed. Full server-process/database restart
and real mobile IME are not separately qualified by these tests. Router recreation
and interrupted/restarted upload-listener tests are narrower evidence.

No production rollout, installer/runtime pin change, main-branch merge or live
agent takeover was performed. Those remain a separate reviewed delivery step.
