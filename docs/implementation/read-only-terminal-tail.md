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
