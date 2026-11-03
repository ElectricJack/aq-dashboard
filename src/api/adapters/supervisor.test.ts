import { webcrypto } from "node:crypto";
import { vi } from "vitest";
import { adaptSupervisorDiscovery, adaptSupervisorHistory, adaptSupervisorReceipt, freezeSupervisorMessage, mergeSupervisorMessages, validateSupervisorText } from "./supervisor";
import { supervisorDiscovery as discovery, supervisorHistory, supervisorMessage, supervisorReceipt, supervisorActor, supervisorId, textDigest } from "../../test/supervisor";
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
test("discovery never accepts live runtime or expanded attachment/context support", () => {
  expect(adaptSupervisorDiscovery(discovery)).toEqual(discovery);
  for (const raw of [{ ...discovery, runtime: { state: "available", binding: "worker" } }, { ...discovery, limits: { ...discovery.limits, context_refs: 1 } }]) expect(() => adaptSupervisorDiscovery(raw)).toThrow();
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
