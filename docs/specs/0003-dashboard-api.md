# Dashboard API and integration contract

Status: proposed API-02 expansion, 2026-10-31. **This document defines required behavior and proposed new routes; it does not publish an implemented wire schema.** Existing contracts are identified explicitly below. API-02 must publish versioned OpenAPI/JSON Schema, generated bindings, semantic validators and fixtures before dependent live integrations are accepted.

Related: [product design](0002-product-design.md), [current contract audit](../research/2026-10-31-contract-audit.md), [delivery plan](../plans/0001-dashboard-implementation.md). Browser traffic terminates at AQ's human listener. There is no new dashboard backend and no direct graph/worker/provider access.

## 1. Reuse before extension

| Capability | Actual existing interface to qualify and reuse | Missing dashboard layer |
| --- | --- | --- |
| Identity / status / workers | `GET /api/me`, `/api/status`, `/api/workers`; human identity/CSRF guard | Capability bootstrap, scoped bounded collections, compatibility manifest |
| Projects / profiles | `/api/projects`, `/api/projects/{id}`; `/api/profiles/catalogs`; `/api/intelligence/explain` | Browser read models, finite action descriptors and generated contract inventory |
| Attempt inspection | `GET /api/execution/attempts/{id}`; cancel route when enabled | Task-to-attempt discovery, consistent explanations, permitted actions |
| Terminal | `/api/v1/terminals/{terminal}`, `/output`, `/mutations`, `/receipts/{operation}`, `/access` | Qualified discovery, negotiation and browser renderer integration |
| Session observations | `/api/observations/sessions/{attempt}/events` and `/usage` | Roster/lineage views and complete producers; quota is separate |
| Durable mail | `POST /api/messages/send`, `/api/messages/inbox` | Global supervisor authority, stable conversation discovery/history and context attachments |
| Human notifications | `/api/notifications`, `/{message}`, `/routes`, `/retry` | Dashboard projection and typed decision linkage |
| Graph / playbooks / lifecycle | Public component schemas and domain libraries | AQ-authorized human read/action adapters; component API presence is not browser readiness |

Pin terminal runtime artifacts from `agent-q/protocol/terminal-relay/draft-v1/{schema,peer-schema,human-runtime.schema}.json` plus their referenced shared contracts and semantic vectors. The earlier session API README reserves different future paths; do not implement those reserved paths as if they were mounted. Terminal draft capability must be explicitly negotiated and qualified; availability of source is not a release promise.

Existing wire types retain their exact field names, numeric representation, timestamps and states. A frontend adapter can normalize them into view models; it must retain original provenance and lossless values. New types below do not retroactively change existing APIs. Large Rust integer revisions must be decoded losslessly; do not pass unsafe JSON integers through JavaScript `Number`.

## 2. Proposed public API conventions

New human resources use `/api/v1/...`, centrally registered in AQ's contract inventory. Paths in sections 3–7 are proposals unless listed as existing above. Common fields apply to new resources; owner adapters must explicitly map existing responses.

| Type | Required meaning |
| --- | --- |
| `Id` | Opaque nonempty identifier, maximum 128 UTF-8 bytes; preserve existing UUID identities where applicable |
| `Revision` | Positive decimal string; compare for equality, never infer ordering across resources |
| `Timestamp` | UTC RFC3339 string with milliseconds; nullable only when explicitly unknown |
| `Digest` | Algorithm-labelled SHA-256 digest of immutable bytes/canonical payload, with published canonicalization |
| `Scope` | `{kind:"all_authorized"}` or `{kind:"project", project_id:Id}`; server derives the authorized set |
| `EntityRef` | `{type, id, revision?}`; pins require revision, current pointers explicitly omit it |
| `Observation` | `{observed_at, fresh_until, source, quality:reported\|estimated\|unknown, coverage:complete\|partial\|unknown}` |
| `ActionDescriptor` | `{kind, subject, allowed, reason_code?, explanation?, expected_versions, expires_at?}`; UI hint, never a grant |

All new reads return an envelope with `api_version`, `request_id`, `server_time`, `scope`, `data`, `observation`, `pending_operations`, and `coverage:{state,omitted_count?,reason?}`. Mutable entities carry their revision; immutable artifacts carry their digest. A composite read carries a revision vector/source watermarks, not a fictional cross-service transaction revision. Distinguish server-authoritative lifecycle fields from observations inside the response.

