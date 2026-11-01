# Exact-session source events: bounded browser qualification

References: 08 focused desktop / 11 focused phone, product 0002 and visual acceptance.
Delivered source subset: explicit source-report load/paging/provenance inside
existing Agent Details. Output, session switcher and primary phone exit remain
intact. Full transcript retrieval, renderer/control, current producer coverage and
full Agent operational workflows remain deferred.

The [actual empty report](empty-result.json) passed in 1454ms against protected
staging `http://localhost:4204`, actual cloned state35 and immutable compiled bundle
`5c0fcfa4fe11cd95a9081edeb7323ef07f9d2c66bcf24b2add1ef546200ac667`.
Bootstrap served identity matched the manifest; `session.events.read@1` was enabled.
The actual independently inspected profiled session had an empty retained snapshot
through node sequence 0. No event request occurred before explicit Load, including
while Details was open. Load and fresh snapshot Refresh made exactly two event
GETs. Scope/binding, 1440/390/320 reflow, phone exit and hidden focused bottom nav
passed, with zero mutations/foreign requests/page errors. No Watch was invoked.

The implementation owner inspected all four screenshots under
`/tmp/aq-session-events-empty-browser/`: closed desktop preserves the large output;
desktop/390/320 Details captures show a clear retained-snapshot empty state and
readable wrapping. Empty source reports are not a complete transcript, zero work,
healthy process or proof of producer operation. This empty pass does not stand in
for the separately required nonempty actual-ingest gate. Canonical 4188 was unchanged.

[Artifact pins](empty-artifacts.json) retain the exact manifest/binary/probe and
screenshot hashes/source paths; [process log](empty-process.log) retains the actual
probe result. The separate nonempty qualification follows below; the earlier empty-case evidence
remains unchanged.

## Nonempty registered-source/ingest proof

The [positive report](nonempty-result.json) passed in 1885ms against the same exact
compiled 5c bundle and a disposable protected owner listener. The actual source
was registered and three synthetic usage observations were admitted through the
domain ingest path before inspection; browser responses and observation rows
were not fabricated. The existing owner test
`inspection_uses_exact_acl_and_stable_bounded_snapshot_pages` ran the optional
browser hook before its later ACL-revocation checks and passed in 3.05s (one test,
ten filtered). Parent compile time was 42.24s. These parent timings came from
root's captured tool output; no raw parent log was persisted, so none is claimed
or reconstructed as a log artifact.

The browser independently anchored the actual session/attempt, checked three
exact event IDs/body digests/source IDs in the UI and exercised a fresh snapshot.
It made two event GETs (Load and Refresh), no per-row/content reads, mutations,
foreign requests or page errors. Desktop 1440 and phone 390/320 captured the loaded
reports; both phone widths also captured the first provenance disclosure. All six
actual images were inspected: focused output remains the default closed-details
composition; report rows are readable, source metadata/digests wrap locally, and
existing phone exits remain reachable without horizontal overflow. The selected
fixture has no terminal; its unavailable terminal and central Grant issued state
remain explicit rather than becoming a running-process claim.

The three displayed contribution markers are historical audit records. Their
fixed 1970 timestamps and native-transcript provenance belong to synthetic fixture
observations, not a real CLI/parser/model run, current activity, provider invoice
or complete transcript. This positive fixture contains only usage reports and
fits one page; explicit gap/truncation and four-page bounds retain their focused
unit/component proof rather than being claimed as new actual-browser cases.
Repeated historical-disposition copy can be refined later without changing this
source/accounting boundary; full Agent operational acceptance remains open.

[Positive artifact pins](nonempty-artifacts.json) identify the exact parent test
binary, owner fixture source, unchanged probe, manifest and screenshot hashes.
The source images remain under `/tmp/aq-session-events-nonempty-browser/`:
`agents-desktop-closed.png`, `source-events-desktop.png`,
`source-events-{390,320}.png`, and `source-provenance-{390,320}.png`.
The fixture listener shuts down afterward. Canonical promotion and its regression
record remain root-owned; this isolated positive record does not claim they
occurred through the fixture.
