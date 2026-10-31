# aq-dashboard

The planned standalone dashboard for Agent Q v2. It consumes the central AQ API and owns browser presentation, interaction and accessibility. AQ owns authorization, scheduling, lifecycle policy and authoritative state.

This directory contains the design and implementation specifications, the accepted mockup references and the D03 application scaffold: shell, navigation, responsive layout, provider usage strip and a mock harness built against **proposed** contracts. No release pipeline, published API-02 contract or remote repository is established yet.

- [Full specification reader](docs/index.html) — product design, API proposal, implementation plan and contract audit in one browser document.
- [Product and interaction design](docs/specs/0002-product-design.md) — all screens, responsive layouts, provider usage, full-page supervisor, focused terminals and Results/feedback.
- [API and integration contract proposal](docs/specs/0003-dashboard-api.md) — existing interfaces, missing read models, media/comment/feedback contracts and recovery behavior.
- [Implementation plan](docs/plans/0001-dashboard-implementation.md) — stack, dependencies, work packages, performance budgets and acceptance scenarios.
- [D03 scaffold plan](docs/plans/0002-d03-shell-scaffold.md) and [evidence](docs/evidence/d03.md) — what the current application does and how it was checked.
- [Contract readiness audit](docs/research/2026-10-31-contract-audit.md) — what is implemented, specified or missing, with source evidence.
- [Visual gallery](docs/design/index.html) — twelve selected desktop/mobile mockups preserved with hashes.
- [Dashboard architecture baseline](docs/specs/0001-dashboard.md)
- [AQ ecosystem and releases](../agent-q/docs/architecture/0001-ecosystem-and-releases.md)
- [Execution and recovery](../agent-q/docs/architecture/0002-execution-and-recovery.md)
- [Profiles, intelligence, mandatory tmux hosting and remote terminals](../agent-q/docs/architecture/0003-agent-profiles-harnesses-and-terminals.md)

The intended release is a versioned static bundle packaged into the AQ server image. Development uses a mock API or local daemon; normal dashboard tests do not require worker nodes or domain databases. Sibling documentation links assume side-by-side checkouts and are not build dependencies.

Contract readiness is **partial**: terminals, durable mail, observations, identity and other foundational APIs exist, but API-02 remains planned. Provider account quota, global conversation integration, Results/media, anchored comments and feedback creation require the additions specified here. Proposed routes are not represented as live endpoints.

The Markdown documents are canonical. Regenerate the local HTML reader with `python3 scripts/render-specs.py` (requires Python Markdown); this is documentation tooling, not a dashboard application build.

## Development

CI (`.github/workflows/ci.yml`) runs the typecheck, unit tests, production build with the mock-leak check, and the Playwright/axe browser checks on every push and pull request.

Requires Node 24 and pnpm 10 (exact versions pinned in `package.json` and `pnpm-lock.yaml`).

```sh
pnpm install
pnpm dev:mock          # app on proposed fixtures; add ?scenario=stale|unknown|unavailable|failed
pnpm dev               # app expecting an AQ human API on the same origin
pnpm test              # unit/component tests (Vitest)
pnpm test:e2e          # Playwright responsive + axe checks against the mock harness
pnpm typecheck
pnpm build             # static bundle in dist/, then fails if mock code or fixtures leaked
```

`contracts/proposed/` and `src/api/wire/proposed.ts` transcribe the [API proposal](docs/specs/0003-dashboard-api.md); they are not published API-02 contracts and must be replaced by generated bindings when D00/API-02 publishes them. Mock mode shows a persistent on-screen banner and is excluded from production builds.
