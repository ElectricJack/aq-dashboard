# Playbooks inspection UI

The Playbooks feature consumes the `playbooks-inspection-1` human API described in [API-05](../../../agent-q/docs/implementation/API-05-playbooks-inspection.md). Its real capability is `playbooks.inspect` version 1; a disabled capability makes no inspection request.

This first increment replaces the placeholder with bounded run discovery, exact artifact/dependency pins, current step/status, public receipts, pending operations and child workflows. Admissions are separate from confirmed runs. Filters describe loaded rows, pagination is explicit and decimal revisions/sequences never pass through Number. Project/namespace mismatches and malformed response shape refuse rendering. Query keys participate in the existing current-identity/authorization cache fence.

The accepted Playbooks mockup supplies the two-column roster/detail and timeline composition. Current installed definition/activation discovery and editing remain deferred. The timeline shows retained receipt events, not an invented complete step graph or an inferred review decision. Phone focus opens one run detail with an All runs return link.

Component/adapter tests use isolated explicit fixtures. The dedicated actual-server browser check is `tests/live/playbooks.spec.ts`; configured runtime absence or no admitted run is an explicit skip, not proof of live behavior. Root owns the assembled capability/bootstrap and preview update.

The [configured parent/child browser proof](../evidence/configured-playbooks-browser/README.md) now supplies positive qualification for this read-only increment: actual protected owner installation/activation/admission, a completed parent with a blocking child, exact pins, four parent receipts, child/parent navigation, reload, admissions and reviewed desktop/390px composition. The full isolated test passed in 4.08s with no browser response interception, mutation or provider calls. The unchanged 28-asset bundle's manifest SHA256 was `85fa3dbfb790467dcaca3be6ce6ee7f448d9b2b39603f066df3b3811afbde2a8`. The fixture listener shut down afterward; this does not assert a newly promoted canonical preview or completion of Definitions/Activations.

## Next increment: loaded startup definitions

The Definitions tab now has a separate `playbooks.loaded-definitions.read@1`
gate and [strict metadata contract](../../contracts/live/loaded-definitions/README.md).
It lists at most four distinct artifacts actually loaded from runtime startup
configuration, with exact immutable fingerprints, source/compiler, literal
purpose/explicit truncation, entries and declared dependency references.
Selection/reload use the existing Playbooks route; phone detail provides
All definitions and restores roster focus. Long model-valid names/aliases wrap.

This is **Runtime startup configuration**, not a current installed catalog or
activation state. Shared project context must match its namespace and does not
relabel these records as installed for the selected project. Later installation
does not restamp this history. Activations is unavailable; no create/install/
edit/activate action exists. Full installed discovery requires a component-owned
bounded query and new component version as described in the
[paired implementation record](../../../agent-q/docs/implementation/API-05-loaded-definitions.md).

The actual protected fixture and `scripts/probe-loaded-playbook-definitions.mjs`
are prepared for the next compiled bundle. Source tests are distinct from actual
desktop/phone screenshot acceptance and canonical preview promotion; the earlier
parent/child proof does not qualify this new metadata UI automatically.