Collections use an opaque, authenticated cursor bound to principal, scope, normalized filters, sort and snapshot/watermark. Page size defaults to 25, maximum 100; Results defaults to 20. Stable order includes an ID tiebreaker. Return `next_cursor`, `has_more`, `snapshot_id`, and `total:{value,accuracy:exact\|estimated\|unknown}`. On expired cursors return a typed restart instruction; keep the user's reading anchor while refreshing. Newest items do not mutate an existing snapshot. Permission changes invalidate access immediately, including cached thumbnail/download retrieval.

IDs/cursors alone grant no access. Scope is checked for every returned entity, relationship endpoint, historical revision and artifact. All-authorized aggregation must not reveal excluded project counts. Validate bounded filters and reject unknown mutation fields. Server supplies maximum page/body/media limits through bootstrap and may lower defaults; clients obey lower limits.

The current human CSRF convention is `X-AQ-Request: 1` on non-GET/HEAD requests, with same-origin validation when Origin is present. Use the configured human identity flow, never a worker or agent token. Scope/role changes invalidate protected query caches. No persistent sensitive offline cache is included.

## 3. Bootstrap and provider quota

Propose `GET /api/v1/bootstrap`:

```ts
type Bootstrap = {
  principal: { id: Id; display_name: string; authorization_revision: Revision };
  product: { version: string; dashboard_digest: Digest };
  contracts: { name: string; version: string; digest: Digest }[];
  capabilities: { name: string; version: string; enabled: boolean; reason?: string }[];
  limits: { page_size: number; media: MediaLimits; polling: PollingLimits };
  default_scope: Scope;
  global_supervisor: { status: "available" | "unconfigured" | "unavailable";
    conversation_id: Id | null; reason?: string };
};
```

Required capability families: `dashboard.inspect`, `dashboard.actions`, `provider.quota`, `supervisor.conversation`, `terminal.watch`, `terminal.control`, `results.read`, `results.comment`, `results.feedback`, `artifacts.read`, `playbooks.inspect`, `knowledge.read`. Independent mutations need their own permissions; a capability does not grant them. Exact capability spellings/version ranges are frozen in API-02 publication, not inferred from a server version number.

Propose `GET /api/v1/provider-usage`, account-scoped regardless of project filter:

```ts
type QuotaWindow = {
  id: Id; label: string; starts_at: Timestamp | null; resets_at: Timestamp | null;
  used_percent: number | null; used: number | null; limit: number | null;
  unit: string | null; state: "known" | "unknown" | "unavailable";
  observation: Observation;
};
type ProviderUsage = {
  provider_id: Id; account_ref: Id; account_label: string;
  scope: "provider_account"; windows: QuotaWindow[];
  preferred_window_id: Id | null; availability_ref: EntityRef | null;
};
```

`used_percent` is 0–100 when the upstream contract defines a capped ratio; any over-limit quantity is a separate explicit field in the published schema. Null means unknown. A reset may be unknown. No source percentage is inferred from token totals, worker slots or credential availability. The collector owns upstream semantics, authentication, freshness and shared-account deduplication; the browser never calls the provider. Adapter faults return stale/unknown observations, without blocking all other page content. API-02 must select and qualify actual quota sources; this audit found no provider quota reporting contract to reuse.

## 4. Read-model inventory

The following endpoints and projections are required additions. Reuse AQ domain operations internally; do not expose a generic component proxy.

