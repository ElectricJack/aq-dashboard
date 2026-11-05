// Labelled loopback test double reproducing the E0 supervisor discovery (context_refs:0, attachments:0). Not live qualification.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [bootstrapPath, port] = process.argv.slice(2);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, actor = id(4), conv = id(1);
const b = JSON.parse(readFileSync(bootstrapPath, "utf8"));
b.data.global_supervisor = { status: "available", conversation_id: conv };
b.data.principal = { ...b.data.principal, id: actor };
const extra = ["dashboard.actions", "supervisor.conversation", "supervisor.history.read", "supervisor.message.enqueue"];
b.data.capabilities = [...b.data.capabilities.filter(c => !extra.includes(c.name)), ...extra.map(name => ({ name, version: "1", enabled: true }))];
const runtime = { state: "unavailable", binding: null, reason: "central_runtime_not_connected" };
const conversation = { id: conv, revision: "1", label: "Global supervisor" };
const discovery = { contract: "human-supervisor-conversation-1", conversation, runtime, limits: { body_bytes: 16384, context_refs: 0, attachments: 0, history_page: 16 } };
const body = "[Fixture] E0-shaped discovery advertises context_refs:0 and attachments:0.";
const item = { message_id: id(101), thread_id: conv, conversation_id: conv, cursor: "1", author: { kind: "human", user_id: actor }, body, body_digest: `sha256:${createHash("sha256").update(body).digest("hex")}`, created_at_ms: 1793849000000, logical_admission: "queued", host_delivery: "not_attempted", agent_receipt: null };
const history = { contract: discovery.contract, conversation, runtime, direction: "backward", through_cursor: "1", items: [item], has_more: false, next_cursor: null };
createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const send = (status, value) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(value)); };
  if (path === "/api/v1/bootstrap") return send(200, b);
  if (path === "/api/human/conversations/global") return send(200, discovery);
  if (path === `/api/human/conversations/${conv}/messages`) return send(200, history);
  send(404, { error: "not in test double" });
}).listen(Number(port), "127.0.0.1");
