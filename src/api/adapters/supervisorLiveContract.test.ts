import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import rawCreate from "../../../contracts/live/supervisor-conversation/create.example.json";
import rawDiscovery from "../../../contracts/live/supervisor-conversation/discovery.example.json";
import rawHistory from "../../../contracts/live/supervisor-conversation/history.example.json";
import rawReceipt from "../../../contracts/live/supervisor-conversation/receipt.example.json";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, supervisorDigest, type FrozenSupervisorMessage } from "./supervisor";

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
