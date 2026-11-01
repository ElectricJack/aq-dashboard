# Combined frontend qualification and canonical asset promotion

November 1, 2026. This record binds one immutable frontend to its full source
checks, separate configured feature fixtures, old-backend compatibility and
actual canonical read-only acceptance. It does not close complete page designs,
the central runtime, media/catalog deployment or the v2 parent milestones.

## Exact frontend and checks

Production source is dashboard `f2dbe5e7fc9d2647971aab0c1350df52c54bd0a3`.
The immutable directory is
`/tmp/aq-dashboard-actions-promotion/dist-composed-f2dbe5e`; its manifest SHA256 is
`624707540cc6566158c3721e4733f69934c8a1670c4ffb972afb7d469fb8e663`.
It combines the existing Results PNG uploader/media, Agents source events,
compact Shell and current Playbooks catalog. All six integration imports were
conflict-free. Later probe/evidence/documentation imports do not change that
production source, directory or digest; no second build was run for them.

One complete `pnpm test` passed **633 tests in 65 files**, 26.48 seconds runner
time / 27.084 seconds wall time. The exact `pnpm build` pipeline (`tsc -b`, Vite,
bundle checks and manifest) passed in **2.448 seconds**, with Vite itself reporting
1.23 seconds. Its 29 manifest files contain index.html plus 28 assets, with no
mock code or fixtures. Every copied file was verified against the manifest;
the immutable copy is read-only. Retained [build provenance](evidence/composed-frontend-6247/build-qualification.json),
[test log](evidence/composed-frontend-6247/frontend-tests.log),
[build log](evidence/composed-frontend-6247/frontend-build.log) and
[manifest](evidence/composed-frontend-6247/dashboard-manifest.json) establish those
counts and distinguish pipeline time from Vite time.

## Independently configured feature acceptance

| Slice | Exact compiled-browser proof | Boundary retained |
| --- | --- | --- |
| Results supplemental PNG | [Actual uploader/gallery](results-png-upload-control.md): one separately authorized DOM file selection/submit on isolated 4206, 5360ms, one admission/PUT/finalize sequence with201/200/200 responses. Both artifacts, original receipt, literal input/request/receipt/blob digests, reload and 1440/390/320 picker/preview/expanded captures passed. | Actual SQL/private-file owner and supplemental human PNG only. No canonical media configuration, worker capture, capture acceptance, review/comments or physical OS picker qualification. The native input's cleared “No file chosen” label versus separate Selected row remains a cosmetic followup; no cosmetic rebuild was made. |
| Current Playbooks catalog | [Actual current Definitions/Activations](../evidence/current-catalog-browser/README.md): original 2294ms browser /3.81s complete, two actual retained artifacts and one activation at revision 2; 13 catalog reads, no historical fallback/unrelated engine reads/writes/foreign requests/errors. Phone roster supplement 3111ms/4.65s; all 1440/390/320 detail/roster/lower-panel captures reviewed, including valid 128-byte names/entries/aliases. | Actual disposable component 0.1.3 owner/HTTP and synthetic local UDS forwarding at source schema 36. This is distinct from actual private PostgreSQL UDS deployment, merged schema 37 and canonical optional-owner configuration. No workflow/provider effects or project eligibility claim. |

Both feature owners verified this same immutable 6247 bundle. The media fixture's
three mutation requests were separately authorized as one operation; the
compatibility/canonical gates below perform **no** mutation. Catalog fixture
setup installs real component metadata but its browser makes reads only. These
different configurations must not be combined into a claim that the current
canonical daemon exposes either feature.

## Existing state35 compatibility before promotion

The root-authorized staging process 781324 was verified by exact argv, UID,
executable hash and start identity before SIGTERM. Its replacement 870238 preserves
the complete `/proc` environment except `AQ_DASHBOARD_DIR`, with unchanged binary,
vault, configuration SHA and database state35. The only asset change was 5c→6247.
[Restart identity](evidence/composed-frontend-6247/stage-restart.json) and actual
[readiness](evidence/composed-frontend-6247/stage-readyz.json) record the boundary.

