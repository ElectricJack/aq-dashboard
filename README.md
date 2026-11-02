# aq-dashboard

The standalone dashboard for Agent Q v2. It consumes the central AQ API and owns browser presentation, interaction and accessibility. AQ owns authorization, scheduling, lifecycle policy and authoritative state.

The application includes responsive task/knowledge inspection, recorded Overview contributions, Agents/source events, human Supervisor history, Results metadata and capability-gated policy/review views. The [current local availability matrix](docs/plans/0003-live-dashboard-delivery.md#delivered-increments-and-remaining-gates-at-canonical-state37) records actual canonical AQ37/source511ee99 with bundle6247: real Playbooks/Decisions owners, successful empty current Definitions/Activations and review queue. Its unchanged frontend has 633 passing tests. Full page designs, workflow automation, live Supervisor responses, provider quota and terminal control remain open; canonical PNG uploads remain disabled. The [cutover evidence](../aq-server/docs/implementation/evidence/canonical-uds-empty-owner-live/README.md) distinguishes live features from disposable populated/action fixtures.

- [Full specification reader](docs/index.html) — product design, API proposal, implementation plan and contract audit in one browser document.
- [Product and interaction design](docs/specs/0002-product-design.md) — all screens, responsive layouts, provider usage, full-page supervisor, focused terminals and Results/feedback.
- [API and integration contract proposal](docs/specs/0003-dashboard-api.md) — existing interfaces, missing read models, media/comment/feedback contracts and recovery behavior.
- [Implementation plan](docs/plans/0001-dashboard-implementation.md) — stack, dependencies, work packages, performance budgets and acceptance scenarios.
- [Live delivery and visual completion](docs/plans/0003-live-dashboard-delivery.md) — November 1 per-tab audit, parallel assignments, actual API gaps and mockup acceptance; linked to the canonical AQ task graph.
- [D03 scaffold plan](docs/plans/0002-d03-shell-scaffold.md) and [evidence](docs/evidence/d03.md) — what the current application does and how it was checked.
- [Contract readiness audit](docs/research/2026-10-31-contract-audit.md) — what is implemented, specified or missing, with source evidence.
- [Visual gallery](docs/design/index.html) — twelve selected desktop/mobile mockups preserved with hashes.
- [Visual acceptance](docs/design/visual-acceptance.md) — per-page reference, composition and screenshot review requirements while connecting real infrastructure.
- [Dashboard architecture baseline](docs/specs/0001-dashboard.md)
- [AQ ecosystem and releases](../aq-server/docs/architecture/0001-ecosystem-and-releases.md)
- [Execution and recovery](../aq-server/docs/architecture/0002-execution-and-recovery.md)
- [Profiles, intelligence, mandatory tmux hosting and remote terminals](../aq-server/docs/architecture/0003-agent-profiles-harnesses-and-terminals.md)

The intended release is a versioned static bundle packaged into the AQ server image. Development uses a mock API or local daemon; normal dashboard tests do not require worker nodes or domain databases. Sibling documentation links assume side-by-side checkouts and are not build dependencies.

Contract readiness is **partial**: live human Graph, mailbox, observations, review and policy inspection are coherent API-02 increments. Provider account quota, connected Supervisor dispatch/replies, complete Results/media deployment, anchored comments and feedback creation remain separate gates. The [availability matrix](docs/plans/0003-live-dashboard-delivery.md#delivered-increments-and-remaining-gates-at-canonical-state37) identifies each configured subset; proposed routes are not represented as live endpoints.

The Markdown documents are canonical. Regenerate the local HTML reader with `python3 scripts/render-specs.py` (requires Python Markdown); this is documentation tooling, not a dashboard application build.

## Development

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, production build with the mock-leak check, and the Playwright/axe browser checks on every push and pull request.

Requires Node 24 and pnpm 10 (exact versions pinned in `package.json` and `pnpm-lock.yaml`).

```sh
pnpm install
pnpm dev:mock          # app on proposed fixtures; add ?scenario=stale|unknown|unavailable|failed
AQ_DAEMON_URL=http://127.0.0.1:8080 pnpm dev  # same-origin proxy to a local AQ daemon
pnpm test              # unit/component tests (Vitest)
pnpm test:e2e          # Playwright responsive + axe checks against the mock harness
pnpm typecheck
pnpm build             # static bundle in dist/, then fails if mock code or fixtures leaked
```

`contracts/proposed/` and `src/api/wire/proposed.ts` retain the broader [API proposal](docs/specs/0003-dashboard-api.md). Only the negotiated [live read subset](contracts/live/README.md) is implemented by the current framework; a type definition alone does not make another route available. Mock mode shows a persistent on-screen banner and is excluded from production builds.


## Connect a built dashboard to AQ

```sh
pnpm build
# In the agent-q checkout, with the usual DATABASE_URL and vault configured:
AQ_DASHBOARD_DIR=/absolute/path/to/aq-dashboard/dist cargo run -p aq-server -- serve --vault /absolute/path/to/vault
```

Open the daemon's human-listener URL (usually `http://127.0.0.1:8080`). AQ verifies
`dist/dashboard-manifest.json` and all listed assets at startup. The bundle is
loaded into memory; rebuild and restart AQ to change it. Missing or corrupted
configured bundles prevent startup. Leave `AQ_DASHBOARD_DIR` unset to retain an
API-only daemon. Do not point the browser at the worker listener.

Use the existing vault authentication. Development auth identifies every visitor
as its configured development user; keep that setup on loopback. Production uses
AQ's Cloudflare Access identity and existing Owner/Viewer permissions. The Vite
proxy adds no credentials and preserves Origin, so the daemon's `public_origin`
must match the browser origin for future mutation flows.

The dashboard repo is a separate build. Runtime integration consumes only the
versioned, hash-checked static bundle; AQ does not require a sibling source tree,
Node, pnpm or a second backend. For an existing Compose installation, AQ's optional
`compose.dashboard.yaml` overlay mounts a bundle supplied through
`AQ_DASHBOARD_BUNDLE`. This does not publish a new server image or release.

Run the read-only browser smoke against an actual configured local daemon:

```sh
AQ_LIVE_URL=http://127.0.0.1:8080 pnpm test:live
```

This checks live identity, capabilities, Overview/Agents/Settings navigation,
worker reads, direct page refresh and API/asset error handling without API mocks.
It does not launch agents or qualify terminal streaming. The original first profile left
Work, Decisions, Results, Search, Playbooks, Knowledge and Supervisor disabled;
that historical D05 boundary is superseded by the current availability matrix.
Provider account quota and live Supervisor responses remain unavailable; absent
measurements are never displayed as zero.

The initial live connection is qualified in
[D05](docs/evidence/d05-live-framework.md), with exact source/bundle pins and
retained results. The live browser suite also opens a session and checks its deep
link when the configured installation has one; an empty installation skips that
case. The retained qualification uses a nonempty, clearly labelled development
fixture and does not run a harness. Live and mock browser runs use separate output
directories so they can run concurrently without deleting each other's traces.
