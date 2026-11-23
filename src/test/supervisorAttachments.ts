import { createHash } from "node:crypto";
import { http, HttpResponse } from "msw";
import type { setupServer } from "msw/node";
import bootstrap from "../../contracts/proposed/bootstrap.json";
import rawDiscovery from "../../contracts/live/supervisor-conversation/discovery.example.json";
import { supervisorActor, supervisorDiscovery, supervisorHistory, supervisorMessage, supervisorActionReceipt } from "./supervisor";
import { compareSupervisorCursors, type AttachmentDescriptor, type AttachmentUpload, type SupervisorMessage } from "../api/adapters/supervisor";

const discovery = { ...supervisorDiscovery, attachments: rawDiscovery.attachments };
const base = `/api/human/conversations/${discovery.conversation.id}`;
type Stored = { upload: AttachmentUpload; bytes: Uint8Array; contentType: string; csrf: string | null };
type Options = { attachments?: boolean; maxFiles?: number; history?: SupervisorMessage[]; putStatus?: (n: number) => { status: number; body: object } | null; deleteStatus?: number };
function attachmentStore(options: Options) {
  const staged = new Map<string, Stored>(), stored = [...(options.history ?? [])], posts: string[] = [], puts: { id: string; name: string | null; contentType: string; size: number; csrf: string | null }[] = [], deletes: string[] = [];
  return { staged, stored, posts, puts, deletes };
}

type Store = ReturnType<typeof attachmentStore>;

function discoveryHandlers(options: Options) {
  const caps = options.attachments === false ? undefined : { ...rawDiscovery.attachments, ...(options.maxFiles ? { max_files_per_message: options.maxFiles } : {}) };
  const { attachments: _drop, ...plain } = discovery; void _drop;
  return [
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, global_supervisor: { status: "available", conversation_id: discovery.conversation.id }, principal: { ...bootstrap.data.principal, id: supervisorActor }, capabilities: [
      ...bootstrap.data.capabilities.filter(cap => !["supervisor.history.read", "supervisor.message.enqueue", "supervisor.conversation"].includes(cap.name)),
      { name: "dashboard.actions", version: "1", enabled: true }, { name: "supervisor.conversation", version: "1", enabled: true }, { name: "supervisor.history.read", version: "1", enabled: true }, { name: "supervisor.message.enqueue", version: "1", enabled: true },
    ] } })),
    http.get("/api/human/conversations/global", () => HttpResponse.json({ ...plain, ...(caps ? { attachments: caps, limits: { ...plain.limits, attachments: options.maxFiles ?? plain.limits.attachments } } : { limits: { ...plain.limits, attachments: 0 } }) })),
  ];
}

function historyHandler({ stored }: Store) {
  return http.get(`${base}/messages`, ({ request }) => {
      const url = new URL(request.url), before = url.searchParams.get("before"), after = url.searchParams.get("after");
      const items = stored.filter(item => (!before || compareSupervisorCursors(item.cursor, before) < 0) && (after === null || compareSupervisorCursors(item.cursor, after) > 0));
      return HttpResponse.json(supervisorHistory(items, { direction: after !== null ? "forward" : "backward", through_cursor: stored.at(-1)?.cursor.split(".")[0] ?? "0" }));
    });
}

function attachmentHandlers(store: Store, options: Options) {
  const { puts, deletes, staged } = store;
  let putCount = 0;
  return [
    http.put(`${base}/attachments/:id`, async ({ request, params }) => {
      const n = ++putCount, bytes = new Uint8Array(await request.arrayBuffer()), id = String(params.id), name = new URL(request.url).searchParams.get("name"), contentType = request.headers.get("content-type") ?? "";
      puts.push({ id, name, contentType, size: bytes.length, csrf: request.headers.get("x-aq-request") });
      const forced = options.putStatus?.(n); if (forced) return HttpResponse.json(forced.body, { status: forced.status });
      const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const upload: AttachmentUpload = { id, name: name!, media_type: contentType as AttachmentUpload["media_type"], size_bytes: bytes.length, digest, conversation_id: discovery.conversation.id, created_at_ms: 1000000, state: "staged", message_id: null, expires_at_ms: 87400000 };
      staged.set(id, { upload, bytes, contentType, csrf: request.headers.get("x-aq-request") });
      return HttpResponse.json(upload, { status: 201 });
    }),
    http.delete(`${base}/attachments/:id`, ({ params }) => { deletes.push(String(params.id)); if (options.deleteStatus) return HttpResponse.json({ error: "attachment_bound", message: "bound" }, { status: options.deleteStatus }); staged.delete(String(params.id)); return new HttpResponse(null, { status: 204 }); }),
  ];
}

function sendHandler({ stored, staged, posts }: Store) {
  return http.post("/api/v1/actions", async ({ request }) => {
      const bytes = await request.text(); posts.push(bytes); const payload = JSON.parse(bytes).payload as { body: string; message_id: string; attachments: { id: string; digest: string }[] };
      if (!payload.attachments.every(ref => staged.get(ref.id)?.upload.digest === ref.digest)) return HttpResponse.json(supervisorActionReceipt(bytes, "rejected"), { status: 409 });
      const item = supervisorMessage(stored.length + 1, payload.body); item.message_id = payload.message_id;
      if (payload.attachments.length) (item as { attachments?: AttachmentDescriptor[] }).attachments = payload.attachments.map(ref => { const { id, name, media_type, size_bytes, digest } = staged.get(ref.id)!.upload; return { id, name, media_type, size_bytes, digest }; });
      stored.push(item); return HttpResponse.json(supervisorActionReceipt(bytes));
    });
}

/** Raw upload bytes become digest-pinned descriptors which are bound when a message is sent. */
export function attachmentFixture(server: ReturnType<typeof setupServer>, options: Options = {}) {
  const store = attachmentStore(options);
  server.use(...discoveryHandlers(options), historyHandler(store), ...attachmentHandlers(store, options), sendHandler(store));
  return store;
}
