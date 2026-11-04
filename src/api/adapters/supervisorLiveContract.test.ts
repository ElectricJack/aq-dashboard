import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import rawCreate from "../../../contracts/live/supervisor-conversation/create.example.json";
import rawDiscovery from "../../../contracts/live/supervisor-conversation/discovery.example.json";
import rawHistory from "../../../contracts/live/supervisor-conversation/history.example.json";
import rawAttachmentHistory from "../../../contracts/live/supervisor-conversation/history-attachments.example.json";
import rawMixed from "../../../contracts/live/supervisor-conversation/mixed-history.fixture.json";
import rawReceipt from "../../../contracts/live/supervisor-conversation/receipt.example.json";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, supervisorDigest, type Conversation, type FrozenSupervisorMessage, type SupervisorAttachment } from "./supervisor";

test("consumes the frozen API07 public examples including independent canonical request/body digests", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    const discovery = adaptSupervisorDiscovery(rawDiscovery);
    expect(await adaptSupervisorHistory(rawHistory, discovery.conversation)).toMatchObject({ items: [] });
    const bytes = JSON.stringify(Object.fromEntries(Object.entries(rawCreate).sort(([a], [b]) => a.localeCompare(b))));
    const frozen: FrozenSupervisorMessage = { conversation: discovery.conversation.id, revision: rawCreate.expected_conversation_revision, actor: rawReceipt.actor_id,
      operation: rawCreate.operation_id, message: rawCreate.message_id, bytes, requestDigest: await supervisorDigest(bytes), bodyDigest: await supervisorDigest(rawCreate.body) };
    expect(adaptSupervisorReceipt(rawReceipt, { ...frozen, frozen })).toMatchObject({ state: "queued", host_delivery: "not_attempted", agent_receipt: null });
  } finally { vi.unstubAllGlobals(); }
});

test("F1b schema-derived labelled fixture retains human delivery and supervisor dispatch evidence", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    const discovery = adaptSupervisorDiscovery(rawDiscovery);
    const history = await adaptSupervisorHistory(rawMixed, discovery.conversation);
    expect(history.items.map(item => item.cursor)).toEqual(["1", "1.1"]);
    expect(history.items[0]).toMatchObject({ host_delivery: "delivered" });
    expect(history.items[1]).toMatchObject({ author: { kind: "supervisor" }, dispatch: { dispatch_id: "00000000-0000-4000-8000-000000000009" } });
  } finally { vi.unstubAllGlobals(); }
});

test("consumes the published attachment history: A.R reply with proposed draft and action receipt, payload digest verified", async () => {
  vi.stubGlobal("crypto", webcrypto);
  try {
    const discovery = adaptSupervisorDiscovery(rawDiscovery);
    expect(discovery.limits).toMatchObject({ context_refs: 16, attachments: 4 });
    const conversation = rawAttachmentHistory.conversation as Conversation;
    const history = await adaptSupervisorHistory(rawAttachmentHistory, conversation);
    const reply = history.items[1]!;
    expect(reply.cursor).toBe("1.1");
    expect((reply.attachments as SupervisorAttachment[] | undefined)?.map(a => a.type)).toEqual(["proposed_task_draft", "action_receipt"]);
    const tampered = structuredClone(rawAttachmentHistory) as { items: { attachments?: { payload_digest?: string }[] }[] };
    tampered.items[1]!.attachments![0]!.payload_digest = `sha256:${"0".repeat(64)}`;
    await expect(adaptSupervisorHistory(tampered, conversation)).rejects.toThrow();
    const foreign = structuredClone(rawAttachmentHistory) as { items: { attachments?: { message_id?: string }[] }[] };
    foreign.items[1]!.attachments![1]!.message_id = rawAttachmentHistory.items[0]!.message_id;
    await expect(adaptSupervisorHistory(foreign, conversation)).rejects.toThrow();
  } finally { vi.unstubAllGlobals(); }
});
