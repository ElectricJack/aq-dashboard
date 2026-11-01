# Playbooks inspection UI

The Playbooks feature consumes the `playbooks-inspection-1` human API described in [API-05](../../../agent-q/docs/implementation/API-05-playbooks-inspection.md). Its real capability is `playbooks.inspect` version 1; a disabled capability makes no inspection request.

This first increment replaces the placeholder with bounded run discovery, exact artifact/dependency pins, current step/status, public receipts, pending operations and child workflows. Admissions are separate from confirmed runs. Filters describe loaded rows, pagination is explicit and decimal revisions/sequences never pass through Number. Project/namespace mismatches and malformed response shape refuse rendering. Query keys participate in the existing current-identity/authorization cache fence.

The accepted Playbooks mockup supplies the two-column roster/detail and timeline composition. Definitions/activations discovery and editing remain deferred. The timeline shows retained receipt events, not an invented complete step graph or an inferred review decision. Phone focus opens one run detail with an All runs return link.

Component/adapter tests use isolated explicit fixtures. The dedicated actual-server browser check is `tests/live/playbooks.spec.ts`; configured runtime absence or no admitted run is an explicit skip, not proof of live behavior. Root owns the assembled capability/bootstrap and preview update.
