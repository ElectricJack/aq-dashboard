import { ContractError, isRecord } from "./contract";
import type { TerminalIdentity, TerminalTail } from "../wire/terminalTail";

function check(ok: unknown): asserts ok { if (!ok) throw new ContractError("Invalid terminal tail"); }
function integer(v: unknown, min = 0): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min; }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v); }
export function terminalIdentity(v: unknown): TerminalIdentity {
  check(isRecord(v) && uuid(v.terminal_id) && integer(v.epoch, 1) && isRecord(v.session));
  const s = v.session;
  check(uuid(s.session_id));
  if (s.kind === "remote") check(uuid(s.node_id) && uuid(s.boot_id) && uuid(s.attempt_id) && integer(s.assignment_generation, 1));
  else check(s.kind === "central" && uuid(s.authority_id) && integer(s.generation, 1));
  return v as TerminalIdentity;
}
export function sameTerminal(a: TerminalIdentity, b: TerminalIdentity): boolean {
  const x = a.session, y = b.session;
  return a.terminal_id === b.terminal_id && a.epoch === b.epoch && x.kind === y.kind && x.session_id === y.session_id &&
    (x.kind === "remote" && y.kind === "remote" ? x.node_id === y.node_id && x.boot_id === y.boot_id && x.attempt_id === y.attempt_id && x.assignment_generation === y.assignment_generation
      : x.kind === "central" && y.kind === "central" && x.authority_id === y.authority_id && x.generation === y.generation);
}
export function adaptTerminalInfo(v: unknown, id: string): { terminal: TerminalIdentity; session_revision: number } {
  check(isRecord(v));
  const terminal = terminalIdentity(v.terminal);
  check(terminal.terminal_id === id && integer(v.session_revision, 1));
  return { terminal, session_revision: v.session_revision };
}
export function adaptWatch(v: unknown, terminal: TerminalIdentity, operation: string) {
  check(isRecord(v) && v.kind === "watch" && isRecord(v.body));
  const b = v.body;
  check(sameTerminal(terminalIdentity(b.terminal), terminal) && b.operation_id === operation && uuid(b.subscription_id) && integer(b.session_revision, 1) && integer(b.expires_at_ms, 1));
  return { subscription_id: b.subscription_id, session_revision: b.session_revision, expires_at_ms: b.expires_at_ms };
}
export async function adaptTerminalTail(v: unknown, terminal: TerminalIdentity, subscription: string, after: number): Promise<TerminalTail> {
  check(isRecord(v) && sameTerminal(terminalIdentity(v.terminal), terminal) && v.subscription_id === subscription && integer(v.session_revision, 1) && integer(v.expires_at_ms, 1) && integer(v.server_time_ms, 1) && v.server_time_ms < v.expires_at_ms);
  check(v.last_observed_at_ms === null || integer(v.last_observed_at_ms, 1));
  check((v.availability === "resident_tail" || v.availability === "not_retained") && typeof v.disconnected === "boolean" && v.initial_incomplete === true && typeof v.more === "boolean");
  check(integer(v.next_sequence) && v.next_sequence >= after && Array.isArray(v.frames) && v.frames.length <= 64 && Array.isArray(v.gaps) && v.gaps.length <= 128);
  let sequence = after, bytes = 0;
  for (const f of v.frames) {
    check(isRecord(f) && sameTerminal(terminalIdentity(f.terminal), terminal) && integer(f.sequence, 1) && f.sequence > sequence && f.sequence <= v.next_sequence);
    check(Array.isArray(f.bytes) && f.bytes.length > 0 && f.byte_length === f.bytes.length && f.bytes.every((b: unknown) => integer(b) && b <= 255));
    bytes += f.bytes.length; check(bytes <= 65536);
    check(typeof f.digest === "string" && /^[0-9a-f]{64}$/.test(f.digest));
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(f.bytes));
    check(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("") === f.digest);
    sequence = f.sequence;
  }
  for (const g of v.gaps) check(isRecord(g) && sameTerminal(terminalIdentity(g.terminal), terminal) && integer(g.first_missing, 1) && integer(g.last_missing, g.first_missing));
  check(v.availability !== "not_retained" || (v.frames.length === 0 && v.gaps.length === 0));
  return v as TerminalTail;
}
/** Escape terminal controls and direction-changing Unicode; React escapes markup. */
export function literalTail(bytes: number[]): string {
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
