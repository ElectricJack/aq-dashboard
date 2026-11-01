# Current Playbooks catalog profile 1

Consumes AQ's `playbooks-current-catalog-1` protected read adapter over the
qualified component's `playbooks-catalog-1`. The separately negotiated capability
is `playbooks.catalog.read@1`. These schematic examples describe the frozen DTO;
they are never used as actual runtime facts. The generated backend `schema.json` is pinned at SHA-256
`a1009bffcb9b688b7df2b3ebd7d3211946f53d551309e8107c05f1ebef6fff9c`.

The adapter joins exact namespace/project/generation, route kind, owner
incarnation, metadata revision, opaque key and continuation position. Header
revisions remain decimal strings. Definition metadata and activation controls
are separate typed records; no captured inputs, schemas or authority are allowed.
Startup configuration keeps its own historical contract and is used only when
current-catalog capability is absent, never after a current read error.
