# D05: initial live framework connection

Qualified locally on 2026-10-31. The production dashboard connects to AQ's real
human listener and PostgreSQL for bootstrap, a partial overview, authorized
project/session reads and foundation worker/status observations. Broader API-02
and UI-01 remain in progress. No release or deployment is implied.

## Exact assembly

- Frontend source: `dbbba20936a9ff9c8767796832aa29b9a0523368`.
- Built daemon: `8bc7a63bac9cab843d307b584c87683c1b51c6b9`, incorporating static
  source `26201d9` and dashboard read source `44dcab8`. Later daemon documentation
  commits do not change this binary.
- API profile: `dashboard-read-1`; individual capability versions: `1`.
- Bundle manifest SHA-256:
  `6d19f55ac7103e3993ddc0ea6f10cd9b20250abdf940690f99afee7198228f68`.
  The running bootstrap reports this exact digest. All 20 listed assets were
  validated and loaded into immutable memory at startup.
- Exact artifact hashes, retained log hashes, runtime versions and source pins:
  [inventory](live-framework/inventory.json). The copied
  [manifest](live-framework/dashboard-manifest.json) records individual asset hashes.

## Checks and outcomes

| Check | Command or boundary | Outcome |
| --- | --- | --- |
| Unit/component suite | `pnpm test` (four Vitest workers) | 234 passed |
| Typecheck and production artifact | `pnpm build` | Passed; no mock code/fixtures; manifest generated |
| Mock browser/responsive/accessibility | `pnpm test:e2e` | 35 passed |
| Actual daemon browser | `AQ_LIVE_URL=http://127.0.0.1:4188 pnpm test:live` | 4 passed, none skipped |
| Combined Rust server | `CARGO_TARGET_DIR=/tmp/aq22-observations/target CARGO_INCREMENTAL=0 CARGO_BUILD_JOBS=2 AQ_SOURCE_REVISION=8bc7a63bac9cab843d307b584c87683c1b51c6b9 cargo build -p aq-server --bin aq-server --locked --offline` | Passed |

The unit suite includes immediate eviction after resource 401/403, denial with an
unreachable or unchanged bootstrap, explicit recovery, fresh sign-out priority,
resource 426, missing envelope data, version/scope mismatch, malformed refreshed
bootstrap and invalid capability booleans. Ordinary transport failures retain the
existing labelled stale-observation behavior. The generic query boundary also
covers Settings' foundation queries; denial cannot leave old worker names visible.

The live suite uses no MSW, route interception or synthetic browser responses. It
checks actual bootstrap, Overview/Agents/Settings navigation, worker observations,
deep-link reloads, unavailable capabilities, API/asset error separation, narrow
layouts and a nonempty session roster/detail. A final mobile session screenshot
is retained as [visual evidence](live-framework/mobile-session.png).

Backend qualification separately retains five PostgreSQL/router tests, two pure
cursor tests, strict targeted lint and schema checks in
[agent-q's record](../../../agent-q/docs/implementation/dashboard-read-1-evidence.md).
Static serving separately retains 88 passing checks and one preexisting ignored
fixture in [its record](../../../agent-q/docs/evidence/dashboard-assets/README.md).
These counts are distinct from the assembled browser smoke.

## Fixture and reproduction boundary

The local daemon uses loopback human/worker ports 4188/4189 and isolated database
`aq_dashboard_live_20261031_1439` on the existing disposable test PostgreSQL. Its
vault uses development auth. It has no production graph, provider or credentials.
The bundle is supplied through `AQ_DASHBOARD_DIR`; restarting AQ loads new bytes.

The retained [seed script](live-framework/seed-fixture.py) documents the exact
public-API setup: enrollment, heartbeat, protocol-v2 registration and the existing
development-only execution-fixture endpoint. The fixture is explicitly labelled
`Fixture session …`; it never receives an accept, grant or process. Enrollment
credentials remain in script memory and are not retained. This is a working
browser/API connection, not proof of native execution or provider activity.
The separate checked-in API fixtures exercise synthetic native authority records
through real PostgreSQL/router tests; [their pin](../../contracts/live/source.json)
distinguishes that evidence from the browser's legacy development fixture.

For another installation, follow the [README](../../README.md) using its normal
vault/database and a separately built bundle. The live test's session case skips
on an empty installation; this qualification deliberately seeds one, so none skip.
The evidence seed script is specific to the isolated local fixture and absolute
paths; it is not a production setup or migration tool.

## Retained negative outcomes and limits

An earlier default-parallel unit run timed out on the one-second first-roster
assertion amid concurrent builds. Focused rerun passed; the suite now uses four
workers and retains the original assertion timeout. Shared-load causation is
plausible, not proved. The negative log is retained; this does not establish
unbounded-concurrency qualification.

An initial simultaneous mock/live browser run produced an `ENOENT` while closing
a Playwright trace (34 passed, one failed). Both configurations shared an output
directory and one run removed the other's artifacts. Live tests now use their own
output directory. The negative log is retained; the final concurrent runs pass.

Work/decisions/search, Results/media, playbooks, knowledge, supervisor chat, account
quota and terminal interactions remain capability-disabled. Counts without an
owner stay unknown. A grant or heartbeat never becomes a claimed live process.
Cursor/response/SQL limits do not prove history-independent database performance.
No native-execution, terminal, release, mutation or broader product gate is closed.
