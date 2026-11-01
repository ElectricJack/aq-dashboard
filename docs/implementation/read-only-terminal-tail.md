# Read-only resident output tail

The session detail offers Watch output only when the dashboard bootstrap advertises
`terminal.watch` version 1 and the authorized session detail names an actual
registered terminal. The UI inspects that exact terminal, then creates one Watch
subscription with an explicit user action. No control, input, resize, capture, or
snapshot request is issued.

The Watch requests 15 seconds from the inspect response's
`aq-terminal-server-time-ms` anchor. Its browser deadline subtracts all elapsed
monotonic time since sending inspect. Responses cannot extend that ceiling. There
is no automatic Watch renewal or mutation retry. Another click creates a fresh
operation. Stop, expiry, auth/scope/contract failure, terminal 404, and identity or
authorization revision changes clear browser output. Requests are same-origin,
no-store, redirect-refusing and bounded by five-second timeouts.

`GET /api/v1/terminals/{id}/tail` is a daemon-local read projection, not a new worker
protocol. It accepts the existing subscription ID and output cursor. The adapter
checks exact terminal/session/epoch/subscription bindings, safe integer counters,
frame SHA-256, ordering, 64 frames and 64 KiB decoded bytes per response. Wire JSON
is bounded to 512 KiB. The browser retains at most 64 KiB of raw output; gaps or
sequence discontinuities discard preceding text. Polls are paced at 250 ms with
backlog, otherwise one second.

React renders text, escaping markup. The literal adapter exposes ANSI/control and
bidirectional formatting characters as printable Unicode escapes. It does not
interpret cursor positioning, alternate screens, color, or terminal screen state.
UTF-8 replacement characters may occur at incomplete coverage boundaries. Initial
coverage is always incomplete. Disconnected, gap, trimmed, and not-retained states
are visible. Resident bytes are volatile and cannot be reconstructed from the
stopped-session database after daemon restart.

Unit/component fixtures exercise output without asserting an actual live daemon
publication. A positive live browser result requires an actual registered worker
to publish output to the same running daemon. Existing lifecycle history alone is
not output evidence.

## Focused workspace increment (UI-17)

The selected session now uses a compact, scoped session switcher and a large
read-only output area. Its footer distinguishes last reported process observation
from central execution state. Profile revisions, permissions and historical
lifecycle evidence remain available through the explicit Session details button.
The switcher reuses the bounded session read and presents at most 100 loaded
sessions, with explicit paging and no fabricated total. Unsupported task views
are rendered as task text rather than links into a disabled Work page.

On phones the output uses a minimum 14px monospace size, and focused-session mode
hides the bottom navigation while retaining All sessions navigation. Controls do
not claim input, split-pane rendering, snapshots or controller eligibility.
Existing Watch creation, limits, clearing and expiry behavior is preserved.

Twenty focused Agents/tail component tests and TypeScript checks pass. The first
full-suite invocation found a stale focus expectation after clicking the newly
added disclosure; the test now checks navigation focus before that explicit click.
The production candidate builds successfully (22 assets, no mock code). A
read-only browser check against that compiled bundle proxied to the actual AQ
human listener passes in 805 ms (1.4 seconds including browser setup), with zero
mutations or page errors. Reviewed 1440px desktop and 390px phone screenshots
show the declared focused-output subset, details disclosure and mobile navigation
behavior. The first attempt received a proxy 502 because the daemon was stopped;
it passed after the integration owner restored the actual listener. This check
does not create a Watch or claim new live-output publication. Same-origin served
preview integration remains with the root owner. The full terminal/control and
whole-dashboard visual tasks remain open.
