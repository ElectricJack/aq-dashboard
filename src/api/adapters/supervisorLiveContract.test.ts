import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import rawCreate from "../../../contracts/live/supervisor-conversation/create.example.json";
import rawDiscovery from "../../../contracts/live/supervisor-conversation/discovery.example.json";
import rawHistory from "../../../contracts/live/supervisor-conversation/history.example.json";
import rawAttachmentHistory from "../../../contracts/live/supervisor-conversation/history-attachments.example.json";
import rawMixed from "../../../contracts/live/supervisor-conversation/mixed-history.fixture.json";
import rawReceipt from "../../../contracts/live/supervisor-conversation/receipt.example.json";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import rawUpload from "../../../contracts/live/supervisor-conversation/attachment-upload.example.json";
import rawAttachmentError from "../../../contracts/live/supervisor-conversation/attachment-error.example.json";
import { adaptSupervisorAttachmentError, adaptSupervisorAttachmentUpload, adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, canonicalSupervisorJson, supervisorDigest, type Conversation, type FrozenSupervisorMessage, type ProposedTaskDraft, type SupervisorAttachment } from "./supervisor";

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
    // A drafted task may name its role (aq-server spec 0014); `profile_hint` no longer exists and fails the read like any unknown key.
    const drafted = async (extra: Record<string, unknown>) => {
      const next = structuredClone(rawAttachmentHistory) as unknown as { items: { attachments?: { payload_digest: string; payload: { tasks: Record<string, unknown>[] } }[] }[] };
      const draft = next.items[1]!.attachments![0]!;
      Object.assign(draft.payload.tasks[0]!, extra);
      draft.payload_digest = await supervisorDigest(canonicalSupervisorJson(draft.payload));
      return adaptSupervisorHistory(next, conversation);
    };
    const withRole = (await drafted({ role: "reviewer" })).items[1]!.attachments![0] as ProposedTaskDraft;
    expect(withRole.payload.tasks[0]!.role).toBe("reviewer");
    await expect(drafted({ role: null })).resolves.toBeDefined();
    await expect(drafted({ role: "" })).rejects.toThrow();
    await expect(drafted({ profile_hint: "coding" })).rejects.toThrow();
    const foreign = structuredClone(rawAttachmentHistory) as { items: { attachments?: { message_id?: string }[] }[] };
    foreign.items[1]!.attachments![1]!.message_id = rawAttachmentHistory.items[0]!.message_id;
    await expect(adaptSupervisorHistory(foreign, conversation)).rejects.toThrow();
  } finally { vi.unstubAllGlobals(); }
});

test("the pinned schema.json matches the digest recorded in source.json", () => {
  const dir = "contracts/live/supervisor-conversation/";
  const source = JSON.parse(readFileSync(`${dir}source.json`, "utf8")) as { commit: string; sha256: string };
  expect(source.commit).toBe("7206f5a1f1f2527f1a3afef476259cf621760a8c");
  expect(createHash("sha256").update(readFileSync(`${dir}schema.json`)).digest("hex")).toBe(source.sha256);
  expect(source.sha256).toBe("eda588e205779a11b74a319628f603a55e311358b3de345200d87fe6031f3ed3");
});

test("consumes the published attachment discovery capability, upload receipt and structured refusal", () => {
  const discovery = adaptSupervisorDiscovery(rawDiscovery);
  expect(discovery.attachments).toMatchObject({ max_file_bytes: 1048576, max_files_per_message: 4, max_name_bytes: 255 });
  expect(discovery.attachments!.media_types).toContain("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const upload = adaptSupervisorAttachmentUpload(rawUpload, { conversation: rawUpload.conversation_id, attachment: rawUpload.id });
  expect(upload).toMatchObject({ state: "staged", message_id: null, media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
  expect(() => adaptSupervisorAttachmentUpload(rawUpload, { conversation: rawUpload.conversation_id, attachment: "00000000-0000-0000-0000-000000000009" })).toThrow();
  expect(() => adaptSupervisorAttachmentUpload({ ...rawUpload, media_type: "application/zip" }, { conversation: rawUpload.conversation_id, attachment: rawUpload.id })).toThrow();
  expect(() => adaptSupervisorAttachmentUpload({ ...rawUpload, state: "attached" }, { conversation: rawUpload.conversation_id, attachment: rawUpload.id })).toThrow();
  expect(adaptSupervisorAttachmentError(rawAttachmentError)).toEqual(rawAttachmentError);
  expect(adaptSupervisorAttachmentError({ error: "forbidden", message: "x" })).toBeNull();
  expect(adaptSupervisorAttachmentError({ error: "attachment_too_large", message: "x", extra: 1 })).toBeNull();
  // Closed capability: an unknown media type or an over-ceiling limit is a contract failure, not a silently larger limit.
  for (const bad of [{ media_types: ["application/zip"] }, { max_file_bytes: 1048577 }, { max_files_per_message: 5 }, { media_types: [] }])
    expect(() => adaptSupervisorDiscovery({ ...rawDiscovery, attachments: { ...rawDiscovery.attachments, ...bad } })).toThrow();
});
