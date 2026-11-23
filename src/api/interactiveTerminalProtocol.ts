import { ContractError, isRecord } from './adapters/contract';
import { adaptControl, type adaptInputReceipt, type TerminalInfo } from './adapters/terminalControl';
import { sameTerminal, type adaptTerminalTail, type adaptWatch } from './adapters/terminalTail';
import type { TerminalBinding } from './interactiveTerminalClient';

export class NotDelivered extends Error {}
export type InputPacket = { bytes: Uint8Array; escapeKey?: true };

export type Tail = Awaited<ReturnType<typeof adaptTerminalTail>>;
export type Watch = ReturnType<typeof adaptWatch>;

export function sameBinding(left: TerminalBinding, right: TerminalBinding) {
  return left.session_revision === right.session_revision && sameTerminal(left.terminal, right.terminal);
}

export function canWrite(info: TerminalInfo, owned: string | null, now: number): boolean {
  const { lease, fence_acknowledged, input_paused } = info.control;
  const acknowledged = fence_acknowledged && !input_paused;
  if (!lease || !acknowledged) return false;
  return info.input_enabled && !info.disconnected && lease.lease_id === owned && lease.expires_at_ms > now;
}

export function nextInputBatch(queue: InputPacket[], limit: number): InputPacket {
  const first = queue.shift()!;
  if (first.escapeKey) return first;
  const chunks = [first.bytes];
  let size = first.bytes.length;
  while (queue.length) {
    const next = queue[0]!;
    if (next.escapeKey || size + next.bytes.length > limit) break;
    queue.shift(); chunks.push(next.bytes); size += next.bytes.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes };
}

export function delivered(receipt: ReturnType<typeof adaptInputReceipt>): boolean {
  if (receipt.input_paused || receipt.disposition === 'delivery_unknown') throw new Error('Input not confirmed');
  if (['expired', 'rejected'].includes(receipt.disposition)) throw new NotDelivered(`Input ${receipt.disposition} — type again`);
  return receipt.disposition === 'applied';
}

export function outputGap(tail: Tail, previous: number): boolean {
  if (tail.gaps.length > 0) return true;
  return tail.frames.some(frame => frame.sequence !== ++previous);
}

export function outputMessage(tail: Tail, gap: boolean) {
  if (tail.availability === 'not_retained') return 'Output not retained';
  if (gap) return 'Output gap — screen restarted';
  if (tail.disconnected) return 'Output stream disconnected';
}

export function heldByOtherViewer(info: TerminalInfo, acquired: Set<string>, now: number): boolean {
  const lease = info.control.lease;
  return !!lease && !acquired.has(lease.lease_id) && lease.expires_at_ms > now;
}

function mutationReply(body: unknown, kind: 'input' | 'resize' | 'control', error: string): unknown {
  if (!isRecord(body) || body.kind !== kind) throw new ContractError(error);
  return body.body;
}

export function inputReply(body: unknown) { return mutationReply(body, 'input', 'Input reply'); }

export function checkResizeReply(body: unknown) { mutationReply(body, 'resize', 'Resize reply'); }

export function controlLease(body: unknown, operation: string, info: TerminalInfo, now: () => number) {
  const payload = mutationReply(body, 'control', 'Control reply');
  if (!isRecord(payload) || payload.operation_id !== operation) throw new ContractError('Control reply');
  const status = adaptControl(payload.status, info.terminal, info.session_revision);
  const lease = status.lease;
  if (!lease || lease.expires_at_ms <= now()) throw new ContractError('Control expiry');
  return { status, lease };
}
