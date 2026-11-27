# aq-dashboard

aq-dashboard is the AQ v2 browser UI for work, agent terminals, Supervisor conversations, playbooks and settings. The [agent-queue umbrella repository](https://github.com/aq-platform/agent-queue) provides the platform overview and includes this [aq-platform component](https://github.com/aq-platform/aq-dashboard) as its `aq-dashboard/` submodule alongside five other components. The dashboard consumes the central AQ API; AQ owns authorization, scheduling, lifecycle policy and authoritative state.

The React application includes Overview, task lists/graphs and task creation, agent history and interactive terminals, Supervisor messaging with attachments, playbook inspection and capability-gated actions, fleet performance and configuration views. Results media, comments and feedback tasks, Decisions and Knowledge also have routes. Results, Knowledge and the general Decisions view are currently hidden from navigation; Decisions is exposed when host decisions are supported, and Performance requires its server capability. These routes and controls do not imply that every installation supports their APIs: availability follows the server's advertised capabilities and the current user's permissions.

- [Full specification reader](docs/index.html) — product design, API proposal, implementation plan and contract audit in one browser document.
- [Product and interaction design](docs/specs/0002-product-design.md) — all screens, responsive layouts, provider usage, full-page supervisor, focused terminals and Results/feedback.
- [API and integration contract proposal](docs/specs/0003-dashboard-api.md) — existing interfaces, missing read models, media/comment/feedback contracts and recovery behavior.
- [Implementation plan](docs/plans/0001-dashboard-implementation.md) — stack, dependencies, work packages, performance budgets and acceptance scenarios.
- [Live delivery and visual completion](docs/plans/0003-live-dashboard-delivery.md) — historical delivery audit, assignments and visual acceptance tracking.
- [D03 scaffold plan](docs/plans/0002-d03-shell-scaffold.md) and [evidence](docs/evidence/d03.md) — the initial scaffold and its checks.
- [Contract readiness audit](docs/research/2026-10-31-contract-audit.md) — the October 31 contract assessment and source evidence.
- [Visual gallery](docs/design/index.html) — twelve selected desktop/mobile mockups preserved with hashes.
- [Visual acceptance](docs/design/visual-acceptance.md) — per-page reference, composition and screenshot review requirements while connecting real infrastructure.
- [Dashboard architecture baseline](docs/specs/0001-dashboard.md)
- [AQ ecosystem and releases](../aq-server/docs/architecture/0001-ecosystem-and-releases.md)
- [Execution and recovery](../aq-server/docs/architecture/0002-execution-and-recovery.md)
- [Profiles, intelligence, mandatory tmux hosting and remote terminals](../aq-server/docs/architecture/0003-agent-profiles-harnesses-and-terminals.md)

The production build produces a static bundle with a versioned, hash-checked manifest for AQ to serve. Development uses explicit mock fixtures or a same-origin proxy to an AQ daemon; unit and mock browser tests do not require worker nodes or domain databases. Sibling documentation links resolve in an umbrella checkout and are not build dependencies. The linked specifications and retained evidence describe design intent and earlier qualifications, rather than the status of a running installation.

The Markdown documents are canonical. `python3 scripts/render-specs.py` regenerates the local HTML specification reader and mockup gallery (requires Python Markdown); this is documentation tooling, not a dashboard application build.

## Development

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, production build with the mock-leak check, and the Playwright/axe browser checks on every push and pull request.

Requires Node.js 24 or newer and pnpm 10.34.5, as declared in `package.json`; `pnpm-lock.yaml` pins dependencies.

```sh
pnpm install --frozen-lockfile
pnpm dev:mock          # app on proposed fixtures; add ?scenario=stale|unknown|unavailable|failed
AQ_DAEMON_URL=http://127.0.0.1:8080 pnpm dev  # same-origin proxy to a local AQ daemon
pnpm test              # unit/component tests (Vitest)
pnpm exec playwright install --with-deps chromium  # browser setup for Playwright
pnpm test:e2e          # Playwright responsive + axe checks against the mock harness
pnpm typecheck
pnpm build             # static bundle in dist/, then fails if mock code or fixtures leaked
```

`contracts/proposed/` and `src/api/wire/proposed.ts` retain the broader [API proposal](docs/specs/0003-dashboard-api.md). [Live contracts](contracts/live/README.md), API clients and bootstrap capability checks define the integrations used by the application; proposed types alone do not make a route available. Mock mode shows a persistent on-screen banner. The normal production build excludes mock code and fixtures and checks the output for leaks before writing `dist/dashboard-manifest.json` with asset hashes, compatibility requirements and Git source provenance. Manifest generation requires a Git checkout.

## Connect a built dashboard to AQ

Build the dashboard, then configure the AQ server to serve the resulting bundle:

```sh
pnpm build
# In the umbrella checkout's aq-server/ directory, with DATABASE_URL and a vault configured:
AQ_DASHBOARD_DIR=/absolute/path/to/aq-dashboard/dist cargo run -p aq-server -- serve --vault /absolute/path/to/vault
```

Open the configured AQ human-listener URL (for example, `http://127.0.0.1:8080`). For Vite development, `AQ_DAEMON_URL` must be an HTTP(S) origin without credentials, a path, query or fragment. The proxy forwards `/api`, `/healthz` and `/readyz`, preserving Origin and authentication headers. Configure the daemon's allowed browser origin to match the development URL; the proxy does not add credentials. Authentication and authorization belong to AQ.

Run the framework browser smoke against an actual configured daemon:

```sh
AQ_LIVE_URL=http://127.0.0.1:8080 pnpm test:live tests/live/framework.spec.ts
```

This selected file checks live identity, capabilities, Overview/Agents/Settings navigation, worker reads, direct refresh, API/asset error handling, visible session details and saved project bindings without API mocks. The session case skips when no sessions are visible. The full `pnpm test:live` suite includes additional capability checks and optional mutation/terminal tests that require explicitly configured disposable resources; the selected framework smoke does not run those tests.

[D05](docs/evidence/d05-live-framework.md) retains the initial live connection qualification, including its source/bundle pins and development fixture limits. It is historical evidence, not a claim about the current deployment. Live and mock browser runs use separate output directories.