| Proposed read | Required projection beyond common metadata |
| --- | --- |
| `GET /api/v1/overview` | Typed attention items, reason/impact/age, subject pins, permitted action descriptors; active counts and recent result references |
| `GET /api/v1/search` | Scoped typed hits, match excerpts, entity pins, bounded pages; never raw secret-bearing configuration |
| `GET /api/v1/tasks` and `/tasks/{id}` | Title/project, task lifecycle, acceptance revision, dependencies, attempt refs, wait/blocker explanations, latest result/source/delivery refs |
| `GET /api/v1/tasks/{id}/graph` | Bounded nodes/typed edges, revision pins, cursor/coverage and omitted counts; no client scheduling policy |
| `GET /api/v1/sessions` and `/sessions/{id}` | Exact task/attempt/session identity, central/remote authority, selected profile/provider/model/harness, terminal ref, observation, permissions and wait refs |
| `GET /api/v1/decisions` and `/decisions/{id}` | Kind, subject revision, state, evidence refs, requested response schema, allowed typed actions, expiry/supersession |
| `GET /api/v1/playbook-runs` and `/{id}` | Immutable root/dependency manifest, step states, typed waits, child relationships, pending operations, receipts and actions |
| `GET /api/v1/playbook-definitions` and `/playbook-activations` | Versioned source/artifact metadata and activation revisions, separately scoped |
| `GET /api/v1/knowledge` and `/{id}` | Shared graph node projection, classification/lifecycle/verification, provenance, revision and allowed actions |
| `GET /api/v1/knowledge/{id}/revisions/{revision}` and `/history` | Immutable content, verification assertions/source pins, successor links, bounded history |
| `GET /api/v1/waits/{id}` | Predicate/source pins, verified outcomes, deadline policy, continuation generation, retained resources and current blockers |

All detail projections include links to authoritative operation receipts, not synthetic completion derived from logs. Existing session/notification endpoints may be used directly behind typed client adapters; no duplicate storage is needed. Browser Settings initially uses current identity and local presentation preferences; privileged configuration surfaces require explicit additional endpoint qualification.

## 5. Supervisor conversation contract

Propose `GET /api/v1/conversations/global`, `GET /api/v1/conversations/{id}/messages`, and `POST /api/v1/conversations/{id}/messages`. The global route resolves a stable authorized conversation rather than guessing an active attempt. A new supervisor incarnation may participate in the same logical conversation but must retain exact delivery/authority identities.

Messages contain `message_id`, `thread_id`, `conversation_id`, server-derived author, `created_at`, UTF-8 text, pinned context refs, artifact refs and separate logical admission / node-or-host delivery / agent receipt fields. Maximum body initially 16,384 UTF-8 bytes, aligned with current mail; at most 16 context refs. Pagination supports reading older history and observing new messages without changing message identity. Attachments use the artifact service, not arbitrary URLs or base64 bodies in mail.

Sending carries `operation_id`, client-minted `message_id`, expected conversation revision and immutable body/context. The adapter must durably retain accepted intent before handing it to the existing mailbox mechanism. Specify how replies attach to conversation/thread and how oversized historical bodies are recovered. Global scope does not expose all projects: attached context and assistant replies remain authorized for the current reader.

AQ-17 is required for a central supervisor authority adapter. AQ-11 task/session mailbox identity does not by itself define global conversation identity. Reconnecting or switching dock/full presentation creates neither a message nor a session. Unknown delivery never causes automatic reinjection to a successor. A task proposal is a typed draft reference; executing it uses an authorized domain operation, not an interpretation of arbitrary message prose.

## 6. Results, media, comments and feedback

These are **new AQ-owned product contracts**. Reuse existing attempt/source/evidence identities, but do not equate an execution result receipt with a human-facing Result or a graph evidence descriptor with retained media bytes.

| Entity | Required fields / invariant |
| --- | --- |
| Result | Stable `id`, mutable aggregate `version`, project/task refs, `current_revision`; revisions remain addressable |
| ResultRevision | Immutable revision/digest, attempt/session refs when applicable, source identity, summary, submitted time, parent result refs, capture-policy snapshot, artifact refs, check/evidence refs, addressed feedback refs |
| ResultAssessment | Own version; result revision, evidence evaluation, acceptance state, actor/policy refs, decision time. Mutable assessment is not stored by rewriting immutable result content |
| CaptureRequirement | ID, policy revision, kind, named scenario/steps, target viewport/environment, count/minimum attributes, required flag, applicability explanation and gate binding |
| Artifact | Immutable content identity/digest/bytes/MIME, filename, dimensions/duration as applicable, capture metadata, uploader identity, processing state, authorized retention/availability, expiry and holds |
| Thread / Comment | Thread ID/version/state; comment ID/revision, server author/time, body, exact result revision and optional artifact anchor; edits retain history |
| FeedbackLink | Origin comment/thread/result refs, exact anchor, created or existing task, creation operation, follow-up result refs, separate resolution assertion |

