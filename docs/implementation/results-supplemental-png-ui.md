# Supplemental PNG Results reader

Source-only UI18 subset against frozen MediaCore `918559f`. No media HTTP routes, configured store, actual retention or live visual acceptance is established by these UI tests. Root keeps `results.media.read@1` disabled until the actual owner and paired routes are qualified.

References inspected directly: `10-results-desktop-v2.png`, `13-results-mobile-v2.png`, product design 0002 Results section and visual acceptance rules. The delivered source subset preserves the metadata feed and adds a substantial PNG preview frame, filename selector, explicit image expansion and human-upload provenance. Report identities/evidence references sit in a disclosure below the image instead of dominating it. Filename selectors are not a complete thumbnail/media strip. Clips, comparison, discussion, comments, uploader UI, capture-policy success and complete Results-page acceptance remain deferred.

## Authority bridge

API06 metadata independently pins report ID, bare SHA256 report revision, project/task/attempt, repository/base object and `recorded_legacy_native_only` coverage. It does not pin later media artifacts. The reader builds its expected `ReportBinding` only from that adapted metadata and coverage. Every authorized media listing and immutable receipt must match those fields. The listing introduces supplemental artifact/receipt/variant descriptors; it does not append images to the original worker report digest.

Closed MediaCore fields, limits, deterministic preview dimensions, availability states and canonical receipt SHA are checked. The receipt digest is an integrity fingerprint, not a signature, authorization grant or proof of capture. The authenticated exact-report owner endpoint supplies authority. The frozen public schema/example are copied under `contracts/live/result-media/`; the example is explicitly synthetic contract data, not retained PNG bytes.

The binary request path is constructed from the independently pinned report/revision and selected validated artifact/variant. No URL/path from a body is used. The client checks exact MIME, Content-Length, AQ variant digest, receipt digest, actual byte length and SHA256, then exact PNG signature/IHDR dimensions and static RGBA8 shape before returning any bytes to a Blob URL. The selected descriptor is the anchor; response headers/body cannot anchor themselves. Reads are same-origin, no-store, abortable, finite and bounded. Error streams are cancelled; cancellation is not awaited indefinitely. Generic404 remains a neutral feature error; typed missing/expired/withheld/failed responses retain their distinct meaning. 401/403 enter the existing protected-query authorization fence.

## Rendering and resource boundary

An explicit capability gates all media reads. At most two visible cards hold one selected preview each; one global modal can request a render only on explicit expansion. An IntersectionObserver releases inactive previews. Without that browser API, explicit View images uses the same bounded window. No other artifact previews are fetched just to decorate selectors. Media metadata has a maximum of eight items/report, preview bytes at most 768 KiB and render bytes at most 8 MiB, further bounded by current returned limits.

Object URLs are minted only after verification. Identity/report/revision/selector changes, offscreen window changes, close, decode error, access denial and expiry stop rendering and revoke the old URL. Query identity includes current principal/authorization/contract and full report/artifact/receipt/variant anchors. Retention uses the server snapshot plus a conservative monotonic elapsed-time ceiling; it does not use a browser clock to extend authority. No private image is kept in local storage or a persistent browser cache. These are bounded client operations, not a production throughput or browser peak-memory claim.

Images are labelled human-supplemental, uploaded after the worker report. Uploader-supplied capture assertions remain explicitly unverified, even if a claimed source matches the report. Missing/tombstoned media retains that provenance. Image presence never implies worker/model capture, source coverage, acceptance or completion.

## Validation and remaining gates

40 focused tests passed in 2.97 seconds across the bridge adapter, frozen public example, finite byte client, image lifecycle and existing Results metadata cases. Exact `pnpm exec tsc -b` including tests and diff checks passed. Tests cover self-consistent foreign report/source bindings, receipt digest mutation, closed fields/limits, wrong MIME/length/digest/header/dimensions, truncated/extra/corrupt finite streams, two-preview budget, explicit render, close/decode URL release, held old artifact/report/revision responses and scope changes. Both 401 and 403 tests retain the denial gate with bootstrap503 and verify all previously created URLs and report rendering are removed. A finite response stream tests EOF mismatch separately from a transport that could wait until the request deadline for its promised length.

Synthetic test PNGs/receipts are labelled fixture data and do not claim canonical server processing or authorized file retention. Actual SQL/filesystem/router tests belong to the backend owner. Production build, actual controlled screenshot upload/finalization, byte serving, expiry/revocation and desktop/390/320 screenshot review are separate pending gates once API36 is mounted. No production build, Cargo command or provider call was run in this source lane.

