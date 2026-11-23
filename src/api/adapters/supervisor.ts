import { ContractError, isRecord, nullable, optional, timestampMs } from "./contract";
/** human-supervisor-conversation-1, pinned to aq-server schema digest sha256:eda588e205779a11b74a319628f603a55e311358b3de345200d87fe6031f3ed3 (commit 7206f5a1). */
export const SUPERVISOR_CONTRACT = "human-supervisor-conversation-1";
export type Conversation = { id: string; revision: string; label: string };
type UnavailableRuntime = { state: "unavailable"; binding: null; reason: "central_runtime_not_connected" };
/** Discovery and History report a live binding while a central session serves the conversation; receipts keep the admission-time unavailable runtime. */
export type Runtime = UnavailableRuntime | {state:"idle";binding:null;reason:"central_service_ready"} | { state: "available"; binding: { actor_id: string; generation: number; session_id: string }; reason: "central_session_active" };
/** Server-advertised bounds; each is at most the published schema value (a server may disable context refs or attachments with 0). */
export type SupervisorLimits = { body_bytes: number; context_refs: number; attachments: number; history_page: number };
/** Discovery.attachments: owner upload support and the effective limits this server enforces. Absent on servers without owner attachments. */
export type AttachmentCapability = { media_types: AttachmentMediaType[]; max_file_bytes: number; max_files_per_message: number; max_staged_files: number; max_staged_bytes: number; staged_ttl_ms: number; max_name_bytes: number };
export type Discovery = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: Runtime; limits: SupervisorLimits; attachments?: AttachmentCapability };
export const CONTEXT_REF_TYPES = ["project", "task", "result", "review", "knowledge", "session", "playbook_run"] as const;
export type ContextRef = { type: typeof CONTEXT_REF_TYPES[number]; id: string; revision: string | null };
export type AttachmentRef = { id: string; digest: string };
export const ATTACHMENT_MEDIA_TYPES = ["text/plain", "text/markdown", "text/csv", "application/json", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type AttachmentMediaType = typeof ATTACHMENT_MEDIA_TYPES[number];
export type AttachmentDescriptor = { id: string; name: string; media_type: AttachmentMediaType; size_bytes: number; digest: string };
export type AttachmentUpload = AttachmentDescriptor & { conversation_id: string; created_at_ms: number } & ({ state: "staged"; message_id: null; expires_at_ms: number } | { state: "attached"; message_id: string; expires_at_ms: null });
export type DraftTask = { id: string; title: string; body?: string; acceptance_criteria?: string; labels?: string[]; task_state?: "draft" | "active"; parent_id?: string | null; priority?: number | null; role?: string | null; intelligence_hint?: string | null; task_type?: string | null };
export type TaskGraphCreate = { operation_id: string; project_id: string; expected_version: string; tasks: DraftTask[]; edges?: { id: string; source: string; target: string }[] };
export type ProposedTaskDraft = { type: "proposed_task_draft"; message_id: string; draft_id: string; project_id: string; revision: string; payload_digest: string; payload: TaskGraphCreate };
export type ActionReceiptAttachment = { type: "action_receipt"; message_id: string; operation_id: string; kind: "task.create" | "task.graph.create"; project_id: string; project_revision: string | null; created_task_ids: string[]; created_edge_ids: string[]; receipt_refs: { type: string; id: string }[]; request_digest: string };
export type SupervisorAttachment = ProposedTaskDraft | ActionReceiptAttachment;
type MessageBase = { message_id: string; thread_id: string; conversation_id: string; cursor: string; body: string; body_digest: string; created_at_ms: number; logical_admission: "queued"; agent_receipt: null };
export type HostDelivery = "not_attempted" | "pending" | "delivery_unknown" | "delivered" | "not_delivered";
export type SupervisorMessage = MessageBase & (
  | { author: { kind: "human"; user_id: string }; host_delivery: HostDelivery; context?: ContextRef[]; attachments?: AttachmentDescriptor[] }
  | { author: { kind: "supervisor"; actor_id: string; generation: number; session_id: string }; host_delivery: "not_attempted"; dispatch: { dispatch_id: string; host_operation_id: string; batch_digest: string }; attachments?: SupervisorAttachment[] });
export type History = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: Runtime; direction: "forward" | "backward"; through_cursor: string; items: SupervisorMessage[]; next_cursor: string | null; has_more: boolean };
export type ReceiptReason = "conversation_revision_changed" | "message_id_conflict" | "attachment_unavailable";
export type Receipt = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: UnavailableRuntime; operation_id: string; message_id: string; actor_id: string; request_digest: string; body_digest: string; state: "queued" | "not_queued"; cursor: string | null; reason: ReceiptReason | null; host_delivery: "not_attempted"; agent_receipt: null };
export type FrozenSupervisorMessage = Readonly<{ conversation: string; revision: string; actor: string; operation: string; message: string; bytes: string; requestDigest: string; bodyDigest: string }>;
const RECEIPT_REASONS: readonly string[] = ["conversation_revision_changed", "message_id_conflict", "attachment_unavailable"];
/** Published schema values, treated as maxima: callers bound requests by the adapted discovery limits. */
const SCHEMA_LIMITS = { body_bytes: 16384, context_refs: 16, attachments: 4, history_page: 16 } as const satisfies SupervisorLimits;
/** Lowest value a server may advertise: messages and history pages need room for one item; context refs and attachments may be disabled. */
const LIMIT_FLOORS: SupervisorLimits = { body_bytes: 1, context_refs: 0, attachments: 0, history_page: 1 };
export function supervisorId(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) && v !== "00000000-0000-0000-0000-000000000000"; }
function check(v: unknown): asserts v { if (!v) throw new ContractError("Invalid global supervisor response"); }
/** Closed object: every required key, optional keys only from the listed set, nothing else. */
function shape(v: unknown, keys: string, optional = ""): asserts v is Record<string, unknown> {
  check(isRecord(v)); const required = keys.split(" "), allowed = new Set([...required, ...optional.split(" ").filter(Boolean)]);
  check(required.every(k => Object.hasOwn(v, k)) && Object.keys(v).every(k => allowed.has(k)));
}
function decimal(v: unknown, zero = false): v is string { return typeof v === "string" && (zero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(v) && BigInt(v) <= 9223372036854775807n; }
function digest(v: unknown): v is string { return typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v); }
function integer(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max; }
function text(v: unknown, min: number, max: number): v is string { return typeof v === "string" && v.length >= min && v.length <= max; }
function list(v: unknown, min: number, max: number): v is unknown[] { return Array.isArray(v) && v.length >= min && v.length <= max; }
function unique(values: unknown[]): boolean { return new Set(values).size === values.length; }
function utf8Bytes(v: string): number { return new TextEncoder().encode(v).length; }
export function validateSupervisorText(body: string, maxBytes: number = SCHEMA_LIMITS.body_bytes): string | null {
  if (!body.trim()) return "Enter a message.";
  if (body.includes("\0") || /\p{Cs}/u.test(body)) return "Message must contain valid Unicode without NUL characters.";
  if (utf8Bytes(body) > maxBytes) return `Message exceeds ${maxBytes % 1024 ? `${maxBytes} bytes` : `${maxBytes / 1024} KiB`}.`;
  return null;
}
export async function supervisorDigest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("")}`;
}
/** Canonical JSON: recursively sorted object keys, compact. Shared by request_digest and payload_digest. */
export function canonicalSupervisorJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalSupervisorJson).join(",")}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalSupervisorJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function checkRuntime(v: unknown, liveAllowed: boolean) {
  shape(v, "state binding reason");
  if (v.state === "unavailable") { check(v.binding === null); check(v.reason === "central_runtime_not_connected"); return; }
  check(liveAllowed);
  if (v.state === "idle") { check(v.binding === null); check(v.reason === "central_service_ready"); return; }
  check(v.state === "available");
  check(v.reason === "central_session_active");
  shape(v.binding, "actor_id generation session_id");
  check(supervisorId(v.binding.actor_id));
  check(integer(v.binding.generation, 1));
  check(supervisorId(v.binding.session_id));
}
function common(v: Record<string, unknown>, expected?: Conversation | string, liveRuntime = true) {
  check(v.contract === SUPERVISOR_CONTRACT);
  shape(v.conversation, "id revision label");
  const c = v.conversation;
  check(supervisorId(c.id) && decimal(c.revision) && text(c.label,1,256));
  if (expected) check(c.id === (typeof expected === "string" ? expected : expected.id));
  if (expected && typeof expected !== "string") check(c.revision === expected.revision);
  checkRuntime(v.runtime, liveRuntime);
}
function checkAttachmentCapability(a: unknown) {
  if (a === undefined) return;
  shape(a, "media_types max_file_bytes max_files_per_message max_staged_files max_staged_bytes staged_ttl_ms max_name_bytes");
  check(list(a.media_types, 1, ATTACHMENT_MEDIA_TYPES.length) && unique(a.media_types) && a.media_types.every(t => (ATTACHMENT_MEDIA_TYPES as readonly unknown[]).includes(t)));
  check(integer(a.max_file_bytes, 1, 1048576));
  check(integer(a.max_files_per_message, 1, 4));
  check(integer(a.max_staged_files, 1));
  check(integer(a.max_staged_bytes, 1));
  check(integer(a.staged_ttl_ms, 1));
  check(integer(a.max_name_bytes, 1, 255));
}
export function adaptSupervisorDiscovery(v: unknown): Discovery {
  shape(v, "contract conversation runtime limits", "attachments"); common(v);
  shape(v.limits, "body_bytes context_refs attachments history_page");
  const limits = v.limits;
  check((Object.keys(SCHEMA_LIMITS) as (keyof SupervisorLimits)[]).every(key => integer(limits[key], LIMIT_FLOORS[key], SCHEMA_LIMITS[key])));
  checkAttachmentCapability(v.attachments);
  return v as unknown as Discovery;
}
/** Cursors stay unchanged on the wire; comparison only follows the published N / A.R ordering. */
export function compareSupervisorCursors(a: string, b: string): number {
  const [aa, ar = "0"] = a.split("."), [ba, br = "0"] = b.split(".");
  return BigInt(aa!) < BigInt(ba!) ? -1 : BigInt(aa!) > BigInt(ba!) ? 1 : BigInt(ar) < BigInt(br) ? -1 : BigInt(ar) > BigInt(br) ? 1 : 0;
}
function validCursor(value: unknown): value is string { return typeof value === "string" && value.split(".").length <= 2 && value.split(".").every(v => decimal(v)); }
function validContextRef(v: unknown): v is ContextRef {
  shape(v, "type id revision");
  return (CONTEXT_REF_TYPES as readonly unknown[]).includes(v.type) && supervisorId(v.id) && nullable(v.revision, decimal);
}
export function validAttachmentName(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && utf8Bytes(v) <= 255 && v !== "." && v !== ".." && v === v.trim() && !/[\p{Cc}/\\]/u.test(v) && !/\p{Cs}/u.test(v);
}
function validDescriptor(v: Record<string, unknown>): boolean {
  return supervisorId(v.id) && validAttachmentName(v.name) && (ATTACHMENT_MEDIA_TYPES as readonly unknown[]).includes(v.media_type) && integer(v.size_bytes, 1, 1048576) && digest(v.digest);
}
function validAttachmentDescriptor(v: unknown): v is AttachmentDescriptor { shape(v, "id name media_type size_bytes digest"); return validDescriptor(v); }
const DRAFT_TASK_OPTIONAL = "body acceptance_criteria labels task_state parent_id priority role intelligence_hint task_type";
function checkDraftTask(v: unknown) {
  shape(v, "id title", DRAFT_TASK_OPTIONAL);
  const hint = (h: unknown) => h == null || text(h, 1, 128);
  check(supervisorId(v.id));
  check(text(v.title, 1, 512));
  check(optional(v.body, body => text(body, 0, 32768)));
  check(optional(v.acceptance_criteria, criteria => text(criteria, 0, 8192)));
  check(optional(v.labels, labels => list(labels, 0, 16) && labels.every(label => text(label, 1, 128))));
  check(optional(v.task_state, state => state === "draft" || state === "active"));
  check(v.parent_id == null || supervisorId(v.parent_id));
  check(v.priority == null || integer(v.priority, 1, 300));
  check([v.role, v.intelligence_hint, v.task_type].every(hint));
}
function checkTaskGraphCreate(v: unknown): asserts v is TaskGraphCreate {
  shape(v, "operation_id project_id expected_version tasks", "edges");
  check(supervisorId(v.operation_id));
  check(supervisorId(v.project_id));
  check(decimal(v.expected_version));
  check(list(v.tasks, 1, 100));
  v.tasks.forEach(checkDraftTask);
  if (v.edges === undefined) return;
  check(list(v.edges, 0, 99));
  v.edges.forEach(edge => {
    shape(edge, "id source target");
    check(supervisorId(edge.id));
    check(supervisorId(edge.source));
    check(supervisorId(edge.target));
  });
}
async function checkSupervisorAttachment(v: unknown, message: string) {
  check(isRecord(v));
  if (v.type === "proposed_task_draft") {
    shape(v, "type message_id draft_id project_id revision payload_digest payload");
    check(v.message_id === message);
    check(supervisorId(v.draft_id));
    check(supervisorId(v.project_id));
    check(decimal(v.revision));
    check(digest(v.payload_digest));
    checkTaskGraphCreate(v.payload);
    check(v.project_id === v.payload.project_id);
    check(v.revision === v.payload.expected_version);
    check(await supervisorDigest(canonicalSupervisorJson(v.payload)) === v.payload_digest);
    return;
  }
  check(v.type === "action_receipt");
  shape(v, "type message_id operation_id kind project_id project_revision created_task_ids created_edge_ids receipt_refs request_digest");
  check(v.message_id === message);
  check(supervisorId(v.operation_id));
  check(v.kind === "task.create" || v.kind === "task.graph.create");
  check(supervisorId(v.project_id));
  check(nullable(v.project_revision, decimal));
  check(list(v.created_task_ids, 1, 100) && v.created_task_ids.every(supervisorId));
  check(list(v.created_edge_ids, 0, 100) && v.created_edge_ids.every(supervisorId));
  check(list(v.receipt_refs, 1, 100));
  v.receipt_refs.forEach(ref => {
    shape(ref, "type id"); check(text(ref.type, 1, 64)); check(text(ref.id, 1, 128));
  });
  check(digest(v.request_digest));
}
const ITEM_FIELDS = "message_id thread_id conversation_id cursor author body body_digest created_at_ms logical_admission host_delivery agent_receipt";
type IdentifiedMessage = Record<string, unknown> & Pick<SupervisorMessage, "cursor" | "message_id">;

function checkHistoryIdentity(item: Record<string, unknown>, expected: Conversation, ids: Set<string>): asserts item is IdentifiedMessage {
  check(supervisorId(item.message_id));
  check(!ids.has(item.message_id));
  check(item.thread_id === expected.id);
  check(item.conversation_id === expected.id);
  check(validCursor(item.cursor));
}

async function checkSupervisorReply(item: IdentifiedMessage) {
  shape(item.author, "kind actor_id generation session_id");
  check(item.cursor.includes("."));
  check(supervisorId(item.author.actor_id));
  check(supervisorId(item.author.session_id));
  check(integer(item.author.generation, 1, 1024));
  shape(item.dispatch, "dispatch_id host_operation_id batch_digest");
  check(supervisorId(item.dispatch.dispatch_id));
  check(supervisorId(item.dispatch.host_operation_id));
  check(typeof item.dispatch.batch_digest === "string" && /^[0-9a-f]{64}$/.test(item.dispatch.batch_digest));
  check(item.host_delivery === "not_attempted");
  if (item.attachments !== undefined) {
    check(list(item.attachments, 0, SCHEMA_LIMITS.attachments));
    for (const attachment of item.attachments) await checkSupervisorAttachment(attachment, item.message_id);
    check(unique(item.attachments.map(a => { const r = a as Record<string, unknown>; return `${String(r.type)}:${String(r.type === "proposed_task_draft" ? r.draft_id : r.operation_id)}`; })));
  }
}

function checkHumanMessage(item: IdentifiedMessage) {
  shape(item.author, "kind user_id");
  check(item.author.kind === "human");
  check(supervisorId(item.author.user_id));
  check(decimal(item.cursor));
  if (item.context !== undefined) {
    check(list(item.context, 1, SCHEMA_LIMITS.context_refs));
    check(item.context.every(validContextRef));
    check(unique(item.context.map(ref => `${ref.type}:${ref.id}`)));
  }
  if (item.attachments !== undefined) {
    check(list(item.attachments, 1, SCHEMA_LIMITS.attachments));
    check(item.attachments.every(validAttachmentDescriptor));
    check(unique(item.attachments.map(file => file.id)));
  }
}

async function checkMessageBody(item: Record<string, unknown>) {
  check(typeof item.body === "string" && !validateSupervisorText(item.body));
  check(digest(item.body_digest));
  check(await supervisorDigest(item.body) === item.body_digest);
  check(timestampMs(item.created_at_ms));
  check(item.logical_admission === "queued");
  check(["not_attempted", "pending", "delivery_unknown", "delivered", "not_delivered"].includes(String(item.host_delivery)));
  check(item.agent_receipt === null);
}

type HistoryWindow = { before?: string; after?: string };
function checkCursorRange(message: IdentifiedMessage, range: HistoryWindow & { previous: string; through: string }) {
  const { cursor } = message, { previous, through } = range;
  check(compareSupervisorCursors(cursor, previous) > 0);
  check(BigInt(cursor.split(".")[0]!) <= BigInt(through));
  if (range.before !== undefined) check(compareSupervisorCursors(cursor, range.before) < 0);
  if (range.after !== undefined) check(compareSupervisorCursors(cursor, range.after) > 0);
}

export async function adaptSupervisorHistory(v: unknown, expected: Conversation, page: HistoryWindow = {}): Promise<History> {
  shape(v, "contract conversation runtime direction through_cursor items next_cursor has_more"); common(v, expected);
  check(v.direction === (page.after !== undefined ? "forward" : "backward"));
  check(decimal(v.through_cursor, true));
  check(typeof v.has_more === "boolean");
  check(list(v.items, 0, SCHEMA_LIMITS.history_page));
  check(nullable(v.next_cursor, validCursor));
  let previous = "0"; const ids = new Set<string>();
  for (const item of v.items) {
    check(isRecord(item));
    check(isRecord(item.author));
    const reply = item.author.kind === "supervisor";
    if (reply) shape(item, `${ITEM_FIELDS} dispatch`, "attachments"); else shape(item, ITEM_FIELDS, "context attachments");
    checkHistoryIdentity(item, expected, ids);
    checkCursorRange(item, { ...page, previous, through: v.through_cursor });
    previous = item.cursor; ids.add(item.message_id);
    if (reply) await checkSupervisorReply(item);
    else checkHumanMessage(item);
    await checkMessageBody(item);
  }
  if (v.has_more) {
    check(v.items.length > 0);
    const boundary = v.direction === "backward" ? v.items[0] : v.items.at(-1);
    check(v.next_cursor === (boundary as SupervisorMessage).cursor);
  }
  else check(v.next_cursor === null);
  return v as unknown as History;
}
/** Optional pinned context refs and staged uploads, bounded by the adapted discovery limits. */
export type SupervisorMessageRefs = { limits: SupervisorLimits; context?: readonly ContextRef[]; attachments?: readonly AttachmentRef[] };
function messageRefs(refs?: SupervisorMessageRefs) {
  const context = refs?.context ?? [], attachments = refs?.attachments ?? [];
  if (context.length || attachments.length) {
    check(refs);
    check(context.length <= refs.limits.context_refs);
    check(attachments.length <= refs.limits.attachments);
  }
  check(context.every(validContextRef));
  check(unique(context.map(ref => `${ref.type}:${ref.id}`)));
  attachments.forEach(ref => { shape(ref, "id digest"); check(supervisorId(ref.id)); check(digest(ref.digest)); });
  check(unique(attachments.map(ref => ref.id)));
  return { context, attachments };
}
export async function freezeSupervisorMessage(c: Conversation, actor: string, body: string, refs?: SupervisorMessageRefs): Promise<FrozenSupervisorMessage> {
  check(supervisorId(c.id));
  check(decimal(c.revision));
  check(supervisorId(actor));
  check(!validateSupervisorText(body, refs?.limits.body_bytes));
  const { context, attachments } = messageRefs(refs);
  const operation = crypto.randomUUID(), message = crypto.randomUUID(); check(operation !== message);
  const bytes = canonicalSupervisorJson({ attachments: attachments.map(({ id, digest }) => ({ id, digest })), body, context: context.map(({ type, id, revision }) => ({ type, id, revision })), expected_conversation_revision: c.revision, message_id: message, operation_id: operation });
  check(utf8Bytes(bytes) <= 131072);
  return Object.freeze({ conversation: c.id, revision: c.revision, actor, operation, message, bytes, requestDigest: await supervisorDigest(bytes), bodyDigest: await supervisorDigest(body) });
}
export function adaptSupervisorReceipt(v: unknown, expected: { conversation: string; actor: string; operation: string; message: string; frozen?: FrozenSupervisorMessage }): Receipt {
  shape(v, "contract conversation runtime operation_id message_id actor_id request_digest body_digest state cursor reason host_delivery agent_receipt"); common(v, expected.conversation, false);
  check(v.operation_id === expected.operation);
  check(supervisorId(v.operation_id));
  check(v.message_id === expected.message);
  check(supervisorId(v.message_id));
  check(v.actor_id === expected.actor);
  check(supervisorId(v.actor_id));
  check(digest(v.request_digest));
  check(digest(v.body_digest));
  check(v.host_delivery === "not_attempted");
  check(v.agent_receipt === null);
  if (expected.frozen) { check(v.request_digest === expected.frozen.requestDigest); check(v.body_digest === expected.frozen.bodyDigest); }
  if (v.state === "queued") { check(decimal(v.cursor) && v.reason === null); if (expected.frozen) check((v.conversation as Conversation).revision === expected.frozen.revision); }
  else { check(v.state === "not_queued"); check(v.cursor === null); check(RECEIPT_REASONS.includes(String(v.reason))); }
  return v as unknown as Receipt;
}
/** Response to PUT /api/human/conversations/{id}/attachments/{attachment}. */
export function adaptSupervisorAttachmentUpload(v: unknown, expected: { conversation: string; attachment: string }): AttachmentUpload {
  shape(v, "id name media_type size_bytes digest conversation_id created_at_ms state message_id expires_at_ms");
  check(validDescriptor(v));
  check(v.id === expected.attachment);
  check(v.conversation_id === expected.conversation && supervisorId(v.conversation_id));
  check(integer(v.created_at_ms, 1));
  if (v.state === "staged") check(v.message_id === null && integer(v.expires_at_ms, 1));
  else check(v.state === "attached" && supervisorId(v.message_id) && v.expires_at_ms === null);
  return v as unknown as AttachmentUpload;
}
export const ATTACHMENT_ERRORS = ["attachment_media_type_unsupported", "attachment_too_large", "attachment_name_invalid", "attachment_unreadable", "attachment_id_conflict", "attachment_capacity_exhausted", "attachment_not_found", "attachment_bound"] as const;
export type AttachmentErrorCode = typeof ATTACHMENT_ERRORS[number];
export type AttachmentError = { error: AttachmentErrorCode; message: string };
/** Structured refusal of an owner attachment route; null when the body is not one (generic AQ errors keep their own handling). */
export function adaptSupervisorAttachmentError(v: unknown): AttachmentError | null {
  if (!isRecord(v) || Object.keys(v).length !== 2) return null;
  if (typeof v.message !== "string" || !v.message.length) return null;
  if (!(ATTACHMENT_ERRORS as readonly unknown[]).includes(v.error)) return null;
  return { error: v.error as AttachmentErrorCode, message: v.message };
}
/** Duplicate identities or cursors must never replace already inspected history. */
export function mergeSupervisorMessages(current: SupervisorMessage[], incoming: SupervisorMessage[]): SupervisorMessage[] {
  const byId = new Map(current.map(item => [item.message_id, item]));
  const facts = (item: SupervisorMessage) => JSON.stringify([item.cursor, item.thread_id, item.conversation_id, item.author, item.body, item.body_digest, item.created_at_ms, item.logical_admission, item.agent_receipt,
    "dispatch" in item ? item.dispatch : null, "context" in item ? item.context ?? [] : [], item.attachments ?? []]);
  for (const item of incoming) { const old = byId.get(item.message_id); check(!old || facts(old) === facts(item)); byId.set(item.message_id, item); }
  const messages = [...byId.values()].sort((a, b) => compareSupervisorCursors(a.cursor, b.cursor));
  check(new Set(messages.map(item => item.cursor)).size === messages.length);
  return messages;
}
