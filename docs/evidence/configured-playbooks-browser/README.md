# Actual configured Playbooks browser

Passed: one real protected-engine/daemon/compiled-dashboard composition in **4.08s**, including **1.237s** in Chromium. The bundle manifest SHA256 was `85fa3dbfb790467dcaca3be6ce6ee7f448d9b2b39603f066df3b3811afbde2a8`; it was loaded from the existing compiled fidelity-union bundle without rebuilding UI source.

The ignored opt-in backend test creates a **Development Playbooks browser fixture** namespace using the existing real protected PostgreSQL engine/runtime setup. A sealed development parent calls an installed child with a blocking Call. Normal typed Service/Driver APIs install, activate and admit the parent. Both workflows reach their actual completed/ok state; four parent receipts and the exact parent/child artifact identities are verified before browser startup. No run/receipt rows or browser API responses are fabricated.

The browser verifies negotiated namespace-owner capability, real run discovery, roster → exact pin/timeline, child → parent navigation, deep-link reload, and admission discovery. Its six inspection reads are actual HTTP requests. There are zero browser mutations, page errors, request interceptions or provider calls. At 390px, selected detail hides the roster, All runs returns to discovery, and the page has no horizontal overflow.

- [Desktop capture](desktop.png)
- [Phone capture](mobile.png)
- [Structured result and exact identities](result.json)
- [Actual process log](process.log)
- [Affected library/test strict lint](clippy.log)

Visual review against `docs/design/06-playbooks.png`: the roster/detail columns, tab hierarchy, pinned summary, horizontal receipt timeline, and waiting/child panels are present. Phone composition becomes a stacked single-detail view. The history is a receipt timeline, not an invented complete step graph; entry labels are the actual runtime entry names. Definitions/activation discovery and editor/actions remain deferred, so this qualifies the first read-only inspection increment rather than full UI-08. The fixed original fixture clock is retained; its 1970 timestamps must not be presented as current product data.

Backend fixture source: agent-q `573b673` + `179269e`, using the existing combined builder helper `8d33242` on base `af79c41`. Probe source: `2d55f03` + `54e516b`. Strict affected lib/test all-feature Clippy passed in 1.34s. Initial attempts found an invalid fixture Call without required on_error (fixed with explicit error return and pre-install artifact verification) and an ambiguous child pin selector matching a hidden dependency pin (fixed to bind the Pinned execution field). Their logs remain `/tmp/playbooks-browser-{actual,parent-check,actual-final}.log`; neither required a production behavior change.

Reproduce with explicit `AQ_TEST_PLAYBOOK_BROWSER_SCRIPT`, `AQ_TEST_PLAYBOOK_DASHBOARD_DIR`, `AQ_LIVE_OUTPUT_DIR` and the disposable `DATABASE_URL`, then run the ignored `browser::actual_protected_run_and_child_reach_compiled_playbooks_page` test. The test owns an isolated configured runtime, serves the compiled assets with its actual injected Driver, and shuts down afterward. The local preview was not modified by this qualification.