Independent lifecycle review followup: an expanded report must still belong to the current feed binding keys at render time; otherwise the modal is hidden immediately and cleared in layout. The expanded viewer now subscribes to the same validated listing query as its card, instead of relying on its earlier selection snapshot. Observed artifact removal, receipt change, missing/withheld availability or listing failure closes the modal and revokes render URLs. Same-feed removal/revision replacement and missing/withheld refresh regressions bring the focused suite to 44 passing tests in 3.72 seconds; exact TypeScript and diff checks pass. Visual fixture work remains a separate source-only step.


## Source-only visual review

Presentation source `1e218df` and reproducible harness `7f715a3` were reviewed against Results references 10/13 at 1440×1000, 390×844 and 320×740. This is an isolated Vite development renderer on port 4210 with browser-intercepted fixture APIs, synthetic report/receipt metadata and labelled code-generated PNGs. No AQ backend, configured store, actual owner authorization or file-serving endpoint participates. There is no production bundle/digest associated with these captures, and no actual HTTP, server expiry or retained-media qualification is claimed.

The delivered source presentation subset has a substantial preview frame, readable filename selectors, explicit image expansion, concise human-upload attribution and provenance disclosure. Phone labels wrap within the card, preview text identifies its resolution role, and report/source details remain secondary. Source pictures use normal card-reading scroll positions; they do not establish that an entire long card fits in the initial viewport. Full thumbnail strips, clips, comparisons, feedback/discussion and complete page acceptance remain deferred.

The fixture browser run passed with zero page errors and zero unexpected API requests. It exercised two selectors, explicit render expansion, visible Close at desktop/390/320, focus return, phone Overview exit/Back, no whole-page horizontal overflow and client-side expiry removing the image and showing the expiry placeholder. The development StrictMode renderer can abort/recreate reads; the recorded request counts are not a production network/performance measurement. Synthetic fixture encoding is not proof of the pinned server PNG processing policy. Real upload, file retention, current role/link fences and final composed-bundle browser qualification remain open with API36.

Implementation owner inspected the images directly. Durable source-only evidence: [report](evidence/result-media-source-ui/reviewed/result.json), [1440 card](evidence/result-media-source-ui/reviewed/1440-source-feed.png), [1440 expand](evidence/result-media-source-ui/reviewed/1440-source-expanded.png), [390 card](evidence/result-media-source-ui/reviewed/390-source-feed.png), [390 expand](evidence/result-media-source-ui/reviewed/390-source-expanded.png), [320 card](evidence/result-media-source-ui/reviewed/320-source-feed.png), [320 expand](evidence/result-media-source-ui/reviewed/320-source-expanded.png), and [client expiry](evidence/result-media-source-ui/reviewed/390-source-expired.png).

The [initial source observation](evidence/result-media-source-ui/initial-source-observation/) is retained separately. It exposed excessive paragraph/grid spacing and selector overflow. At 320 px the original expectation also waited for a preview that had not entered the lazy visible window; the harness now scrolls to the media area before asserting its image. The first development harness attempt intercepted `/src/api/client.ts` with an overly broad API glob, yielding a blank page; that harness-only path matcher was corrected to the exact private `/api/` prefix. Those observations are not failures of a mounted AQ media API.

Presentation checks after the changes: 22 affected component tests passed in 3.97 seconds; exact TypeScript and diff checks passed. The earlier 44-test security/adapter/lifecycle qualification remains separate. No production build or Cargo command was run.

### Actual mounted-owner browser probe

`scripts/probe-result-media.mjs` is separate from the synthetic source renderer. It
has no interception and refuses to run without an explicit disposable-upload
opt-in, an HTTP loopback origin, an expected actor, the independently retained
API06 report binding, a visible fixture label and an exact compiled manifest.
It does not change canonical configuration or provide an uploader UI.

Required environment, supplied by the integration owner after the disposable
schema36 database, private media root, upload-enabled actual owner and compiled
bundle have been staged:

- `AQ_LIVE_ALLOW_MEDIA_UPLOAD=1`
- `AQ_LIVE_URL=http://localhost:<owned-stage-port>`
- `AQ_LIVE_ACTOR_ID`: exact human Owner UUID
- `AQ_LIVE_MEDIA_BINDING`: JSON containing the independent API06 coverage,
  report/revision/project/task/attempt/repository/base binding
