# Proposed contract fixtures

**Status: PROPOSED. Not published by API-02. Not evidence of a live AQ route.**

These fixtures transcribe the shapes in [docs/specs/0003-dashboard-api.md](../../docs/specs/0003-dashboard-api.md) §2–3 so the frontend can be built and tested before D00/API-02 publishes schemas. All values are illustrative sample data.

| File | Proposed route | Spec section |
| --- | --- | --- |
| `bootstrap.json` | `GET /api/v1/bootstrap` | §3 |
| `provider-usage.json` | `GET /api/v1/provider-usage` | §3 |

When API-02 publishes its OpenAPI/JSON Schema, generated bindings and canonical fixtures, replace this directory with the pinned published contracts (plus a provenance lock) and delete `src/api/wire/proposed.ts`. Scenario variants (stale, unknown, unavailable, failed) are derived in `src/mocks/scenarios.ts`.
