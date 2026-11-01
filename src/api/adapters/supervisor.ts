import { ContractError, isRecord } from "./contract";
export const SUPERVISOR_CONTRACT = "human-supervisor-conversation-1";
export type Conversation = { id: string; revision: string; label: "Global supervisor" };
type Runtime = { state: "unavailable"; binding: null; reason: "central_runtime_not_connected" };
export type Discovery = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: Runtime; limits: { body_bytes: 16384; context_refs: 0; attachments: 0; history_page: 16 } };
export type SupervisorMessage = { message_id: string; thread_id: string; conversation_id: string; cursor: string; author: { kind: "human"; user_id: string }; body: string; body_digest: string; created_at_ms: number; logical_admission: "queued"; host_delivery: "not_attempted"; agent_receipt: null };
export type History = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: Runtime; direction: "forward" | "backward"; through_cursor: string; items: SupervisorMessage[]; next_cursor: string | null; has_more: boolean };
export type Receipt = { contract: typeof SUPERVISOR_CONTRACT; conversation: Conversation; runtime: Runtime; operation_id: string; message_id: string; actor_id: string; request_digest: string; body_digest: string; state: "queued" | "not_queued"; cursor: string | null; reason: "conversation_revision_changed" | "message_id_conflict" | null; host_delivery: "not_attempted"; agent_receipt: null };
export type FrozenSupervisorMessage = Readonly<{ conversation: string; revision: string; actor: string; operation: string; message: string; bytes: string; requestDigest: string; bodyDigest: string }>;
export function supervisorId(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) && v !== "00000000-0000-0000-0000-000000000000"; }
function check(v: unknown): asserts v { if (!v) throw new ContractError("Invalid global supervisor response"); }
function shape(v: unknown, keys: string): asserts v is Record<string, unknown> { check(isRecord(v)); const fields = keys.split(" "); check(Object.keys(v).length === fields.length && fields.every(k => Object.hasOwn(v, k))); }
function decimal(v: unknown, zero = false): v is string { return typeof v === "string" && (zero ? /^(0|[1-9][0-9]{0,18})$/ : /^[1-9][0-9]{0,18}$/).test(v) && BigInt(v) <= 9223372036854775807n; }
function digest(v: unknown): v is string { return typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v); }
export function validateSupervisorText(body: string): string | null {
  if (!body.trim()) return "Enter a message.";
  if (body.includes("\0") || /\p{Cs}/u.test(body)) return "Message must contain valid Unicode without NUL characters.";
  if (new TextEncoder().encode(body).length > 16384) return "Message exceeds 16 KiB.";
  return null;
}
export async function supervisorDigest(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${Array.from(new Uint8Array(hash), v => v.toString(16).padStart(2, "0")).join("")}`;
}
function common(v: Record<string, unknown>, expected?: Conversation | string) {
  check(v.contract === SUPERVISOR_CONTRACT);
  shape(v.conversation, "id revision label"); shape(v.runtime, "state binding reason");
  const c = v.conversation;
  check(supervisorId(c.id) && decimal(c.revision) && c.label === "Global supervisor");
  if (expected) check(c.id === (typeof expected === "string" ? expected : expected.id));
  if (expected && typeof expected !== "string") check(c.revision === expected.revision);
  check(v.runtime.state === "unavailable" && v.runtime.binding === null && v.runtime.reason === "central_runtime_not_connected");
}
export function adaptSupervisorDiscovery(v: unknown): Discovery {
  shape(v, "contract conversation runtime limits"); common(v);
  shape(v.limits, "body_bytes context_refs attachments history_page");
  check(v.limits.body_bytes === 16384 && v.limits.context_refs === 0 && v.limits.attachments === 0 && v.limits.history_page === 16);
  return v as unknown as Discovery;
}
export async function adaptSupervisorHistory(v: unknown, expected: Conversation, page: { before?: string; after?: string } = {}): Promise<History> {
  shape(v, "contract conversation runtime direction through_cursor items next_cursor has_more"); common(v, expected);
  check(v.direction === (page.after !== undefined ? "forward" : "backward") && decimal(v.through_cursor, true) && typeof v.has_more === "boolean");
  check(Array.isArray(v.items) && v.items.length <= 16 && (v.next_cursor === null || decimal(v.next_cursor)));
  let previous = 0n; const ids = new Set();
  for (const item of v.items) {
    shape(item, "message_id thread_id conversation_id cursor author body body_digest created_at_ms logical_admission host_delivery agent_receipt");
    check(supervisorId(item.message_id) && !ids.has(item.message_id) && item.thread_id === expected.id && item.conversation_id === expected.id && decimal(item.cursor));
    const cursor = BigInt(item.cursor); check(cursor > previous && cursor <= BigInt(v.through_cursor));
    if (page.before !== undefined) check(cursor < BigInt(page.before));
    if (page.after !== undefined) check(cursor > BigInt(page.after));
    previous = cursor; ids.add(item.message_id);
    shape(item.author, "kind user_id"); check(item.author.kind === "human" && supervisorId(item.author.user_id));
    check(typeof item.body === "string" && !validateSupervisorText(item.body) && digest(item.body_digest) && await supervisorDigest(item.body) === item.body_digest);
    check(typeof item.created_at_ms === "number" && Number.isSafeInteger(item.created_at_ms) && item.created_at_ms > 0 && item.created_at_ms <= 8640000000000000);
    check(item.logical_admission === "queued" && item.host_delivery === "not_attempted" && item.agent_receipt === null);
  }
  if (v.has_more) check(v.items.length > 0 && v.next_cursor === (v.direction === "backward" ? v.items[0].cursor : v.items.at(-1).cursor));
  else check(v.next_cursor === null);
  return v as unknown as History;
}
export async function freezeSupervisorMessage(c: Conversation, actor: string, body: string): Promise<FrozenSupervisorMessage> {
  check(supervisorId(c.id) && decimal(c.revision) && supervisorId(actor) && !validateSupervisorText(body));
  const operation = crypto.randomUUID(), message = crypto.randomUUID(); check(operation !== message);
  // Closed Create has ASCII keys. This insertion order is recursively sorted canonical JSON.
  const bytes = JSON.stringify({ attachments: [], body, context: [], expected_conversation_revision: c.revision, message_id: message, operation_id: operation });
  check(new TextEncoder().encode(bytes).length <= 131072);
  return Object.freeze({ conversation: c.id, revision: c.revision, actor, operation, message, bytes, requestDigest: await supervisorDigest(bytes), bodyDigest: await supervisorDigest(body) });
}
export function adaptSupervisorReceipt(v: unknown, expected: { conversation: string; actor: string; operation: string; message: string; frozen?: FrozenSupervisorMessage }): Receipt {
  shape(v, "contract conversation runtime operation_id message_id actor_id request_digest body_digest state cursor reason host_delivery agent_receipt"); common(v, expected.conversation);
  check(v.operation_id === expected.operation && supervisorId(v.operation_id) && v.message_id === expected.message && supervisorId(v.message_id) && v.actor_id === expected.actor && supervisorId(v.actor_id));
  check(digest(v.request_digest) && digest(v.body_digest) && v.host_delivery === "not_attempted" && v.agent_receipt === null);
  if (expected.frozen) check(v.request_digest === expected.frozen.requestDigest && v.body_digest === expected.frozen.bodyDigest);
  if (v.state === "queued") { check(decimal(v.cursor) && v.reason === null); if (expected.frozen) check((v.conversation as Conversation).revision === expected.frozen.revision); }
  else check(v.state === "not_queued" && v.cursor === null && ["conversation_revision_changed", "message_id_conflict"].includes(String(v.reason)));
  return v as unknown as Receipt;
}
/** Duplicate identities or cursors must never replace already inspected history. */
export function mergeSupervisorMessages(current: SupervisorMessage[], incoming: SupervisorMessage[]): SupervisorMessage[] {
  const byId = new Map(current.map(item => [item.message_id, item]));
  for (const item of incoming) { const old = byId.get(item.message_id); check(!old || (old.cursor === item.cursor && old.thread_id === item.thread_id && old.conversation_id === item.conversation_id && old.author.kind === item.author.kind && old.author.user_id === item.author.user_id && old.body === item.body && old.body_digest === item.body_digest && old.created_at_ms === item.created_at_ms && old.logical_admission === item.logical_admission && old.host_delivery === item.host_delivery && old.agent_receipt === item.agent_receipt)); byId.set(item.message_id, item); }
  const messages = [...byId.values()].sort((a, b) => BigInt(a.cursor) < BigInt(b.cursor) ? -1 : 1);
  check(new Set(messages.map(item => item.cursor)).size === messages.length);
  return messages;
}
