# D03 — static app scaffold, shell and mock harness

Status: in progress, 2026-10-31. Executes work package D03 of the [implementation plan](0001-dashboard-implementation.md) against the [product design](../specs/0002-product-design.md) (binding authority) and the [API proposal](../specs/0003-dashboard-api.md). D00 has not published schemas, so every wire type and fixture here is **proposed**, labelled as such, and replaceable by generated API-02 bindings. Nothing here claims a live route.

## Global constraints

- React + strict TypeScript + Vite static bundle; React Router; TanStack Query; CSS custom properties/modules; Vitest + Testing Library; MSW; Playwright + axe. One package manager (pnpm), committed lockfile, exact versions.
- Browser talks only to AQ's human API (`/api/...`). Non-GET requests send `X-AQ-Request: 1`.
- Unknown is never zero. Stale keeps its timestamp. Used percent is never derived from remaining or token totals. No combined percentage across windows.
- Revisions are strings; never pass through `Number`.
- Mocks never ship in a production build and are never enabled by a live build.
- Unsupported capabilities render an explanatory landing state, not a network fallback.

## Tasks

1. **Toolchain.** `package.json` with exact pins, `tsconfig` strict, Vite/Vitest config, `typecheck`, `test`, `build` scripts; smoke test renders `<App/>`. Expected: build emits hashed assets in `dist/`.
2. **Design tokens.** `src/components/tokens.css` with the spec table values (canvas/panel/raised, text, accent/focus, border, attention/error/success, spacing, radius, type, rail 224px, gutters, reduced motion). Test asserts each spec value is present.
3. **Proposed contracts and adapters.** `contracts/proposed/` fixtures (bootstrap, provider-usage) with a provenance README; `src/api/wire/proposed.ts` types; `src/api/adapters/providerUsage.ts` → view model. Tests: null percent → unknown; stale beyond `fresh_until`; multiple windows each kept; preferred window from server; unknown state enum → unsupported; out-of-range percent rejected as unknown.
4. **HTTP client and query keys.** `src/api/client.ts`: same-origin fetch, `X-AQ-Request` on non-GET, error-envelope parsing, typed `ApiError` (transport failure distinct from server refusal). `src/api/queryKeys.ts` includes principal, authorization revision, scope and contract version. Tests via MSW node server.
5. **Provider usage strip.** `ProviderUsageStrip` + `FreshnessLabel`: provider/account label, percent used, window name, reset, freshness; "Usage unavailable" for unknown; stale label; "Account-wide" labelling; loading and failed states never show 0%.
6. **Shell and routes.** Rail in spec order with Settings/identity at bottom; top area with scope picker (URL state), quota strip, search affordance, connection status; all spec routes lazy loaded; phone bottom nav (Overview, Results, Supervisor, Agents, More) with More sheet; capability-gated "Not available yet" landing for routes whose capability is not enabled; neutral unknown-route view.
7. **Mock harness.** MSW browser worker started only in dev/mock mode; scenario selection via `?scenario=` (`default`, `stale`, `unknown`, `unavailable`, `failed`); a visible "Mock data — proposed contracts" banner. Test: production build output contains no MSW code or fixture strings.
8. **Browser checks.** Playwright at 320, 390, 768, 1440 widths: no page-level horizontal scroll, navigation reachable, quota strip visible, axe finds no violations on Overview shell.
9. **Evidence record.** README "Development" section and `docs/evidence/d03.md` listing exact tool versions, commands and results.
