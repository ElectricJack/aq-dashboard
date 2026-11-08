# Swarm phase 2, Task A1: live acceptance results (2026-11-07/08 UTC)

Runner: Claude Opus 5.5 (A1 acceptance agent). Plan: `qa/2026-11-07/swarm-p2/plan.md` (outside the repos). Screenshots: this directory (live) and `../fixture/` (fixture); paths below are relative to `docs/implementation/evidence/swarm-p2/`.

## Deployed
| What | Value |
| --- | --- |
| aq-server | `wt/ms1h-server` at origin/main e44c8024 (contains #112 f68684fb); `up.sh rebuild-server`; `meta.state_format_version = 100`; old image kept as `agent-q-server:ms1-pre-swarm-a1` |
| aq-dashboard | main 9664a5e, `pnpm build`, served from the `dist` mount (server recreated by the rebuild) |
| Served bundle | `sha256:33fda9c51cbe6cca50790ea3e4ab5669457509d2a4802eaf21d86ab3a6118b70` = bootstrap `dashboard_digest` = sha256 of `dist/dashboard-manifest.json` = sha256 of the served `/dashboard-manifest.json` (44 files, source 9664a5e) |
| aq-worker | `wt/ms1h-worker` at origin/main 05390a5; `rebuild-worker.sh` (runtime `aq-worker`, no `--driver`); `up.sh node` with the existing template (057ae952), node.json byte-equivalent to the backup |
| machine.json | `{"key":"desktop","label":"desktop","kind":"local","host_load_file":"/mnt/c/ProgramData/agent-q/host-load.json"}` |
| Machine reports | first row 00:29:48Z from ms1-desktop (b1225fe8): `source linux`, `host_probe missing`, 24 CPUs |
| Measurement | `remeasure.sh check` valid after the rebuild (revision 17, expires 2026-11-08T22:09:50Z); not re-profiled |
| Backups | `~/.local/share/aq-ms1/backup-pre-swarm-a1/` (node.json, runtime and bin aq-worker, controller.log, previous heads, image id) |
| Windows probe | NOT installed (owner approval pending) |

## Results

Sizes: D = desktop 1440x900, P = phone 390x844 (320 also checked for overflow). L = live aq-ms1, F = fixture (`pnpm dev:mock` on port 5191; 5173 was taken by another process).

| # | State / pane | D | P | Observation |
| --- | --- | --- | --- | --- |
| L1 | Tabs (Swarm current, Sessions) | PASS | PASS | Swarm has the current style; Sessions opens `/agents/sessions` with `aria-current=page`. |
| L2 | Opens at zoom 1 on the root; pan; manual fit | PASS | PASS | `scale(1)` centred on the server root; drag pans; Fit view stops at 0.5 (fixture tree still clipped at 0.5). Per ruling. On live data the only loaded machine starts off-screen (see D8). |
| L3 | Server root card and server pane | FAIL | FAIL | Card shows `127.0.0.1:28080`. Pane: Health `ok · v0.1.0 · unknown`, Ready `2 (2 waiting for a slot)`, Projects, Open settings. **Running agents shows 4, then 5 after the run, while Overview reports 0 running (D1).** Usage window reads `anthropic unknown%` (D3). |
| L4 | Machine card "desktop" with CPU/RAM bars | PASS | PASS | `local · 24 cores · max ? agents`, CPU/RAM bars with %; values moved between polls (CPU 52% → 28% → 27% → 32%, RAM 31% → 33% → 34%). |
| L5 | Machine pane (desktop) | PASS | PASS | State holding + reason, Load now, Load avg (last 15 min), Load source `Linux`, Note `Windows host probe missing: showing WSL VM load`, Max agents `unknown` + Edit in Settings, Cores / RAM `24 / 31 GB`, Disk free `313 GB`, Worker nodes `1`, Holding reason — remedy, worker buttons disabled with the note. |
| L6 | Node card and node pane | PASS | PASS | `backend unknown · 0/? slots`; pane Backend unknown, Slots `0/? slots`, Heartbeat `5s ago`, Service `not reported`, Version `aq-worker 0.5.1`, Sandbox `none advertised`, Channel `not reported`, buttons disabled + note. |
| L7 | Free slots / unknown slot total | PASS (live: unknown) / PASS (F) | PASS | Live nodes report no slot total: `0/?` and `5/?`, no free pills, never `0 free` (Review Focus 2). Dashed free pills and the free-slot pane (with holding Why/Fix) checked on F. |
| L8 | Offline / stopped / booting | PASS (offline live) / PASS (F) | PASS | Live: 3 offline machines greyed and dashed, no meters, `offline 21h ago` or `offline` when never seen; pane `offline since …`, `1 (1 offline)`. Stopped: not reachable (phase 1). Booting: F only (`cloud · booting`, dashed amber, Cost `$0.21 / h`). |
| L9 | Holding (amber with reason) | PASS | PASS | Live: desktop `holding: Worker has not reported its capabilities`; ms1-node after the run `holding: Capability report expired`. F: studio `Context measurement expired`. |
| L10 | Waiting branch | PASS | PASS | Live: drawn only while ready = 2 and reasons exist (hidden while ms1-node was eligible during the run); card `2 ready tasks · No machine can take work: …`; pane Why/Fix. F: waiting agents with Why/Fix. |
| L11 | No invented values | FAIL | FAIL | Unknowns read `unknown`/`—`/`?` everywhere except D1 (running agents from stopped attempts). |
| L12 | Text >= 12 px | PASS | PASS | Computed-style scan of tree, pane, legend and tabs at zoom 1: 51 text nodes, none under 12 px; meter labels 12 px. |
| L13 | Keyboard selection | FAIL | n/a | Tab reaches cards in order; Enter and Space select and the URL keeps `?select=`; reload restores the pane. **No visible focus indicator, and a focused card partly off-screen is not panned into view (D2).** |
| L14 | Phone layout | PASS | PASS | Tree above pane; selecting scrolls the pane in and focuses its heading; no horizontal overflow at 390 or 320. dt/dd rows are offset by 8 px (D6). |
| L15 | Console / page errors | PASS | PASS | `agent-browser errors` and console: none. |
| T1 | Agent pill and agent pane (live run) | PASS (with D1, D4, D5) | PASS | The real attempt 98627b5d appeared under ms1-node; pane Task, Attempt `98627b5d · 1m ago`, Model `claude-sonnet-5-5`, Tokens `unknown`, Cancel attempt disabled, Open task, Pop out terminal. Title shows the task UUID (D5); pill reads `anthropic · st…` (D4). |
| T2 | Terminal opens with control taken; typing | BLOCKED (live) / PASS (F) | PASS (F) | Live: `This terminal does not accept input: its AQ terminal policy has input turned off.` The Claude docker-local recipe requires `terminal.input_enabled = false` (aq-worker `native/adapter/claude.rs`), so no live agent can be controlled; the pane correctly shows Watch only, Take control disabled, lease stays null. F: "You have control" without a click; typed `ls` + Enter posted `input` mutations. |
| T3 | Reconnect does not retake control | BLOCKED (live) / PASS (F) | — | F: Disconnect posted `release`; Reconnect posted only `watch` and shows Watch only + Take control. Re-selecting the same agent posts no `control`; a different agent auto-controls once. |
| T4 | Second viewer takeover notices | BLOCKED | — | Live terminals are input-off; the fixture mock is per-browser. Covered by the plan Task D4 client tests only. Session b also opened the live agent watch-only without error. |
| T5 | Pop out terminal | PASS | — | Opens `/agents/a620064c-…` on the session page. |
| T6 | Pane widens for an agent | PASS | n/a | `data-wide`; pane 634 px = 55 % of the stage. |
| T7 | Task cleanup | PASS | — | Task `aa28645e-022c-46bb-9f4e-e0ea56d48aac` retired (change set 45c9b206). No sandbox left on the podman socket. Its attempt keeps `holds_task = t` like the earlier proof attempts. |
| F1 | Fixture states | PASS | PASS | Dashed free pills, laptop greyed dashed (opacity 0.55) without meters, studio amber holding + reason, boat vm-a dashed amber booting, amber dashed waiting branch and pills, Codex `#111` inset ring, legend. |
| F2 | Fixture panes | PASS | PASS | Server, machine (desktop, studio, laptop, boat), node, free slot (plain and on a holding machine), waiting, waiting agent, agent with terminal. |
| W | WSL2 Windows load | PASS (missing path) | PASS | `host_probe: missing`, `source: linux`; pane `Load source Linux` + `Windows host probe missing: showing WSL VM load`. Windows-load check itself is PENDING owner approval of the probe. |

Counts: 26 rows; FAIL 3 (L3, L11, L13; two root defects), BLOCKED 3 live (T2–T4, platform: input-off terminals).

## Defects

### D1 — Stopped attempts that still hold their task are shown as running agents (major, blocks owner acceptance)
- Repro: aq-ms1, open `/agents?select=server` at 1440. Server pane: `Running agents 4` before the run, `5` after it. Overview (`GET /api/v1/overview`) at the same moment: `running 0 (exact)`. When ms1-node is online, the tree draws all 5 `anthropic · standard` pills under it, but every one of those sessions has `lifecycle.stopped_at` set (2cb65ea4, 2f28ecd7, 34ebe951, 2b770724 from 2026-11-06/07, and this run's 98627b5d stopped 00:39:14Z).
- Cause: `aq-swarm` `assemble::running` selects `execution_attempts WHERE holds_task` (`crates/aq-swarm/src/assemble.rs:103`), and `running_agents` is the capacity's occupied slot count (`crates/aq-server/src/dashboard_api/swarm.rs:59`). Retained `AttemptStopped` attempts keep `holds_task`.
- Screenshots: `live/agents-swarm-desktop-1440.png`, `live/agents-swarm-desktop-1440-after-run-fit.png`, `live/agents-swarm-desktop-1440-agents-zoom1.png`.
- Why blocking: it breaks the plan's "never render invented counts, status or load" rule on the first thing the owner sees, and the swarm contradicts Overview.

### D2 — Tree cards have no visible keyboard focus, and a partly hidden focused card is not panned into view (major, a11y; blocks owner acceptance)
- Repro: `/agents` at 1440. Focus the Sessions tab, press Tab twice. `document.activeElement` is the `desktop` machine card (`.react-flow__node`), its rect is x 19–259 while the stage starts at x 248, and the viewport stays at `translate(-230px, 24px)`. Press Tab again: ms1-desktop gets focus and the view pans, but no outline or shadow marks it (computed `outline: none`, `box-shadow: none` on both the node wrapper and the card button).
- Cause: focus sits on the React Flow node wrapper (`nodesFocusable`), while the only focus style is `.card:focus-visible` on the inner button, which has `tabIndex=-1`. React Flow treats a partly visible node as visible and does not pan.
- Screenshots: `live/agents-swarm-desktop-1440-keyboard-focus.png` (ms1-desktop focused, no ring), `live/agents-swarm-desktop-1440-keyboard-focus3.png` (desktop focused, off-screen).
- Why blocking: A1 requires that keyboard selection works; selection works, but a keyboard user cannot see where focus is (WCAG 2.4.7), and the D lane round-1 fix for off-screen focus is not complete.

### D3 — Usage window reads `anthropic unknown%` (minor, copy; not blocking)
- Repro: `/agents?select=server`. Expected `anthropic unknown`. The plan's template appends `%` after the fallback.

### D4 — Live agent pills are truncated at zoom 1 with no tooltip (minor; not blocking)
- Repro: pan to the ms1-node agents at zoom 1: every pill reads `anthropic · st…` (label `scrollWidth > clientWidth`, `title` empty). The live provider id is `anthropic` where the mockup and fixture say `claude`. Class is still carried by colour and the accessible name. Screenshot `live/agents-swarm-desktop-1440-agents-zoom1.png`.

### D5 — Agent pane title and Task show the task UUID (minor, pre-existing server session read; not blocking)
- Repro: select the live agent: title `aa28645e-022c-46bb-9f4e-e0ea56d48aac`, Task `Local scratch development / aa28645e-…`. `GET /api/v1/sessions` returns `task.title` equal to the task id for every session on this stack, so the roster has the same gap.

### D6 — Phone pane labels sit 8 px below their values (cosmetic; not blocking)
- Repro: 390x844, `/agents?select=machine:desktop`: first `dt` top 296 px vs `dd` top 288 px; all rows. Screenshot `live/agents-swarm-phone-390-machine-pane.png`.

### D7 — Health shows source revision `unknown` (minor, stack build metadata; not blocking)
- The aq-ms1 server image reports `source_revision: unknown`, so Health reads `ok · v0.1.0 · unknown`.

### D8 — Live tree opens with the loaded machine off-screen (observation for the owner, per ruling; not blocking)
- With 5 machines the zoom-1 root-centred open shows only the root and offline machines at 1440 and 390; `?select=machine:desktop` does not pan to the selection. Screenshots `live/agents-swarm-desktop-1440-open.png`, `live/agents-swarm-phone-390.png`.

## Not reachable on live data
Stopped machines (phase 1), booting VMs (no boat), free-slot pills (no slot totals), Codex ring, per-agent waiting pills (phase 3), terminal control and takeover (input-off terminals). Watch-only for a non-owner viewer: the stack cannot sign one in; covered by `SwarmPane.test.tsx` only. Older server / 403 degradation: covered by the plan Task D3 test only.

## Pending
- Windows host-load probe: not installed; owner approval pending. After approval: install, confirm `host-load.json` < 10 s old, `Load source Windows host (WSL2)`, and the CPU bar rising under a Windows CPU load.

## Mutations on aq-ms1
- Server rebuilt to origin/main e44c8024 (migration 0100); old image tagged `agent-q-server:ms1-pre-swarm-a1`.
- Runtime and controller `aq-worker` rebuilt from 05390a5; node controller restarted (pid in `worker/controller.pid`); `worker/machine.json` written; `worker/node.json` rewritten with identical content.
- Task `aa28645e-022c-46bb-9f4e-e0ea56d48aac` created (priority 900), one attempt 98627b5d (session a620064c) ran 361 s, task retired.
- No QA or MS1 evidence task touched; the measurement was not re-run.

