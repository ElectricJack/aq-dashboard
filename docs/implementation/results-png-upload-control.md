# Human supplemental PNG upload control

Status: bounded UI18 design and implementation delta, November1,2026. The existing
six API11 routes are qualified. This document designs a human upload control;
source implementation and actual browser acceptance are separate gates.

References re-inspected: `10-results-desktop-v2.png`, `13-results-mobile-v2.png`,
product design0002 Results, existing supplemental PNG read/expand acceptance.

## Delivered visual boundary

Add a small “Add image” action on an exact report/revision detail card when
`results.media.upload@1` is enabled. The feed, image frame/selector, provenance,
expansion, shared shell and capability-disabled metadata remain unchanged. A
compact native dialog contains a labelled PNG picker, stage/status and explicit
recovery actions, with visible Close on phones. It adds human-supplemental PNGs;
it never asserts worker capture, source coverage, acceptance or completion.
Comments, clips, capture assertions and new APIs are outside this increment.

## Immutable intent and authority

Independent API06 metadata pins coverage/report/revision/project/task/attempt/
repository/base. Current principal and operation UUID additionally pin every
UploadStatus. A chosen file is bounded to1MiB before reading and held only in
feature memory; validate static8-bit RGB/RGBA PNG dimensions, CRC and closed
IHDR/sRGB/consecutive IDAT/IEND structure before freezing its bytes/SHA. The
server still performs authoritative full decoding, quotas and PNG processing.

Freeze one operation UUID, original filename, byte length/SHA and literal ordered
admission JSON with `capture:null`. Save `?media_upload=<operationUUID>` on the
exact report URL before the first POST. No automatic mutation retry, regenerated
UUID, changed body or replacement file is allowed for that intent. Double clicks
are synchronously guarded, including file preparation and digest computation.
Each mutation uses normal Owner/CSRF authorization and finite bounded responses.

Initial explicit submission may sequence admission→PUT→finalize while each
preceding response has an exact validated state and permitted recovery flag.
Any transport/error/response-loss ambiguity stops the sequence. GET lookup is
pure; a404 means unresolved, not safe absence. “Check upload status” never writes.
Explicit retry of admission requires the exact original frozen raw bytes.
Explicit PUT/finalize recovery follows only validated current state/permissions;
finalize always sends the same empty object. No background reconciliation loop.

Successful retained receipt is independently checked against the pinned intent
and triggers the existing gallery's query refresh. Retained/rejected/expired are
terminal; a new intent is offered only after explicitly finishing that terminal
reference. Closing the dialog keeps the pending reference/action and bytes while
this exact feature instance remains mounted. There is no cancel/delete API.

## Reload, scope and private data

Reload/reopen with an operation reference performs GET only. A known authorized
status supplies its immutable original file length/SHA/name and request digest.
Resume requiring bytes asks the user to reselect the original file; validate
length/SHA before retaining it. Reconstruction of this UI's fixed admission JSON
must match the retained raw-request digest before exact POST replay is offered.
A status from another compatible client can remain inspectable while replay is
unavailable. Reload404 cannot reconstruct a lost admission body, so only lookup
is offered; it must never silently create a replacement intent.

No PNG, filename/body, status or second message store is persisted in localStorage
or IndexedDB. The URL contains only the operation UUID; browser history retains
the exact report reference. Route/report/revision/project scope, principal or
authorization revision changes immediately hide stale upload state, clear file
memory and abort/fence late responses. Closing does not abandon a pending intent;
the recovery reference remains. Upload capability loss removes write controls.
401/403 reach the existing protected-query denial latch even if bootstrap then
returns503, removing private upload/gallery state. No global SessionProvider
change is required.

## Implementation and acceptance plan

1. Strict closed UploadStatus adapter and bounded JSON mutation client; immutable
   prepare/reselect helpers. Reuse existing media binding/receipt validators.
2. Exact-detail capability-gated dialog and operation-reference recovery with
   one in-memory file, explicit stage controls, native Close/focus return, and
   gallery invalidation after retained state.
3. Focused meaningful tests: Unicode/name/PNG/byte limits; exact status binding
   and request/receipt equality; held preparation/late route responses; duplicate
   clicks; ambiguous POST404 lookup; reload/reselect samefile vs mismatchedfile;
   same-role401/403 with bootstrap503; retained refresh without reupload.
4. Complete TypeScript check including tests. Production build, actual new upload
   and1440/390/320 screenshot review require a separately authorized disposable
   fixture and root-released browser/build slot. Do not reuse the previous one-
   upload acceptance as proof of this new control.

No uploader UI, new upload or canonical configuration has been delivered by this
design-only revision. Existing read/selector/expand acceptance remains valid.
