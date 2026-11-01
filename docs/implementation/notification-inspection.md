# Current-account notification inspection (UI-12 increment)

The Settings panel uses the existing authenticated human notification owner:
`GET /api/notifications?after=0&limit=16` and selected
`GET /api/notifications/{message_id}`. Bootstrap `notifications.read` version 1
controls the UI. No recipient selector or recipient query is supplied; every
returned message must bind to the current principal. Existing backend recipient
and Owner authorization remains authoritative.

The inbox has four explicit pages at most (64 loaded messages), oldest first.
The cursor must match the last safe sequence and pages cannot overlap or reorder.
Reply size/item/summary bounds, safe integer identities, exact message revision,
recipient, project and workspace associations are checked. A selected detail must
match the complete message read from the inbox. Authentication/contract failures
use the existing protected-cache fence; failed detail reads do not retain their
previous body. Query keys include current principal/auth revision/API context.

The inbox's routed state means only that an external route was configured.
Queued, dispatching, transport accepted, delivery unknown, retry scheduled,
permanently failed and suppressed states come from actual detail records.
Transport acceptance, human acknowledgment and a human decision are separate.
Attempt and duplicate-risk retry counts are inspected without offering retry.
Unknown future delivery states remain unsupported. No send, route-edit, retry,
external transport call or human-decision action is added by this increment.

Settings has no separate selected PNG. This subset follows the shared panel,
list/detail, control and phone disclosure design described by product specification
0002 and `docs/design/visual-acceptance.md`. The phone opens one delivery detail
with an explicit Back to inbox action and restores focus. Message identities and
expiry live in a disclosure. Summaries render as literal text with no automatic
URL, Markdown, mentions or media behavior.

Twenty adapter/component tests and TypeScript checks pass. Dedicated actual-API
browser coverage is in `tests/live/notifications.spec.ts`: disabled/empty cases
are labelled as such, while a positive record verifies current recipient, exact
message/detail, recorded delivery identities/status, desktop/phone layout,
Back focus and zero mutations. The [positive actual owner/browser gate](../evidence/notification-inspection/result.json)
passed: browser 799ms, complete PostgreSQL/owner/browser case 1.96 seconds. The
served bootstrap digest exactly matched compiled manifest
`38312b6e8abd850839a1db4d2589de89228c28d16254cc39ceff59ac5d123f96`.
The actual fixture persisted owner and Viewer messages through the notification
owner and verified current-recipient reads; no external route, destination or
delivery existed. The positive-only standalone probe inspected the exact Owner
message in desktop and phone UI, Back focus, and zero mutations/external requests.
The initial candidate exposed mobile overflow from the shared ScopePicker;
the final composition passed the unchanged check after its width correction.

Reviewed screenshots are retained under
`/tmp/aq-notification-positive-browser-final/notifications-{desktop,mobile}.png`.
Desktop uses a selected row and distinct delivery pane; phone shows one readable
detail with an explicit Back action. Identifiers remain disclosed on demand.
Settings has no dedicated PNG, so this claims the shared notification-panel
subset only; other Settings sections and future escalation workflows are not
included. [Artifact pins and limits](../evidence/notification-inspection/artifacts.json)
and the [process log](../evidence/notification-inspection/process.log) retain the
exact gate.
This does not complete full UI-04 escalation/digest or human decision workflows.
