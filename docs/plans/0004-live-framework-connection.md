# Live framework connection

Status: implementation in progress, 2026-10-31.

Connect the existing dashboard to the central AQ human listener. The first live
profile is `dashboard-read-1`: identity/capabilities, authorized projects, session
inspection and a partial overview. Existing `/api/status` and `/api/workers`
provide daemon and enrolled-node observations. This is an incremental API-02
implementation; graph task inspection, decisions, search, provider-account quota,
supervisor conversations and terminal interaction retain separate capability gates.

AQ owns all authorization and lifecycle decisions. The dashboard has no database,
worker credentials, graph service access or independent backend. Project/session
reads use current human authorization. Missing counts remain unknown; absent
coverage never looks like a complete empty system. Process observations do not
prove a currently live agent. Unsupported capability versions disable that view.

Development optionally proxies human API requests from Vite to an explicit
`AQ_DAEMON_URL`. The proxy preserves authentication and Origin headers; configuring
the daemon's public origin remains necessary for mutations. There is no automatic
login, synthetic owner header or worker-endpoint proxy.

Production builds contain no mock code. A generated `dashboard-manifest.json`
lists exact SHA-256 hashes and byte sizes of `index.html` and allowlisted assets.
AQ optionally loads a bounded immutable bundle at startup through
`AQ_DASHBOARD_DIR`. It serves known SPA paths on the human listener. Unknown API
routes and missing assets remain errors; they must never become HTML successes.
The worker listener does not serve the dashboard. A sibling checkout is not a
runtime dependency; an independently built bundle is the integration artifact.

Validation covers frontend capability gates, authentication loss, API version
refusal, mock exclusion, backend authorization/scoping/pagination and static
asset integrity/path separation. Final acceptance exercises the production
bundle in a browser against an actual AQ daemon and disposable PostgreSQL,
including page refresh/deep links and unavailable capabilities. That smoke test
does not qualify real harness execution, provider usage or terminal streaming.