Existing actual probes passed on 4204 without interception: Overview 728ms,
Work/Knowledge/Graph 3236ms (16 human reads), exact-session Source events 1271ms
(zero reports/two explicit GETs), Supervisor 1623ms (empty history/zero enqueue),
and Shell 1443ms. These were bounded real API/source and layout regressions, not
full-page acceptance or proof of live Supervisor replies/terminal output.
[Old-backend results and hashes](composed-frontend-6247-qualification.json) retain
each route fixture, result and original private output path.

## Actual canonical promotion and one read-only regression pass

Root promoted 6247 assets at `http://localhost:4188` using the **same** retained
binary SHA256
`8ad0aad8a1cb156660decdebc0fbbef8e4ea04a0e7c80a84c8921bb0681153ad`,
vault/configuration and state35 database. Root's configuration SHA remains
`de60d617b02dbf7b2eac4c25c425239a5f85479a8d1d113f93996b559864d45e`.
The [promotion restart record](evidence/composed-frontend-6247/canonical/restart.json)
and [independently compared bootstrap fields](evidence/composed-frontend-6247/canonical/bootstrap-comparison.json)
show unchanged principal, capabilities, contracts, limits, default scope and
global Supervisor identity. No canonical message body was retained.

One subsequent read-only browser pass verified the served 6247 digest:

| Probe | Browser duration | Actual subset |
| --- | --- | --- |
|Overview|660ms|Bounded recorded tasks, project scope and real Work link|
|Work/Knowledge/Graph|3384ms|16 human reads; list/detail/graph/search, current and exact document revision, phone reading/exits|
|Source events|1296ms|Existing exact session/attempt; zero retained reports, Load+Refresh only, no Watch/control|
|Supervisor|1713ms|Actual empty human history, scope/draft preservation and phone composer; zero enqueue, unavailable runtime|
|Shared Shell|1473ms|Actual header geometry, usage-reason overlay, Close/Escape focus restoration and focused phone reading|

All passed without interception or mutating API calls. Shell and Source events
also explicitly tracked and refused foreign requests.
[Canonical results](composed-frontend-6247-qualification.json) retain exact
machine-readable evidence. Canonical media/catalog/Decisions remain unavailable;
provider quota remains unavailable. A terminal Watch capability does not imply
retained bytes, control or a running harness; this gate never invokes it.

## Visual disposition and remaining limits

References are the accepted shared shell in 08/11/12, Overview 01, Work 02,
Knowledge 07, Supervisor 04/09/12, Playbooks 06 and Results 10/13. Actual compiled
Shell images were inspected at 1440/1024/390/320: desktop/tablet is 69px, phone 114px
and focused Agents 62px, with readable scope/search/status and an unobstructed
All sessions exit. The bounded reason overlay does not expand the header; Close
and Escape restore focus. Actual Knowledge phone reading and Supervisor 320 Send
above navigation were also inspected. Ready account amounts/long fixture names
remain separately labelled [source-fixture coverage](../evidence/shared-shell-intrinsics-v2/README.md),
not actual quota production. Full window/reset/freshness facts stay available on
demand. These checks preserve delivered composition without inventing activity.

Canonical captures: [desktop](evidence/composed-frontend-6247/canonical/header-1440.png),
[390](evidence/composed-frontend-6247/canonical/header-390.png),
[320](evidence/composed-frontend-6247/canonical/header-320.png),
[focused320](evidence/composed-frontend-6247/canonical/focused-320.png), and
[Supervisor320](evidence/composed-frontend-6247/canonical/supervisor-320.png).

The [availability matrix](../plans/0003-live-dashboard-delivery.md#delivered-increments-and-remaining-gates-at-canonical-state35)
keeps media and current catalog isolated qualification distinct from canonical
availability. Full designs/actions, capture requirements, comments/review,
central dispatch/replies, current session producers, terminal control and actual
account quota remain separate gates. The old 5c Events35 record remains historical.

Rollback for this promotion changes **only** the assets directory back to
`/tmp/aq-dashboard-actions-promotion/dist-events-media`, manifest
`5c0fcfa4fe11cd95a9081edeb7323ef07f9d2c66bcf24b2add1ef546200ac667`,
on the same 8ad binary/configuration/state35 database. No restore or schema
rollback is needed. Root owns any future restart/promotion/rollback; none was
performed by these read-only browser gates.
