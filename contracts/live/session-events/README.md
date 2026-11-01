# Frozen session source-event read profile

Copied unchanged from `agent-q/crates/aq-observation-api/artifacts/`:

- `events.schema.json`: SHA256 `86ebd46536f54e42628925b4a23041444f0537c23f06fd2936c26630ff39ecdf`.
- `examples.json`: SHA256 `c8f23db8fb690a6b594d9d8dc97a39586e25385f859420e2159587e6dfb5f25f`.

The example is labelled synthetic source/accounting data. It is not provider,
harness, invoice, current canonical usage or live-agent qualification.
`session.events.read@1` enables the existing human route
`GET /api/observations/sessions/{attempt}/events` with `after_sequence`, optional
fixed `through_sequence`, and `limit=16`. Maximum response is 256KiB and 16 reports;
UI retains at most 4 pages/64 reports. Every page reauthorizes its exact session.

The local schema interpreter supports only this pinned closed schema. Semantic
checks add exact independent binding, safe unsigned integers, positive source
generations, source cursor/evidence agreement, body digest, accounting class and
historical contribution references, stable snapshot and source provenance across
pages. Unsafe JS integers and noninteger numeric syntax refuse; they are not
rounded. Duplicate object keys, including escaped aliases, refuse before parsing.

Body digest follows Rust typed canonical JSON: compact UTF8, recursively sorted
ASCII object keys, ordered arrays and exact integer values. Optional gap affected
cursor / usage correction references normalize omitted values to Rust `None`/JSON
null before hashing. The unchanged exported Rust example and reordered-object
regressions exercise this boundary. Artifact references are displayed literally;
no content-byte fetch or external navigation follows from a source report.
