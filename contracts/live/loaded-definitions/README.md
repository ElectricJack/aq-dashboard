# Loaded definition metadata contract

Profile `playbooks-loaded-definitions-1`, capability
`playbooks.loaded-definitions.read@1`. The adjacent schema is copied byte for
byte from agent-q `protocol/playbooks-loaded-definitions/v1/schema.json`,
generated from `playbooks::inspection::definitions::DefinitionsPage`.

SHA256: `8852409579266e5be4aa965ea4ca1af12c8820224d949db652c89c0503ac37ca`.
The source is the next bounded increment after agent-q `1fcd3f0`; it does not
change the frozen `playbooks-inspection-1` schema or component archive.

The response is runtime startup configuration with `current_catalog=false`,
never current installed/active state. Project context must match the namespace
and is not an installed-inventory filter. The dedicated adapter checks closed
objects, versions/provenance, exact artifact ordering, UTF-8/scalar and count
bounds, namespace generation and project binding. Synthetic UI fixtures in
`src/test/loadedDefinitions.ts` are isolated from production assets.
