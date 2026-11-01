# Actual retained-result browser qualification

The actual assembled daemon and production dashboard bundle at `http://localhost:4198` passed `scripts/probe-result-metadata.mjs` in **873 ms**. No requests were intercepted and no domain writes occurred. The public bootstrap identifies the served bundle manifest digest in [result.json](result.json).

The probe read the exact retained result owner API, displayed the original and correction in the feed, followed the exact digest deep link, refreshed the detail route, and checked the 390px phone layout without horizontal overflow. No browser errors or mutations were observed. Desktop feed/detail and phone screenshots were visually reviewed: card hierarchy, worker claim, correction state, source base and evidence references are readable. This qualifies the declared metadata subset; media, comments and feedback are later increments.

Actual records came from the disposable PostgreSQL fixture created through the legacy native result owner. The synthetic-host setup and its fixed test clock explain the fixture's January 1970 recording times. There was no provider run, media ingestion, accepted result, settlement or publication claim. The exact result/revision and `recorded_legacy_native_only` coverage are retained in the JSON report.

Screenshots: `/tmp/aq-results-browser-live/results-desktop.png`, `result-detail-desktop.png`, `result-detail-mobile.png`, and `result-mobile-viewport.png`. The full-page phone capture includes the fixed navigation at its viewport boundary; the viewport-only capture shows the actual phone composition. Raw probe log: `/tmp/aq-results-browser-live.log`.

The staging bundle exposes task links according to negotiated `tasks.read`. Final product integration must gate that capability on configured Graph support; the Results component displays a plain task ID when task reads are unavailable. This probe does not claim Graph navigation qualification.
