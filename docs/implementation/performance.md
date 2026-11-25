# Performance dashboard

Performance uses the shared compact header, scope picker, navigation, panel tokens and table treatment from the approved [Overview reference](../design/01-overview-v3.png) and [product design](../specs/0002-product-design.md). The fleet performance plan defines the page composition. The design manifest has no dedicated Performance mockup.

The fixture review covers delivery and quality, machine utilization and the ready queue, queue diagnostics, holds, model efficiency, and task routing and usage. Performance appears in the desktop rail and under More on phones when bootstrap offers `performance.metrics.v1`. The project view covers scoped outcomes, holds, and usage. The fleet view also shows machine and scheduler data. Empty, partial, stale, forbidden and outage cases have separate fixture coverage.

The canonical example bodies live in [performance/examples.json](../../contracts/live/performance/examples.json). Browser captures use the Vite mock server and its visible fixture indicator. Generate them with `pnpm test:e2e tests/performance.spec.ts --workers=1`. The tests save full-page 1440, 390 and 320 pixel images and phone viewport images in Playwright's output directory. They check document width, phone navigation and the page's WCAG rules with axe. The lane author inspected desktop and phone captures. Live data appearance and qualification on a deployed bundle remain integration checks.

Task detail distinguishes first-route intent, actual models, attempt state and first-submission adjudication. Delegation remains unknown where usage receipts lack attribution.
