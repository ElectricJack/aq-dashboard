// Labelled, disposable HTTP test double for G8 compiled-browser proof. No provider or worker.
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, extname } from "node:path";
import { createHash, randomUUID } from "node:crypto";
const root = resolve("dist"), port = Number(process.env.AQ_FIXTURE_PORT ?? 4196);
const read = path => JSON.parse(readFileSync(path, "utf8"));
const hash = bytes => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}` : JSON.stringify(value);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const bootstrap = read("contracts/pinned/dashboard-read/v1/fixtures/bootstrap.json");
const requirements = read("src/app/bundle-requirements.json");
bootstrap.data.principal = { id: id(4), display_name: "G8 labelled fixture owner", authorization_revision: "1" };
bootstrap.data.product.dashboard_digest = hash(readFileSync("dist/dashboard-manifest.json"));
const enabled = ["supervisor.history.read", "supervisor.conversation", "supervisor.message.enqueue", "dashboard.actions", "dashboard.overview", "projects.read"];
bootstrap.data.capabilities = [...new Set([...requirements.required_capabilities, ...enabled])].map(name => ({ name, version: "1", enabled: enabled.includes(name), reason: "Labelled G8 test double" }));
bootstrap.data.global_supervisor = { status: "available", conversation_id: id(1) };
const discovery = { contract: "human-supervisor-conversation-1", conversation: { id: id(1), revision: "1", label: "Global supervisor" }, runtime: { state: "unavailable", binding: null, reason: "central_runtime_not_connected" }, limits: { body_bytes: 16384, attachments: 4, context_refs: 16, history_page: 16 } };
const message = (cursor, body, messageId = randomUUID()) => ({ message_id: messageId, thread_id: id(1), conversation_id: id(1), cursor, author: { kind: "human", user_id: id(4) }, body, body_digest: hash(body), created_at_ms: Date.now(), logical_admission: "queued", host_delivery: "delivered", agent_receipt: null });
const reply = (anchor, body) => ({ ...message(`${anchor}.1`, body), author: { kind: "supervisor", actor_id: id(7), generation: 1, session_id: id(8) }, dispatch: { dispatch_id: randomUUID(), host_operation_id: randomUUID(), batch_digest: "a".repeat(64) }, host_delivery: "not_attempted" });
const items = [message("1", "[Fixture] What should I look at first?"), reply("1", "[Fixture] Review the pending recovery plan. You can inspect its evidence before deciding."), message("2", "[Fixture] Keep the global conversation available while I inspect work."), reply("2", "[Fixture] This conversation stays the same across projects and presentations.")];
let anchor = 2;
const operations = new Map();
const compare = (a, b) => { const [aa, ar = "0"] = a.split("."), [ba, br = "0"] = b.split("."); return BigInt(aa) < BigInt(ba) ? -1 : BigInt(aa) > BigInt(ba) ? 1 : BigInt(ar) < BigInt(br) ? -1 : BigInt(ar) > BigInt(br) ? 1 : 0; };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  const json = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(data)); };
  if (url.pathname === "/api/v1/bootstrap") return json(bootstrap);
  if (url.pathname === "/api/human/conversations/global") return json(discovery);
  if (url.pathname === `/api/human/conversations/${id(1)}/messages`) {
    const before = url.searchParams.get("before"), after = url.searchParams.get("after"), limit = Math.min(Number(url.searchParams.get("limit") ?? 16), 16);
    let page = items.filter(item => (!before || compare(item.cursor, before) < 0) && (after === null || compare(item.cursor, after) > 0));
    const more = page.length > limit; page = after !== null ? page.slice(0, limit) : page.slice(-limit);
    return json({ ...discovery, limits: undefined, direction: after !== null ? "forward" : "backward", through_cursor: String(anchor), items: page, has_more: more, next_cursor: more ? (after !== null ? page.at(-1).cursor : page[0].cursor) : null });
  }
  if (url.pathname === "/api/v1/actions" && req.method === "POST") {
    let bytes = ""; for await (const chunk of req) bytes += chunk;
    const request = JSON.parse(bytes); const old = operations.get(request.operation_id);
    if (old) return json(old.value);
    const value = { api_version: "dashboard-actions-1", data: { operation_id: request.operation_id, disposition: "pending", request_digest: hash(canonical({ request, scope: { kind: "all_authorized" } })), scope: { kind: "all_authorized" }, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), subject_refs: [request.subject], receipt_refs: [], affected_entities: [], recovery: "lookup_original" } };
    operations.set(request.operation_id, { request, value }); return json(value, 202);
  }
  if (url.pathname.startsWith("/api/v1/operations/")) {
    const operation = operations.get(url.pathname.split("/").at(-1)); if (!operation) return json({}, 404);
    if (operation.value.data.disposition === "pending") {
      const { request, value } = operation; anchor++;
      items.push(message(String(anchor), request.payload.body, request.payload.message_id), reply(String(anchor), "[Fixture] Probe reply received. No work was created."));
      Object.assign(value.data, { disposition: "confirmed", receipt_refs: [{ type: "mailbox_operation", id: request.operation_id }], affected_entities: [{ type: "message", id: request.payload.message_id, revision: "1" }], recovery: "none" });
    }
    return json(operation.value);
  }
  if (url.pathname === "/api/v1/overview") return json(read("contracts/pinned/dashboard-read/v1/fixtures/overview-nonempty.json"));
  if (url.pathname === "/api/v1/projects") return json(read("contracts/pinned/dashboard-read/v1/fixtures/projects.json"));
  if (url.pathname.startsWith("/api/")) return json({ message: "Unavailable in labelled G8 fixture" }, 503);
  const path = resolve(root, `.${url.pathname === "/" ? "/index.html" : url.pathname}`);
  const file = path.startsWith(`${root}/`) && existsSync(path) ? path : resolve(root, "index.html");
  res.writeHead(200, { "Content-Type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" })[extname(file)] ?? "application/octet-stream" }); res.end(readFileSync(file));
});
server.listen(port, "127.0.0.1", () => console.log(`Labelled G8 fixture serving compiled dist at http://127.0.0.1:${port}`));
