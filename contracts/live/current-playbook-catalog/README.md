# Current Playbooks catalog profile 1

Consumes AQ's `playbooks-current-catalog-1` protected read adapter over the
qualified component's `playbooks-catalog-1`. The separately negotiated capability
is `playbooks.catalog.read@1`. These schematic examples describe the frozen DTO;
they are never used as actual runtime facts. The generated backend schema is
added after its assigned build gate.

The adapter joins exact namespace/project/generation, route kind, owner
incarnation, metadata revision, opaque key and continuation position. Header
revisions remain decimal strings. Definition metadata and activation controls
are separate typed records; no captured inputs, schemas or authority are allowed.
Startup configuration keeps its own historical contract and is used only when
current-catalog capability is absent, never after a current read error.
