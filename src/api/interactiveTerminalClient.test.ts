import type { TerminalIdentity } from './wire/terminalTail';
import { terminalJson } from './terminalClient';
import { describe, expect, it, vi } from 'vitest';
import { adaptInteractiveInfo, adaptInputReceipt } from './adapters/terminalControl';
import { connectInteractiveTerminal } from './interactiveTerminalClient';
vi.mock('./terminalClient', () => ({ terminalJson: vi.fn() }));
const terminal: TerminalIdentity = { terminal_id: '10000000-0000-4000-8000-000000000001', epoch: 1, session: { kind: 'central', authority_id: '10000000-0000-4000-8000-000000000002', session_id: '10000000-0000-4000-8000-000000000003', generation: 1 } };
const info = { terminal, session_revision: 2, input_mode: 'finite_v1', terminal_policy: { input_enabled: true }, disconnected: false, control: { terminal, session_revision: 2, generation: 0, lease: null, fence_acknowledged: false, input_paused: false } };
describe('v1 terminal renderer v2 transport boundary', () => {
  it('retains the complete identity and refuses foreign control or unsupported input mode', () => {
    expect(adaptInteractiveInfo(info, terminal.terminal_id).control.lease).toBeNull();
    expect(() => adaptInteractiveInfo({ ...info, input_mode: 'epoch_v1' }, terminal.terminal_id)).toThrow();
    expect(() => adaptInteractiveInfo({ ...info, control: { ...info.control, terminal: { ...terminal, epoch: 2 } } }, terminal.terminal_id)).toThrow();
  });
  it('distinguishes uncertain delivery and rejects a foreign operation receipt', () => {
    const receipt = { terminal, operation_id: 'op', disposition: 'delivery_unknown', input_paused: true, observed_at_ms: 10 };
    expect(adaptInputReceipt(receipt, terminal, 'op').disposition).toBe('delivery_unknown');
    expect(() => adaptInputReceipt(receipt, terminal, 'other')).toThrow();
  });
  it('never sends input or resize before explicit acknowledged control', async () => {
    const read = vi.fn(async (_part: string, _fetcher: unknown) => ({ body: info, serverTime: 1000 }));
    const state = vi.fn();
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: true, read, write: async () => {}, reset: vi.fn(), state });
    c.sendInput(new Uint8Array([13])); c.resize(80, 24);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(read.mock.calls.some(call => String(call[0]).startsWith('input'))).toBe(false);
    expect(read.mock.calls.some(call => String(call[0]) === 'resize')).toBe(false);
    c.close();
  });
});

it('allows a fresh user operation after a definitive rejection without replaying queued bytes', async () => {
  let lease: null | Record<string, unknown> = null, generation = 0, expiry = 14000;
  const sent: number[][] = []; const states: string[] = [];
  const control = () => ({ ...info.control, generation, lease, fence_acknowledged: lease !== null });
  vi.mocked(terminalJson).mockImplementation(async (path, _signal, body) => {
    const doc = body as { kind: string; body: Record<string, unknown> } | undefined;
    let value: unknown;
    if (doc?.kind === 'watch') { expiry = doc.body.expires_at_ms as number; value = { kind: 'watch', body: { terminal, operation_id: doc.body.operation_id, subscription_id: '10000000-0000-4000-8000-000000000004', session_revision: 2, expires_at_ms: expiry } }; }
    else if (doc?.kind === 'control') { generation++; lease = { terminal, principal_id: 'fixture', lease_id: '10000000-0000-4000-8000-000000000005', generation, issued_at_ms: 1000, expires_at_ms: 15000, execution_expires_at_ms: 30000 }; value = { kind: 'control', body: { operation_id: doc.body.operation_id, status: control() } }; }
    else if (doc?.kind === 'input') { sent.push(doc.body.bytes as number[]); value = { kind: 'input', body: { terminal, operation_id: doc.body.operation_id, disposition: sent.length === 1 ? 'rejected' : 'applied', input_paused: false, observed_at_ms: 1000 } }; }
    else if (path.includes('/tail?')) value = { terminal, subscription_id: '10000000-0000-4000-8000-000000000004', session_revision: 2, expires_at_ms: expiry, server_time_ms: 1000, last_observed_at_ms: 1000, availability: 'resident_tail', disconnected: false, initial_incomplete: true, frames: [], gaps: [], next_sequence: 0, more: false };
    else value = { ...info, control: control() };
    return { body: value, serverTime: 1000 };
  });
  let controlling = false;
  const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: true, read: (_part, fetcher) => fetcher(), write: async () => {}, reset: vi.fn(), state: s => { states.push(s.message); controlling = s.controlling; } });
  try {
    await vi.waitFor(() => expect(states).toContain('Watch only'));
    await c.takeControl(); await vi.waitFor(() => expect(controlling).toBe(true));
    c.sendInput(new Uint8Array([65]));
    await vi.waitFor(() => expect(states).toContain('Input rejected — type again'));
    expect(controlling).toBe(true);
    c.sendInput(new Uint8Array([13]));
    await vi.waitFor(() => expect(sent).toEqual([[65], [13]]));
  } finally { c.close(); }
});