Capture metadata includes scenario ID, viewport CSS width/height, device pixel ratio, capture timestamp, environment label, source revision and applicable checks. It is a producer assertion with provenance, not proof that a video depicts the claimed revision.

Proposed routes:

| Route | Semantics |
| --- | --- |
| `GET /api/v1/results` | Bounded feed; `mode=latest|needs_review|following`, scope/media/time/task filters |
| `GET /api/v1/results/{id}/revisions/{revision}` | Exact immutable revision plus separately versioned current assessment |
| `POST /api/v1/results` and `/results/{id}/revisions` | Authorized submission/append; stable operation ID, expected task/aggregate versions, exact artifact refs |
| `PUT /api/v1/results/{id}/follow` | Explicit desired boolean with operation ID; following is not review acceptance |
| `GET /api/v1/artifacts/{id}` and `/{id}/content` | Scoped metadata and bytes/ranges; thumbnail variants retain origin digest |
| `POST /api/v1/artifact-uploads` | Authorized bounded intent: immutable metadata, expected digest/size, expiry, accepted part limits |
| `PUT /api/v1/artifact-uploads/{id}/parts/{part}` | Part checksum and deterministic part identity; identical replay succeeds, changed bytes conflict |
| `POST /api/v1/artifact-uploads/{id}/finalize` | Verify size/digest/type, durably retain and queue safe processing; status may remain pending |
| `GET /api/v1/artifact-uploads/{id}` | Read retained intent/finalization disposition after response loss |
| `GET/POST /api/v1/results/{id}/revisions/{revision}/comments` | Bounded threads or comment creation; exact result/artifact anchor required |
| `POST /api/v1/comments/{id}/revisions` | Version-guarded correction with retained history |
| `POST /api/v1/feedback-tasks` | Create one task from explicit editable draft and origin refs; durable cross-owner operation |
| `POST /api/v1/feedback-links` | Link an authorized existing task without creating work |
| `POST /api/v1/threads/{id}/resolve` | Version-guarded actor/policy assertion with exact follow-up result revision and reason |
| `POST /api/v1/results/{id}/evidence-waivers` | Explicit requirement/policy/revision-bound exception under server authorization |

Human uploads use the human listener. Agent/worker capture producers need a **separately authenticated machine ingestion adapter** with frozen task/attempt/generation binding; they must never borrow a browser identity. Artifact storage and processing are AQ-owned services/modules even if bytes use configured object storage. AQ mediates access initially; a later signed-URL design needs explicit lifetime/revocation semantics.

Initial media policy: PNG/JPEG/WebP images up to 20 MiB and 40 megapixels; MP4/WebM clips up to 100 MiB and 120 seconds; UTF-8 text/log/JSON evidence up to 10 MiB. At most 20 artifacts and 250 MiB per result revision, subject to stricter server quotas. Use separate bounded upload admission; 4 MiB maximum parts, at most two concurrent parts per client. Validate actual file content and decoded dimensions/duration, not only declared MIME/extension. No active HTML/SVG execution. Serve inert metadata with content sniffing disabled. Text is escaped. Process thumbnails/transcodes asynchronously with resource ceilings and explicit failures. Original and derived digests are distinct. A processed variant does not silently replace the source.

Proposed retention default: unfinalized uploads expire after 24 hours; unheld retained result bytes expire 90 days after submission. Open review/feedback and accepted completion-evidence policy place explicit holds; holds cannot silently expire beneath an unresolved decision. Before release, publish per-project storage budgets and an authorized eviction/waiver process. Keep minimal scoped metadata/tombstones and annotation identities after byte deletion. Never claim retained evidence merely because metadata survives. Content retrieval rechecks permission; no public permanent media URLs.

Anchors are tagged unions:

```ts
type Anchor =
  | { kind: "result" }
  | { kind: "image_region"; artifact_id: Id; digest: Digest;
      x: number; y: number; width: number; height: number }
  | { kind: "video_range"; artifact_id: Id; digest: Digest;
      start_ms: number; end_ms: number };
```

Image coordinates use the displayed image after the server's documented orientation normalization, within [0,1], positive width/height and bounds ≤1. Video bounds are integer milliseconds, `0 ≤ start ≤ end ≤ duration`; equal endpoints mean one instant. The artifact must belong to that result revision. Transformations may display anchors but cannot mutate their original meaning. Text comments are 1–16,384 UTF-8 bytes; initial nesting is one thread with ordered replies, not arbitrary recursive trees.

