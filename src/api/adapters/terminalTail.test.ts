import { adaptTerminalTail, adaptWatch, literalTail, terminalIdentity } from "./terminalTail";
import type { TerminalIdentity } from "../wire/terminalTail";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const terminal: TerminalIdentity = { terminal_id: id(1), epoch: 1, session: { kind: "remote", node_id: id(2), boot_id: id(3), attempt_id: id(4), assignment_generation: 1, session_id: id(5) } };
export const subscription = id(6);
export async function frame(sequence = 1, text = "hello") {
  const bytes = [...new TextEncoder().encode(text)];
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return { terminal, sequence, byte_length: bytes.length, bytes, digest: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") };
}
export function tail() { return { terminal, subscription_id: subscription, session_revision: 1, expires_at_ms: 20000, server_time_ms: 10000, last_observed_at_ms: 9999, availability: "resident_tail", disconnected: false, initial_incomplete: true, frames: [], gaps: [], next_sequence: 0, more: false }; }

test("accepts exact identities and refuses unknown/nil/unsafe epochs", () => {
  expect(terminalIdentity(terminal)).toEqual(terminal);
  for (const v of [{ ...terminal, epoch: Number.MAX_SAFE_INTEGER + 1 }, { ...terminal, session: { ...terminal.session, kind: "elsewhere" } }, { ...terminal, terminal_id: "00000000-0000-0000-0000-000000000000" }]) expect(() => terminalIdentity(v)).toThrow();
});
test("Watch ACK must match exact mutation, epoch, and subscription", () => {
  const b = { terminal, operation_id: subscription, subscription_id: subscription, session_revision: 1, expires_at_ms: 20000 };
  expect(adaptWatch({ kind: "watch", body: b }, terminal, subscription).subscription_id).toBe(subscription);
  expect(() => adaptWatch({ kind: "watch", body: { ...b, terminal: { ...terminal, epoch: 2 } } }, terminal, subscription)).toThrow();
});
test("validates bytes/digest/order/cursor and full64KiB frame", async () => {
  const f = await frame(1, "x".repeat(65536));
  const page = { ...tail(), frames: [f], next_sequence: 1 };
  await expect(adaptTerminalTail(page, terminal, subscription, 0)).resolves.toEqual(page);
  for (const changed of [{ ...page, next_sequence: 0 }, { ...page, frames: [{ ...f, digest: "0".repeat(64) }] }, { ...page, frames: [{ ...f, bytes: [256] }] }, { ...page, frames: [f, f] }, { ...page, subscription_id: id(7) }, { ...page, initial_incomplete: false }, { ...page, availability: "not_retained" }]) await expect(adaptTerminalTail(changed, terminal, subscription, 0)).rejects.toThrow();
});
test("not retained is distinct from empty resident output; gaps keep exact identity", async () => {
  await expect(adaptTerminalTail({ ...tail(), availability: "not_retained" }, terminal, subscription, 0)).resolves.toBeDefined();
  await expect(adaptTerminalTail({ ...tail(), gaps: [{ terminal: { ...terminal, epoch: 2 }, first_missing: 1, last_missing: 3 }] }, terminal, subscription, 0)).rejects.toThrow();
});
test("literal rendering escapes ANSI, carriage return and bidi while preserving text/newlines", () => {
  const text = "<script>x</script>\x1b[2J\r\u202e中🙂\nnext";
  expect(literalTail([...new TextEncoder().encode(text)])).toBe("<script>x</script>\\u001b[2J\\u000d\\u202e中🙂\nnext");
});
