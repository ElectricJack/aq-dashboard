# Current-account notification inspection (UI-12 increment)

The Settings panel uses the existing authenticated human notification owner:
`GET /api/notifications?after=0&limit=16` and selected
`GET /api/notifications/{message_id}`. Bootstrap `notifications.read` version 1
controls the UI. No recipient selector or recipient query is supplied; every
returned message must bind to the current principal. Current recipient
authorization remains authoritative: Owner and Viewer can inspect their own
messages, while a privileged recipient override remains Owner-only.

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
Back focus and zero mutations. The earlier accepted increment's [positive actual owner/browser gate](../evidence/notification-inspection/result.json)
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

The paired actual mounted-router/SQL fixture at agent-q `1cab587` passed in
0.80s. It installed the real service, enqueued labelled Owner and Viewer messages
through the owner, proved self-only inbox/detail reads and foreign-recipient
refusal, and distinguished mounted from standalone capability availability.
It retained zero external routes, destinations and deliveries. Strict affected
library/test all-feature lint passed in 29.76s. This is positive owner/API
qualification; the compiled-browser desktop/phone gate remains separate and
does not follow from the empty external delivery set.

The immutable release bundle was then qualified separately with the same pinned
owner fixture and positive-only probe. The [release result](../evidence/notification-inspection/release-result.json)
passed: browser 875ms and complete actual owner/browser case 2.30 seconds. Served
bootstrap digest matched the release manifest exactly:
`3e12f222077d22b2dba05b035c0cda3c49c0fed827c37f9e7fa041d7dc38f953`.
The exact current-recipient persisted message had `no_external_route` and zero
deliveries; browser mutations and external requests were zero. This final smoke
used the existing compiled bundle without a new build or implementation change.

Both release screenshots were inspected at 1440px desktop and 390px phone:
`/tmp/aq-notification-positive-browser-release/notifications-desktop.png` and
`/tmp/aq-notification-positive-browser-release/notifications-mobile.png`.
The desktop retains its selected inbox row and distinct detail pane; the phone
retains a readable single detail, reachable Back action, and identity disclosure
without horizontal overflow. This retains the same bounded shared-panel visual
acceptance and deferred full Settings/workflow limits described above.
[Release artifact pins](../evidence/notification-inspection/release-artifacts.json)
and the [release process log](../evidence/notification-inspection/release-process.log)
preserve source paths and exact identities. The earlier accepted `383…` increment
and initial failed `47…` candidate evidence are retained.