Feedback draft requires title (1–200 characters), description, acceptance criteria, authorized project/parent-task refs, origin thread/comment revision and result/artifact pins. AQ uses a durable intent/outbox with one fixed upstream graph key, then retains the created task receipt and feedback link. If task creation succeeds and linking is uncertain, operation status names the retained task when authorized and reconciles the link with the same identity. It must never repeat task creation under a new key. Thread resolution is a later independent guarded operation; linking and submitting a fix do not resolve it.

Following/Needs review are server-defined projections: Following is explicitly followed results plus the current user's opted-in feedback threads; Needs review means an unresolved applicable review/evidence decision, not merely an unread card. Changes to those definitions are versioned product semantics, not browser heuristics.

## 7. Actions, receipts and error contract

Propose `POST /api/v1/actions` for a **finite tagged union** of approved domain actions and `GET /api/v1/operations/{id}` for human lookup. Each action has its own published schema and adapter: task cancellation, typed decision response, authorized knowledge correction/verification/retirement, playbook start/cancel/activation and supported wait interventions. Do not expose arbitrary command names, URLs, shell fragments or graph mutations. Results-specific endpoints use the same durable operation semantics. Existing terminal operations keep their specialized contract.

New mutation envelope: `{operation_id, kind, subject, expected_versions, reason?, payload}`. Bind ID to principal, scope and canonical immutable request digest before dispatch. Identical retry returns the retained disposition; changed-byte reuse returns conflict. Authentication and current authorization are checked again on retry. An existing receipt cannot grant a new effect. Declare receipt retention in capability metadata; proposed ordinary action minimum is 90 days plus all unresolved operations, with retired-ID tombstones preventing replay after removal.

| Disposition | Browser behavior |
| --- | --- |
| `pending` | Durable admission or in-flight work; show pending, poll original operation |
| `confirmed` | Show exactly the confirmed effect and affected versions, then refresh relevant reads |
| `conflict` | Show version/identity conflict; preserve draft; no automatic overwrite |
| `rejected` | Definite refusal; show safe explanation and permitted next step |
| `unknown` | Effect/admission may have occurred; retain original ID/bytes, query, never invent success or a new action |

Operation response includes disposition, canonical request digest, created/updated times, subject refs, confirmed receipt refs, affected entities, and permitted recovery action. A missing lookup row means admission unknown unless the server can prove a stronger result. HTTP 202 is not completion. UI may show pending placeholders, never optimistic authoritative lifecycle changes.

New error envelope: `{request_id,code,message,retryable,operation_id?,field_errors?,current_versions?,retry_after_ms?}` with bounded safe strings. Use 401 for unauthenticated, 403 for unauthorized, neutral 404 for inaccessible/missing resources, 409 for conditional or identity conflicts, 410 for expired bytes/cursors where disclosure is authorized, 413 for limits, 422 for validation, 426 for unsupported required contract and 429/503 for bounded capacity/unavailability. Before durable admission an error may have no operation ID; after admission return the retained disposition where available. Transport failures alone never prove no effect. Unknown enum values render explicitly unsupported, disabling dependent actions rather than coercing to a success state.

## 8. Publication and contract acceptance

API-02 owns the human contract inventory and adapter behavior. Publish:

1. Versioned OpenAPI/JSON Schema with explicit limits, enums and discriminators, plus generated TypeScript and a lossless integer strategy.
2. Canonical fixtures for every successful, empty, partial, stale, unsupported, unauthorized, conflict, pending and unknown state; error and cursor fixtures included.
3. Semantic tests for scoped projections, exact revisions, request digest/replay, expiry and receipt retention. Schema validity alone is insufficient.
4. Compatibility manifest tying contract digests, server capabilities and bundle requirements. Unknown required capabilities block that feature; old tabs retain unsent drafts while presenting a safe upgrade path.
5. Runtime integration evidence for the mounted human router, current identity/CSRF policy, actual domain adapters and the selected immutable product candidate.

The dashboard can build components against clearly labelled proposed fixtures now. A live integration is not complete until its published contract, mounted route, authorization, domain effect and recovery behavior are qualified together. Results storage, quota collection and central supervisor authority are explicit backend work, not frontend assumptions.
