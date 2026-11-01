# Shared Shell intrinsic sizing — source fixture review

Status: source `cabcf76` reviewed with labelled synthetic Vite fixtures. No
production build, served-bundle qualification or canonical change is claimed.
The temporary4213 listener and browser contexts have stopped.

References: `08-agents-focus-desktop.png`, `11-agent-mobile-v2.png` and
`12-supervisor-mobile.png`, checked against the accepted manifest hashes, plus
product design section3 and the visual acceptance checklist. This increment
corrects shared header sizing; it does not qualify the underlying Overview or
Agents content shown around the header.

The actual earlier5c/UDS capture exposed a102px desktop header: native select
intrinsics used the longest available option even while All projects was selected,
and the unavailable quota explanation occupied another flex row. Shell now bounds
the project select and search without changing their values, routes or touch
targets. On tablets search uses its existing labelled icon control; the compact
rail brand remains on one line. Desktop stays one header row and phones keep the
accepted two-row arrangement; focused Agents retains its single compact row.

The existing usage disclosure now works at every width/state. Closed ready
summaries show real adapted account labels and the server-preferred window's
reported percentage, retaining unknown/unsupported/estimated/partial/stale
qualifiers. Existing percentage formatting is reused. Window/reset/freshness and
additional window facts remain in the unchanged ProviderUsageStrip inside the
bounded overlay. Unavailable reasons move into that same accessible disclosure.
Close and Escape return focus to its summary; opening never increases header
height. No provider adapter/DTO/query or global quota policy changed, and no
aggregate quota or provider identity was invented.

One source browser check found the existing nested window popup could cover
Close in the new bounded panel. The [earlier failure capture](earlier-nested-windows-clipped.png)
is retained. A Shell-scoped list presentation puts those windows in the panel's
normal flow. The final [320px expanded view](ready-overlay-320.png) shows both
reported windows, actual reset/freshness labels and accessible44px Close; no
blanket page overflow rule masks the issue.

The final [probe](probe-source-fixtures.mjs) ran22 cases. Project labels,
bootstrap quota capability/reason and provider usage were intercepted deliberately
in source Vite, with other reads proxied to actual4188. Every capture labels that
synthetic boundary. The long name is exactly `Private UDS inert startup fixture -
external status unavailable`; ready values come from the existing proposed
provider fixture and are not actual account quota. No intercepted fact is live
infrastructure qualification. Screens with unrelated page loading states are
header evidence only. React Router's existing development HydrateFallback warning
was present; there were zero uncaught page errors or mutating requests.

Measured final geometry for both long/short labels and ready/unavailable states:

| Viewport | Header height |
| --- | --- |
|1440 desktop|69px|
|1024 tablet|69px|
|768 tablet|69px|
|390 phone|114px|
|320 phone|114px|
|390/320 focused Agents|62px|

The probe verifies44px scope/search/summary targets, bounded overlay and no page
horizontal overflow, Close/Escape focus restoration, mobile All sessions exit and
hidden bottom navigation in focused reading. Ready multiple-window disclosure
remains reachable. [Measurements](result.json) and [qualification/hashes](qualification.json)
retain the exact source subset and fixture limits.

56 existing/focused Shell, ProviderUsageStrip and Search tests passed in4.97s,
including preferred-window selection, estimated/partial/stale/unknown summaries,
full window/freshness disclosure and focus restoration. Exact `pnpm exec tsc -b`
passed. No broader production build was run in this lane.

Reviewed captures: [unavailable desktop](unavailable-1440.png),
[long reason phone](unavailable-overlay-320.png), [ready desktop](ready-1440.png),
[1024](ready-1024.png), [768](ready-768.png), [320](ready-320.png),
[expanded windows320](ready-overlay-320.png), [focused ready320](focused-ready-320.png),
[focused unavailable390](focused-unavailable-390.png), and
[short-label ready390](short-ready-390.png).

Deferred: root's next composed production build and actual same-origin acceptance,
including integration with Playbooks Catalog and Results upload. Existing mockup
provider bars/reset detail are now on demand rather than all inline; the compact
header preserves reported account amounts while keeping that full detail
accessible. Whole-page visual acceptance remains separate.
