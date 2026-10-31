# dashboard-read-1

This initial read profile connects the dashboard to AQ's authenticated human
listener. The broader types in `src/api/wire/proposed.ts` are not all implemented.
The live subset reuses Envelope, Bootstrap, Page<ProjectRef>, Overview,
SessionSummary and SessionDetail shapes. Revisions remain decimal strings and
absent measurements remain null/unknown. `product.dashboard_digest` is nullable
when AQ is not serving a bundle; it must not be replaced by a fabricated hash.

| Route | Capability | Coverage |
| --- | --- | --- |
| `/api/v1/bootstrap` | authenticated human | Current identity and individual capabilities |
| `/api/v1/projects` | `projects.read` | Authorized bounded project projection |
| `/api/v1/overview` | `dashboard.overview` | Partial lifecycle overview; unimplemented task counts unknown |
| `/api/v1/sessions` | `sessions.read` | Bounded authorized session snapshot |
| `/api/v1/sessions/{id}` | `sessions.read` | Current authorization rechecked for exact session |
| `/api/status` | `status.read` | Existing foundation response, without new envelope |
| `/api/workers` | `workers.read` | Existing foundation node/heartbeat response |

All new routes use `api_version: "dashboard-read-1"`. Capability versions are
`"1"`; unknown versions disable the affected UI. Mock/test builds alone accept
`proposed-0`. Capability discovery is a presentation hint and never substitutes
for authorization on each request. Unsupported pages do not issue domain reads.

Sessions contain observations, not proof that a process is live now. Overview
coverage remains partial while graph task/review/outcome projections are absent.
Task identifiers may be shown as identifiers when an authorized title owner is
not connected. No daemon storage rows, credential references or machine secrets
are exposed to the browser.

The daemon's `protocol/dashboard-read/v1/` artifacts and route tests own the
published subset. This profile does not complete API-02 or any terminal, mutation,
provider-quota or supervisor contract.

The checked-in schema and five nonempty response fixtures are pinned by
[source.json](source.json). Adapter tests consume those actual router responses.
They were produced from explicitly synthetic authority records in disposable
PostgreSQL, and are excluded from the production JavaScript bundle.

Every envelope must match the negotiated API version and requested scope before
adaptation/cache insertion. Resource 401/403 and contract errors immediately close
protected views, cancel pending reads and evict protected query caches. Recovery
requires explicit retry or reload; background bootstrap success cannot reopen a
denied resource. Ordinary transport failures may retain labelled stale observations.
Malformed capability values and malformed refreshed bootstrap data fail closed.
