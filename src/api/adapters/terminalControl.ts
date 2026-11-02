import { ContractError, isRecord } from './contract';
import { adaptTerminalInfo, sameTerminal, terminalIdentity } from './terminalTail';
import type { TerminalIdentity } from '../wire/terminalTail';
export interface Lease { lease_id: string; generation: number; expires_at_ms: number }
export interface Control { generation: number; lease: Lease | null; fence_acknowledged: boolean; input_paused: boolean }
export interface TerminalInfo { terminal: TerminalIdentity; session_revision: number; input_enabled: boolean; disconnected: boolean; control: Control }
function check(v: unknown): asserts v { if (!v) throw new ContractError('Invalid terminal control'); }
function integer(v: unknown, min = 0): v is number { return Number.isSafeInteger(v) && (v as number) >= min; }
export function adaptControl(v: unknown, terminal: TerminalIdentity, revision: number): Control {
  check(isRecord(v) && sameTerminal(terminalIdentity(v.terminal), terminal) && v.session_revision === revision && integer(v.generation) && typeof v.fence_acknowledged === 'boolean' && typeof v.input_paused === 'boolean');
  let lease: Lease | null = null;
  if (v.lease !== null) {
    const l = v.lease;
    check(isRecord(l) && sameTerminal(terminalIdentity(l.terminal), terminal) && typeof l.lease_id === 'string' && /^[0-9a-f-]{36}$/i.test(l.lease_id) && l.generation === v.generation && integer(l.issued_at_ms) && integer(l.expires_at_ms, l.issued_at_ms + 1) && l.expires_at_ms - l.issued_at_ms <= 15000 && integer(l.execution_expires_at_ms, l.expires_at_ms));
    lease = { lease_id: l.lease_id, generation: v.generation, expires_at_ms: l.expires_at_ms };
  }
  return { generation: v.generation, lease, fence_acknowledged: v.fence_acknowledged, input_paused: v.input_paused };
}
export function adaptInteractiveInfo(v: unknown, id: string): TerminalInfo {
  const base = adaptTerminalInfo(v, id);
  check(isRecord(v) && v.input_mode === 'finite_v1' && isRecord(v.terminal_policy) && typeof v.terminal_policy.input_enabled === 'boolean' && typeof v.disconnected === 'boolean');
  return { ...base, input_enabled: v.terminal_policy.input_enabled, disconnected: v.disconnected, control: adaptControl(v.control, base.terminal, base.session_revision) };
}
export function adaptInputReceipt(v: unknown, terminal: TerminalIdentity, operation: string) {
  check(isRecord(v) && sameTerminal(terminalIdentity(v.terminal), terminal) && v.operation_id === operation && typeof v.input_paused === 'boolean' && integer(v.observed_at_ms));
  check(['queued', 'received', 'injecting', 'applied', 'delivery_unknown', 'expired', 'rejected'].includes(v.disposition as string));
  return { disposition: v.disposition as string, input_paused: v.input_paused };
}
