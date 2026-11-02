import type { TerminalIdentity } from './wire/terminalTail';
import { describe, expect, it, vi } from 'vitest';
import { adaptInteractiveInfo, adaptInputReceipt } from './adapters/terminalControl';
import { connectInteractiveTerminal } from './interactiveTerminalClient';
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
