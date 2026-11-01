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

The actual protected fixture and frozen
`scripts/probe-loaded-playbook-definitions.mjs` now passed against bundle
`8fe4fa06127cc0f3188bb3bbe45fdd6741cbb395f952d27ec7d7dd29b6b3628c`
in 2.89s (1207ms browser). [Independent actual/visual acceptance](../evidence/loaded-definitions-browser/README.md)
reviewed desktop, 390px and 320px detail/roster, including real 128-byte
definition/entry/dependency names and lower metadata panels. Exact pins, source,
compiler and purpose, deep-link reload, mobile exit/focus and intentional return
to an actual empty Runs list passed. Definitions made zero engine inspection
requests; the final Runs navigation made one intentional read. There were no
mutations, foreign requests, page errors or browser response interception.

The complete `pnpm exec tsc -b` check and 21 new focused tests pass after two
test-only typing corrections; the earlier app-only typecheck excluded tests.
This qualifies the loaded-startup subset, not a current installed catalog,
Activations or canonical runtime configuration. Root owns canonical preview
promotion, and enabling a real local optional owner still requires its trusted
PostgreSQL Unix socket transport.

## Next source increment: current namespace catalog

The separate `playbooks.catalog.read@1` capability selects the new current
namespace Definitions and Activations views. Their strict
[contract/examples](../../contracts/live/current-playbook-catalog/README.md)
consume AQ's component-owned bounded `CatalogQuery` adapter over the exact
qualified component 0.1.3 source. Namespace, generation, project, kind, owner
incarnation, metadata revision, exact address and cursor joins refuse mixed
observations. Revisions remain strings. Four bounded roster pages contain at
most 100 entries; deep links request exact metadata with the roster's stamp.

Definitions show current retained artifacts, fingerprints, source/compiler,
literal purpose and declared dependency references/selection. Activations show
actual binding revision, artifact and stored controls/denial flag; these do not
establish current grant validity or readiness. The existing mock's roster/detail
composition and phone All definitions/activations exits remain. Exact detail
outside the loaded roster returns focus to its namespace summary. Run pins and
history remain their own source.

When current support is absent, Definitions retains the clearly labelled
historical startup view. A current read error never falls back to that history
or becomes an empty success. Explicit refresh clears protected detail; catalog
change conflicts restart from a fresh first page. There are no create/install/
activate/edit commands and no provider effects.

Source checks: 60 focused finite-client/adapter/feature/unchanged-fallback tests
passed in 3.12 s and the full `pnpm exec tsc -b` passed. One initial assertion expected a
local error for a malformed 200 response; the existing global contract fence
correctly removed the page. The assertion now checks that fence, with a separate
valid 409 case checking local explicit refresh. No production bundle or browser
acceptance has run for this current-catalog increment. Backend qualification,
schema generation and independent desktop/390/320px actual review remain gates;
previous startup-metadata proof does not qualify current catalog/Activations.


The current-catalog JSON helper is feature-local: same-origin, redirect:error,
no-store, a five-second request/body deadline, caller cancellation and a 256 KiB
stream cap before strict JSON/DTO parsing. Duplicate keys, lossy numeric tokens
and malformed UTF-8 refuse. Authorization status is handled at headers before
any error body is read; cancellation is not awaited. Actual ReadableStream
401/403 cases with a never-completing cancellation and bootstrap503 qualify the
existing global denial latch, clearing prior catalog without historical
fallback. MSW buffers streamed bodies before exposing headers, so those two
app-level cases return the genuine streamed Response directly while keeping
bootstrap routed through MSW; they do not claim actual browser/network proof.


Exact-read 409 conflicts carry their failed namespace/kind/incarnation/metadata
stamp. If it matches the painted roster, the workspace stays fenced until an
explicit fresh epoch, including when selection is cleared through the tab. A
late conflict for a replaced stamp cannot hide a newer validated roster. Both
cases passed in the final focused suite. This fence retains only the refused
context, not a successful current-data cache or fallback authority.
