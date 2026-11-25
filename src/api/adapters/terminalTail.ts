import { ContractError, isRecord, nullable, sameFields } from "./contract";
import type { TerminalIdentity, TerminalTail } from "../wire/terminalTail";

function check(ok: unknown): asserts ok { if (!ok) throw new ContractError("Invalid terminal tail"); }
function integer(v: unknown, min = 0): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v >= min; }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v); }
export function terminalIdentity(v: unknown): TerminalIdentity {
  check(isRecord(v));
  check(uuid(v.terminal_id));
  check(integer(v.epoch, 1));
  check(isRecord(v.session));
  const s = v.session;
  check(uuid(s.session_id));
  if (s.kind === "remote") {
    check(uuid(s.node_id));
    check(uuid(s.boot_id));
    check(uuid(s.attempt_id));
    check(integer(s.assignment_generation, 1));
  } else {
    check(s.kind === "central");
    check(uuid(s.authority_id));
    check(integer(s.generation, 1));
  }
  return v as TerminalIdentity;
}
export function sameSession(x: TerminalIdentity["session"], y: TerminalIdentity["session"]): boolean {
  if (x.kind === "remote" && y.kind === "remote") {
    return sameFields(x, y, ["session_id", "node_id", "boot_id", "attempt_id", "assignment_generation"]);
  }
  return x.kind === "central" && y.kind === "central" && sameFields(x, y, ["session_id", "authority_id", "generation"]);
}
export function sameTerminal(a: TerminalIdentity, b: TerminalIdentity): boolean {
  return sameFields(a, b, ["terminal_id", "epoch"]) && sameSession(a.session, b.session);
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
  check(sameTerminal(terminalIdentity(b.terminal), terminal));
  check(b.operation_id === operation);
  check(uuid(b.subscription_id));
  check(integer(b.session_revision, 1));
  check(integer(b.expires_at_ms, 1));
  return { subscription_id: b.subscription_id, session_revision: b.session_revision, expires_at_ms: b.expires_at_ms };
}
async function validateFrames(frames: unknown[], terminal: TerminalIdentity, after: number, last: number) {
  let sequence = after, bytes = 0;
  for (const f of frames) {
    check(isRecord(f));
    check(sameTerminal(terminalIdentity(f.terminal), terminal));
    check(integer(f.sequence, 1));
    check(f.sequence > sequence);
    check(f.sequence <= last);
    check(Array.isArray(f.bytes));
    check(f.bytes.length > 0);
    check(f.byte_length === f.bytes.length);
    check(f.bytes.every((b: unknown) => integer(b) && b <= 255));
    bytes += f.bytes.length; check(bytes <= 65536);
    check(typeof f.digest === "string" && /^[0-9a-f]{64}$/.test(f.digest));
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(f.bytes));
    check(Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("") === f.digest);
    sequence = f.sequence;
  }
}

function validateGaps(gaps: unknown[], terminal: TerminalIdentity) {
  for (const g of gaps) {
    check(isRecord(g));
    check(sameTerminal(terminalIdentity(g.terminal), terminal));
    check(integer(g.first_missing, 1));
    check(integer(g.last_missing, g.first_missing));
  }
}

function validGrid(grid: unknown): boolean {
  return Array.isArray(grid) && grid.length === 2 && grid.every(n => integer(n, 1) && n <= 1000);
}

export async function adaptTerminalTail(v: unknown, terminal: TerminalIdentity, subscription: string, after: number): Promise<TerminalTail> {
  check(isRecord(v));
  check(sameTerminal(terminalIdentity(v.terminal), terminal));
  check(v.subscription_id === subscription);
  check(integer(v.session_revision, 1));
  check(integer(v.expires_at_ms, 1));
  check(integer(v.server_time_ms, 1) && v.server_time_ms < v.expires_at_ms);
  check(nullable(v.last_observed_at_ms, n => integer(n, 1)));
  check(v.availability === "resident_tail" || v.availability === "not_retained");
  check(typeof v.disconnected === "boolean");
  check(v.initial_incomplete === true);
  check(typeof v.more === "boolean");
  check(nullable(v.grid, validGrid));
  check(integer(v.next_sequence) && v.next_sequence >= after);
  check(Array.isArray(v.frames) && v.frames.length <= 64);
  check(Array.isArray(v.gaps) && v.gaps.length <= 128);
  await validateFrames(v.frames, terminal, after, v.next_sequence);
  validateGaps(v.gaps, terminal);
  check(v.availability !== "not_retained" || (v.frames.length === 0 && v.gaps.length === 0));
  return v as TerminalTail;
}
/** Escape terminal controls and direction-changing Unicode; React escapes markup. */
export function literalTail(bytes: number[]): string {
  return new TextDecoder("utf-8").decode(new Uint8Array(bytes)).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
