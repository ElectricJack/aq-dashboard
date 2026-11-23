import { ContractError, isRecord } from './contract';
import { adaptTerminalInfo, sameTerminal, terminalIdentity } from './terminalTail';
import type { TerminalIdentity } from '../wire/terminalTail';
export interface Lease { lease_id: string; generation: number; expires_at_ms: number }
export interface Control { generation: number; lease: Lease | null; fence_acknowledged: boolean; input_paused: boolean }
export interface TerminalInfo { terminal: TerminalIdentity; session_revision: number; input_enabled: boolean; maxInputBytes: number; maxPendingInputBytes: number; disconnected: boolean; control: Control }
function check(v: unknown): asserts v { if (!v) throw new ContractError('Invalid terminal control'); }
function integer(v: unknown, min = 0): v is number { return Number.isSafeInteger(v) && (v as number) >= min; }
function adaptLease(raw: unknown, terminal: TerminalIdentity, generation: number): Lease | null {
  if (raw === null) return null;
  check(isRecord(raw) && sameTerminal(terminalIdentity(raw.terminal), terminal));
  check(typeof raw.lease_id === 'string' && /^[0-9a-f-]{36}$/i.test(raw.lease_id) && raw.generation === generation);
  check(integer(raw.issued_at_ms) && integer(raw.expires_at_ms, raw.issued_at_ms + 1));
  check(raw.expires_at_ms - raw.issued_at_ms <= 15000 && integer(raw.execution_expires_at_ms, raw.expires_at_ms));
  return { lease_id: raw.lease_id, generation, expires_at_ms: raw.expires_at_ms };
}

export function adaptControl(v: unknown, terminal: TerminalIdentity, revision: number): Control {
  check(isRecord(v) && sameTerminal(terminalIdentity(v.terminal), terminal) && v.session_revision === revision);
  check(integer(v.generation) && typeof v.fence_acknowledged === 'boolean' && typeof v.input_paused === 'boolean');
  return { generation: v.generation, lease: adaptLease(v.lease, terminal, v.generation), fence_acknowledged: v.fence_acknowledged, input_paused: v.input_paused };
}
export function adaptInteractiveInfo(v: unknown, id: string): TerminalInfo {
  const base = adaptTerminalInfo(v, id);
  check(isRecord(v) && v.input_mode === 'finite_v1' && isRecord(v.terminal_policy) && typeof v.terminal_policy.input_enabled === 'boolean' && typeof v.disconnected === 'boolean');
  const { input_enabled, max_input_bytes, max_pending_input_bytes } = v.terminal_policy;
  check(integer(max_input_bytes, 1) && max_input_bytes <= 4096 && integer(max_pending_input_bytes, max_input_bytes) && max_pending_input_bytes <= 32768);
  return { ...base, input_enabled, maxInputBytes: max_input_bytes, maxPendingInputBytes: max_pending_input_bytes, disconnected: v.disconnected, control: adaptControl(v.control, base.terminal, base.session_revision) };
}
export function adaptInputReceipt(v: unknown, terminal: TerminalIdentity, operation: string) {
  check(isRecord(v) && sameTerminal(terminalIdentity(v.terminal), terminal) && v.operation_id === operation && typeof v.input_paused === 'boolean' && integer(v.observed_at_ms));
  check(['queued', 'received', 'injecting', 'applied', 'delivery_unknown', 'expired', 'rejected'].includes(v.disposition as string));
  return { disposition: v.disposition as string, input_paused: v.input_paused };
}