- `AQ_LIVE_MEDIA_FIXTURE_LABEL`: exact report conclusion containing “fixture”
- `AQ_LIVE_CANDIDATE_MANIFEST`: local compiled `dashboard-manifest.json` path
- Optional `AQ_LIVE_OUTPUT_DIR`: private screenshot/report output directory

Run `node scripts/probe-result-media.mjs` only after the owner releases that
fixture and browser slot. The probe checks bootstrap's digest against SHA256 of
the local manifest bytes; the AQ asset router need not publicly serve a manifest.
The exact UI path is `/results/{report}/revisions/{bare64digest}`.

The source capture is one real Playwright PNG of that actual labelled AQ page at
960×600 CSS pixels, DPR1. It must fit the admitted 1MiB/2MP limits. Capture claims
remain null; the retained image is human-supplemental evidence. The probe freezes
one literal admission JSON body and UUID, sends one POST/PUT/finalize sequence
with normal Origin/CSRF headers, and performs only pure lookups if processing is
still finishing. It never regenerates an intent, retries admission or silently
recovers a mutation. An ambiguous mutation outcome fails the qualification.

The positive case compares request digest with literal JSON bytes, independently
pins the report through API06, verifies canonical receipt SHA and immutable
receipt fields, checks exact served PNG headers/length/SHA/dimensions, then hashes
the Blob bytes actually accepted by the compiled client. Fresh1440/390/320 pages
exercise the retained selector, preview, explicit expansion, visible Close/focus
return, refresh, reload without another upload, and phone navigation exit/Back.
It records browser writes (must be zero), the three explicit API mutations,
external requests (must be zero), errors, screenshots and the served bundle digest.
Listing `available` is treated as observed file presence, not SHA attestation.

Source validation: `node --check scripts/probe-result-media.mjs` and
`node --test scripts/probe-result-media.test.mjs` (four fail-before-network guard
cases). Actual HTTP/browser execution and screenshot review remain open until
reported with a concrete owned fixture and bundle. Authorization, expiry and late
result negative cases remain covered by separate server/client tests; this
positive probe does not claim those scenarios or worker/source capture proof.

#### Actual positive acceptance — 2026-11-01

One authorized run against the isolated schema36 stage `http://localhost:4206`
passed in3.809s. Bundle digest was
`sha256:af51fe1636a87934ff0ef85ad03336c8e3a0b3bffc97817e6b8087bb3d58c127`;
actual server source55b1dc67 and binary SHA256
`49006758bfcf378f54a24343b6444563c55adf32cc214c0904c29ec3f58b30e8`.
Probe source was ea96ee7. No interception, canonical configuration changes,
providers or workers were involved.

The real Playwright input was960×600,83,919bytes, with closed CRC-checked
IHDR/consecutive IDAT/IEND chunks. One admission, one byte PUT and one finalize
retained artifact/operation `18db7bb4-c508-4fb4-b192-c7492c031620`.
The finalized preview was384×240/37,957bytes and render960×600/195,989bytes.
Both actual HTTP representations and the compiled client's accepted Blob bytes
matched their pinned MIME, dimensions, lengths and SHA256. Receipt and literal
admission digests matched; refresh/reload retained the same sole artifact.
There were zero browser writes, external requests or page errors.

Reviewed desktop1440×1000 and phones390×844/320×740 against references10/13:
the bounded image frame contains its image, filenames wrap, human provenance
remains readable, modal Close is visible, close returns focus to Expand, and phone
navigation exits/Back work. These captures intentionally scroll the media area
into view, so the page title may be above the viewport. The uploaded source PNG
truthfully records the labelled actual fixture while its previously empty media
list was still loading. Its original legacy report timestamp is fixture data;
neither the image nor this qualification asserts worker capture, source coverage,
acceptance or completion.

Evidence: [actual-owner report](evidence/result-media-actual-owner/result.json)
and seven PNGs beside it (six UI captures plus the single actual input capture).
This accepts the supplemental PNG read/selector/expand/close/refresh/reload
subset. Full reference10/13 composition remains open while comments, review
workflow, richer media, comparison, capture requirements and acceptance are
unimplemented. Negative authorization/expiry/late-result behavior is qualified
by separate server/client tests, not this positive browser run.

### Upload control source followup

The exact-report human upload control is designed and implemented separately in
[the upload-control delta](results-png-upload-control.md). Its source-only tests do
not extend the above actual read/expand acceptance to a browser uploader.
