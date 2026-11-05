import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, freezeSupervisorMessage, mergeSupervisorMessages, validateSupervisorText } from "./supervisor";
import { supervisorDiscovery as discovery, supervisorHistory, supervisorMessage, supervisorReceipt, supervisorReply as supervisorReplyFixture, supervisorActor, supervisorId, textDigest } from "../../test/supervisor";
beforeEach(() => vi.stubGlobal("crypto", webcrypto)); afterEach(() => vi.unstubAllGlobals());
test("freezes canonical exact text-only intent with independent stable IDs and decoded body digest", async () => {
  const frozen = await freezeSupervisorMessage(discovery.conversation, supervisorActor, "Original 😀\nmessage");
  const raw = JSON.parse(frozen.bytes);
  expect(raw).toEqual({ operation_id: frozen.operation, message_id: frozen.message, expected_conversation_revision: "1", body: "Original 😀\nmessage", context: [], attachments: [] });
  expect(frozen.operation).not.toBe(frozen.message); expect(Object.isFrozen(frozen)).toBe(true);
  expect(frozen.requestDigest).toBe(textDigest(frozen.bytes)); expect(frozen.bodyDigest).toBe(textDigest(raw.body));
  expect(adaptSupervisorReceipt(supervisorReceipt(frozen.bytes), { ...frozen, frozen })).toMatchObject({ state: "queued", host_delivery: "not_attempted" });
});
test("bounds decoded UTF8 text and rejects invalid Unicode/NUL/blank messages", () => {
  expect(validateSupervisorText("😀".repeat(4096))).toBeNull(); expect(validateSupervisorText("😀".repeat(4097))).not.toBeNull();
  for (const text of ["", " \n", "a\0b", "a\ud800b", "\udfff"]) expect(validateSupervisorText(text)).not.toBeNull();
});
test("discovery accepts the available runtime binding and schema limits, rejecting malformed runtimes and other limits", () => {
  expect(adaptSupervisorDiscovery(discovery)).toEqual(discovery);
  const available = { ...discovery, runtime: { state: "available", binding: { actor_id: supervisorId(7), generation: 2, session_id: supervisorId(8) }, reason: "central_session_active" } };
  expect(adaptSupervisorDiscovery(available).runtime).toEqual(available.runtime);
  for (const raw of [{ ...discovery, runtime: { state: "available", binding: "worker" } }, { ...available, runtime: { ...available.runtime, reason: "central_runtime_not_connected" } },
    { ...available, runtime: { ...available.runtime, binding: { ...available.runtime.binding, generation: 0 } } }, { ...discovery, runtime: { state: "unavailable", binding: available.runtime.binding, reason: "central_runtime_not_connected" } },
    { ...discovery, limits: { ...discovery.limits, attachments: 5 } }]) expect(() => adaptSupervisorDiscovery(raw)).toThrow();
});
test("discovery limits are maxima: a server may advertise lower bounds and disable context refs and attachments with 0", async () => {
  // Pinned E0 build (dashboard-refresh-c0a7399) advertises context_refs:0 and attachments:0.
  const disabled = { ...discovery, limits: { body_bytes: 16384, context_refs: 0, attachments: 0, history_page: 16 } };
  expect(adaptSupervisorDiscovery(disabled).limits).toEqual(disabled.limits);
  const lower = { ...discovery, limits: { body_bytes: 1024, context_refs: 3, attachments: 1, history_page: 8 } };
  expect(adaptSupervisorDiscovery(lower).limits).toEqual(lower.limits);
  for (const limits of [{ body_bytes: 16385 }, { body_bytes: 0 }, { context_refs: 17 }, { context_refs: -1 }, { attachments: 1.5 }, { attachments: "0" }, { history_page: 0 }, { history_page: 17 }])
    expect(() => adaptSupervisorDiscovery({ ...discovery, limits: { ...discovery.limits, ...limits } })).toThrow();
  expect(() => adaptSupervisorDiscovery({ ...discovery, limits: { body_bytes: 16384, context_refs: 0, attachments: 0 } })).toThrow();
  const refs = { context: [{ type: "task" as const, id: supervisorId(30), revision: "3" }], attachments: [{ id: supervisorId(40), digest: textDigest("x") }] };
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "x", { limits: disabled.limits, context: refs.context })).rejects.toThrow();
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "x", { limits: disabled.limits, attachments: refs.attachments })).rejects.toThrow();
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "Text only", { limits: disabled.limits })).resolves.toMatchObject({ bytes: expect.stringContaining('"attachments":[]') });
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "x".repeat(1025), { limits: lower.limits })).rejects.toThrow();
});
test("history accepts an available runtime and echoes human context refs and attachment descriptors", async () => {
  const runtime = { state: "available", binding: { actor_id: supervisorId(7), generation: 1, session_id: supervisorId(8) }, reason: "central_session_active" } as const;
  const context = [{ type: "task", id: supervisorId(30), revision: "3" }, { type: "project", id: supervisorId(31), revision: null }] as const;
  const attachments = [{ id: supervisorId(40), name: "notes.md", media_type: "text/markdown", size_bytes: 12, digest: textDigest("x") }] as const;
  const item = { ...supervisorMessage(1), context, attachments } as never;
  await expect(adaptSupervisorHistory(supervisorHistory([item], { runtime }), discovery.conversation)).resolves.toMatchObject({ runtime, items: [{ context, attachments }] });
  const bad = [{ context: [] }, { attachments: [] }, { context: [context[0], context[0]] }, { context: [{ ...context[0], type: "repo" }] }, { attachments: [{ ...attachments[0], name: "../x" }] },
    { attachments: [{ ...attachments[0], media_type: "text/html" }] }, { attachments: [{ ...attachments[0], size_bytes: 1048577 }] }, { attachments: Array.from({ length: 5 }, (_, n) => ({ ...attachments[0], id: supervisorId(50 + n) })) }];
  for (const extra of bad) await expect(adaptSupervisorHistory(supervisorHistory([{ ...supervisorMessage(1), ...extra } as never]), discovery.conversation)).rejects.toThrow();
  expect(() => mergeSupervisorMessages([item], [{ ...(item as object), attachments: [] } as never])).toThrow();
});
test("freezes context and attachment refs into canonical create bytes within discovery limits", async () => {
  const context = [{ type: "task" as const, id: supervisorId(30), revision: "3" }], attachments = [{ id: supervisorId(40), digest: textDigest("x") }];
  const frozen = await freezeSupervisorMessage(discovery.conversation, supervisorActor, "With refs", { limits: discovery.limits, context, attachments });
  expect(JSON.parse(frozen.bytes)).toMatchObject({ context, attachments });
  expect(frozen.bytes.indexOf('"attachments"')).toBeLessThan(frozen.bytes.indexOf('"body"')); expect(frozen.requestDigest).toBe(textDigest(frozen.bytes));
  const tight = { ...discovery.limits, attachments: 0 };
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "x", { limits: tight, attachments })).rejects.toThrow();
  await expect(freezeSupervisorMessage(discovery.conversation, supervisorActor, "x", { limits: discovery.limits, attachments: [...attachments, ...attachments] })).rejects.toThrow();
});
test("not-queued receipts may report attachment_unavailable; receipts never carry a live runtime", async () => {
  const frozen = await freezeSupervisorMessage(discovery.conversation, supervisorActor, "Attachment gone"); const expected = { ...frozen, frozen };
  const receipt = { ...supervisorReceipt(frozen.bytes, "not_queued"), reason: "attachment_unavailable" as const };
  expect(adaptSupervisorReceipt(receipt, expected).reason).toBe("attachment_unavailable");
  expect(() => adaptSupervisorReceipt({ ...receipt, reason: "attachment_missing" }, expected)).toThrow();
  expect(() => adaptSupervisorReceipt({ ...receipt, runtime: { state: "available", binding: { actor_id: supervisorId(7), generation: 1, session_id: supervisorId(8) }, reason: "central_session_active" } }, expected)).toThrow();
});
test("supervisor replies on A.R cursors validate optional attachments", async () => {
  const reply = supervisorReplyFixture();
  await expect(adaptSupervisorHistory(supervisorHistory([supervisorMessage(1), { ...reply, attachments: [] }] as never, { through_cursor: "1" }), discovery.conversation)).resolves.toMatchObject({ items: [{ cursor: "1" }, { cursor: "1.1", attachments: [] }] });
  const receipt = { type: "action_receipt", message_id: reply.message_id, operation_id: supervisorId(60), kind: "task.create", project_id: supervisorId(61), project_revision: "2", created_task_ids: [supervisorId(62)], created_edge_ids: [], receipt_refs: [{ type: "task", id: supervisorId(62) }], request_digest: textDigest("r") };
  await expect(adaptSupervisorHistory(supervisorHistory([{ ...reply, attachments: [receipt] }] as never, { through_cursor: "1" }), discovery.conversation)).resolves.toMatchObject({ items: [{ attachments: [receipt] }] });
  for (const attachments of [[receipt, receipt], [{ ...receipt, message_id: supervisorId(1) }], [{ ...receipt, created_task_ids: [] }], [{ ...receipt, type: "file" }]])
    await expect(adaptSupervisorHistory(supervisorHistory([{ ...reply, attachments }] as never, { through_cursor: "1" }), discovery.conversation)).rejects.toThrow();
  await expect(adaptSupervisorHistory(supervisorHistory([{ ...supervisorMessage(1), attachments: [receipt] }] as never), discovery.conversation)).rejects.toThrow();
});
test("validates chronological cursor boundaries and exact message body/identity", async () => {
  const items = [supervisorMessage(2), supervisorMessage(3)];
  await expect(adaptSupervisorHistory(supervisorHistory(items, { has_more: true, next_cursor: "2" }), discovery.conversation, { before: "4" })).resolves.toMatchObject({ items });
  for (const item of [{ ...items[0]!, conversation_id: supervisorId(8) }, { ...items[0]!, thread_id: supervisorId(8) }, { ...items[0]!, body: "changed" }, { ...items[0]!, author: { kind: "assistant", user_id: supervisorActor } }]) {
    await expect(adaptSupervisorHistory(supervisorHistory([item] as never), discovery.conversation)).rejects.toThrow();
  }
  await expect(adaptSupervisorHistory(supervisorHistory([...items].reverse()), discovery.conversation)).rejects.toThrow();
  await expect(adaptSupervisorHistory(supervisorHistory(items), discovery.conversation, { after: "2" })).rejects.toThrow();
  await expect(adaptSupervisorHistory(supervisorHistory(items, { has_more: true, next_cursor: "3" }), discovery.conversation)).rejects.toThrow();
});
test("receipts bind actor, conversation, operation, message and both digests", async () => {
  const frozen = await freezeSupervisorMessage(discovery.conversation, supervisorActor, "A retained request"); const receipt = supervisorReceipt(frozen.bytes);
  const expected = { ...frozen, frozen };
  for (const field of ["actor_id", "operation_id", "message_id"] as const) expect(() => adaptSupervisorReceipt({ ...receipt, [field]: supervisorId(9) }, expected)).toThrow();
  for (const field of ["body_digest", "request_digest"] as const) expect(() => adaptSupervisorReceipt({ ...receipt, [field]: textDigest("other") }, expected)).toThrow();
  expect(() => adaptSupervisorReceipt({ ...receipt, state: "not_queued" }, expected)).toThrow();
  expect(adaptSupervisorReceipt(supervisorReceipt(frozen.bytes, "not_queued"), expected).state).toBe("not_queued");
});
test("history merging refuses changed or aliased records instead of replacing inspected facts", () => {
  const first = supervisorMessage(); expect(mergeSupervisorMessages([first], [first, supervisorMessage(2)])).toHaveLength(2);
  expect(() => mergeSupervisorMessages([first], [{ ...first, body: "changed" }])).toThrow();
  expect(() => mergeSupervisorMessages([first], [{ ...supervisorMessage(2), cursor: first.cursor }])).toThrow();
});

test("renders F1b replies with composite cursors and permits delivery evidence to advance", async () => {
  const human = supervisorMessage(1);
  const body = "Actual supervisor reply";
  const reply = { ...supervisorMessage(2, body), cursor: "1.1", author: { kind: "supervisor", actor_id: supervisorId(8), generation: 1, session_id: supervisorId(9) }, dispatch: { dispatch_id: supervisorId(10), host_operation_id: supervisorId(11), batch_digest: "a".repeat(64) } };
  const history = supervisorHistory([human, reply] as never, { through_cursor: "1", has_more: true, next_cursor: "1.1", direction: "forward" });
  await expect(adaptSupervisorHistory(history, discovery.conversation, { after: "0" })).resolves.toMatchObject({ next_cursor: "1.1" });
  await expect(adaptSupervisorHistory(supervisorHistory([reply] as never, { through_cursor: "1" }), discovery.conversation, { before: "1.2" })).resolves.toMatchObject({ items: [reply] });
  expect(mergeSupervisorMessages([human], [{ ...human, host_delivery: "delivered" } as never])[0]?.host_delivery).toBe("delivered");
});
