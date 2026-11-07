import type { TerminalIdentity } from './wire/terminalTail';
import { terminalJson } from './terminalClient';
import { describe, expect, it, vi } from 'vitest';
import { adaptInteractiveInfo, adaptInputReceipt } from './adapters/terminalControl';
import { connectInteractiveTerminal, MAX_AUTOMATIC_RECONNECTS, TAKEOVER_NOTICE_LOST, TAKEOVER_NOTICE_TOOK, TERMINAL_CADENCE } from './interactiveTerminalClient';
import { ApiError } from './client';
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
    else value = { ...info, disconnected: lease === null, control: control() };
    return { body: value, serverTime: 1000 };
  });
  let controlling = false, canControl = false;
  const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: true, read: (_part, fetcher) => fetcher(), write: async () => {}, reset: vi.fn(), state: s => { states.push(s.message); controlling = s.controlling; canControl = s.canControl; } });
  try {
    await vi.waitFor(() => expect(canControl).toBe(true));
    expect(controlling).toBe(false); // Stale peer contact permits intent, never stdin.
    await c.takeControl(); await vi.waitFor(() => expect(controlling).toBe(true));
    c.sendInput(new Uint8Array([65]));
    await vi.waitFor(() => expect(states).toContain('Input rejected — type again'));
    expect(controlling).toBe(true);
    c.sendInput(new Uint8Array([13]));
    await vi.waitFor(() => expect(sent).toEqual([[65], [13]]));
  } finally { c.close(); }
});

describe('reconnect binding (U11)', () => {
  it('reconnect_rejects_a_changed_terminal_epoch_without_watching', async () => {
    const read = vi.fn(async (_part: string, _fetcher: unknown) => ({ body: { ...info, terminal: { ...terminal, epoch: 2 }, control: { ...info.control, terminal: { ...terminal, epoch: 2 } } }, serverTime: 1000 }));
    const states: { message: string; connected: boolean }[] = []; const reset = vi.fn();
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: true, expect: { terminal, session_revision: 2 }, read, write: async () => {}, reset, state: s => states.push(s) });
    try {
      await vi.waitFor(() => expect(states.at(-1)?.message).toMatch(/^Terminal epoch changed/));
      expect(states.some(s => s.connected)).toBe(false);
      expect(read.mock.calls.map(call => call[0])).toEqual(['info']);
      expect(reset).not.toHaveBeenCalled();
    } finally { c.close(); }
  });
  it('reports the observed binding so a reconnect can pin the same identity and epoch', async () => {
    const read = vi.fn(async (part: string, _fetcher: unknown) => { if (part !== 'info') throw new Error('stop'); return { body: info, serverTime: 1000 }; });
    const bindings: unknown[] = [];
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, expect: { terminal, session_revision: 2 }, read, write: async () => {}, reset: vi.fn(), state: s => bindings.push(s.binding) });
    try { await vi.waitFor(() => expect(bindings).toContainEqual({ terminal, session_revision: 2 })); } finally { c.close(); }
  });
});

describe('watch resilience and cadence (QA N-01, N-02)', () => {
  const subscription = '10000000-0000-4000-8000-000000000004';
  function fake(options: { tail?: (n: number) => unknown | Error; disconnected?: boolean }) {
    let expiry = 14000, tails = 0, watches = 0, infos = 0;
    vi.mocked(terminalJson).mockImplementation(async (path, _signal, body) => {
      const doc = body as { kind?: string; body?: { operation_id?: string; expires_at_ms?: number } } | undefined;
      if (doc?.kind === 'watch') { watches++; expiry = doc.body!.expires_at_ms!; return { body: { kind: 'watch', body: { terminal, operation_id: doc.body!.operation_id, subscription_id: subscription, session_revision: 2, expires_at_ms: expiry } }, serverTime: 1000 }; }
      if (path.includes('/tail?')) { const value = options.tail?.(++tails); if (value instanceof Error) throw value; return { body: { ...(value as object), expires_at_ms: expiry }, serverTime: 1000 }; }
      infos++; return { body: { ...info, disconnected: options.disconnected ?? false }, serverTime: 1000 };
    });
    return { read: ((_part: string, fetcher: () => ReturnType<typeof terminalJson>) => fetcher()) as never, counts: () => ({ tails, watches, infos }) };
  }
  const retained = (n: number, extra: Record<string, unknown> = {}) => ({ terminal, subscription_id: subscription, session_revision: 2, expires_at_ms: 14000, server_time_ms: 1000, last_observed_at_ms: 1000, availability: 'resident_tail', disconnected: false, initial_incomplete: true, frames: [], gaps: [], next_sequence: n, more: false, ...extra });
  const unavailable = () => new ApiError('http', 'AQ responded 503', { status: 503, envelope: { request_id: 'r', code: 'unavailable', message: 'temporarily unavailable', retryable: true } });

  it('reconnects automatically after a retryable 503 tail instead of stopping', async () => {
    const t = fake({ tail: n => n === 2 ? unavailable() : retained(0) });
    const messages: string[] = []; const connected: boolean[] = [];
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, read: t.read, write: async () => {}, reset: vi.fn(), state: s => { messages.push(s.message); connected.push(s.connected); }, reconnectDelay: () => 1 });
    try {
      await vi.waitFor(() => expect(messages.some(m => m.startsWith('Reconnecting… (attempt 1 of 6)'))).toBe(true));
      await vi.waitFor(() => expect(t.counts().tails).toBeGreaterThanOrEqual(3));
      expect(t.counts().watches).toBeGreaterThanOrEqual(2);
      expect(connected.at(-1)).toBe(true);
      expect(messages.some(m => m.startsWith('Disconnected'))).toBe(false);
    } finally { c.close(); }
  });

  it('a non-retryable failure stops for an explicit Reconnect', async () => {
    const t = fake({ tail: () => new ApiError('http', 'AQ responded 403', { status: 403 }) });
    const messages: string[] = [];
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, read: t.read, write: async () => {}, reset: vi.fn(), state: s => messages.push(s.message), reconnectDelay: () => 1 });
    try {
      await vi.waitFor(() => expect(messages.at(-1)).toBe('Disconnected — reconnect to watch; control released'));
      expect(messages.some(m => m.startsWith('Reconnecting'))).toBe(false);
      expect(t.counts().watches).toBe(1);
    } finally { c.close(); }
  });

  it('gives up after the bounded number of automatic reconnects', async () => {
    const t = fake({ tail: () => unavailable() });
    const messages: string[] = [];
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, read: t.read, write: async () => {}, reset: vi.fn(), state: s => messages.push(s.message), reconnectDelay: () => 1 });
    try {
      await vi.waitFor(() => expect(messages.at(-1)).toBe('Disconnected — reconnect to watch; control released'));
      expect(t.counts().tails).toBe(MAX_AUTOMATIC_RECONNECTS + 1);
    } finally { c.close(); }
  });

  it('backs off while idle instead of polling every 200 ms', async () => {
    const t = fake({ tail: () => retained(0) });
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, read: t.read, write: async () => {}, reset: vi.fn(), state: () => {} });
    try {
      await new Promise(resolve => setTimeout(resolve, 1600));
      // 200 ms fixed polling would be ~8 tails; idle backoff (400, 800, 1600…) gives at most 4.
      expect(t.counts().tails).toBeLessThanOrEqual(4);
      expect(t.counts().infos).toBe(1);
    } finally { c.close(); }
  });

  it('stops tailing a disconnected terminal with nothing retained, and restarts its screen once', async () => {
    const reset = vi.fn(); const messages: string[] = [];
    const t = fake({ disconnected: true, tail: () => retained(0, { availability: 'not_retained', disconnected: true }) });
    const c = connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: false, read: t.read, write: async () => {}, reset, state: s => messages.push(s.message) });
    try {
      await vi.waitFor(() => expect(t.counts().tails).toBe(1));
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(t.counts()).toMatchObject({ tails: 1, watches: 1 });
      expect(reset).toHaveBeenCalledTimes(1);
      expect(messages.at(-1)).toBe('Output not retained');
      expect(TERMINAL_CADENCE.dormantMin).toBeGreaterThanOrEqual(5000);
    } finally { c.close(); }
  });
});

describe('auto control and takeover notices (spec 0007 §5.4)', () => {
  const ME = '10000000-0000-4000-8000-000000000005', OTHER = '10000000-0000-4000-8000-0000000000aa';
  const mock = (opts: { initialLease?: Record<string, unknown> | null; failFirstTail?: boolean } = {}) => {
    let lease: null | Record<string, unknown> = opts.initialLease ?? null, generation = 0, expiry = 14000, tails = 0; const controls: unknown[] = [];
    const control = () => ({ ...info.control, generation: lease ? lease.generation : generation, lease, fence_acknowledged: lease !== null });
    vi.mocked(terminalJson).mockImplementation(async (path, _signal, body) => {
      const doc = body as { kind: string; body: Record<string, unknown> } | undefined;
      let value: unknown;
      if (doc?.kind === 'watch') { expiry = doc.body.expires_at_ms as number; value = { kind: 'watch', body: { terminal, operation_id: doc.body.operation_id, subscription_id: '10000000-0000-4000-8000-000000000004', session_revision: 2, expires_at_ms: expiry } }; }
      else if (doc?.kind === 'control') { controls.push(doc); generation++; lease = { terminal, principal_id: 'fixture', lease_id: ME, generation, issued_at_ms: 1000, expires_at_ms: 15000, execution_expires_at_ms: 30000 }; value = { kind: 'control', body: { operation_id: doc.body.operation_id, status: control() } }; }
      else if (path.includes('/tail?')) {
        if (opts.failFirstTail && tails++ === 0) throw new ApiError('http', 'AQ responded 503', { status: 503, envelope: { request_id: 'r', code: 'unavailable', message: 'temporarily unavailable', retryable: true } });
        value = { terminal, subscription_id: '10000000-0000-4000-8000-000000000004', session_revision: 2, expires_at_ms: expiry, server_time_ms: 1000, last_observed_at_ms: 1000, availability: 'resident_tail', disconnected: false, initial_incomplete: true, frames: [], gaps: [], next_sequence: 0, more: false };
      } else value = { ...info, disconnected: lease === null, control: control() };
      return { body: value, serverTime: 1000 };
    });
    return { controls, setLease: (next: Record<string, unknown> | null) => { lease = next; } };
  };
  const foreign = { terminal, principal_id: 'other', lease_id: OTHER, generation: 1, issued_at_ms: 1000, expires_at_ms: 15000, execution_expires_at_ms: 30000 };
  const connect = (extra: Partial<Parameters<typeof connectInteractiveTerminal>[0]>, states: { controlling: boolean; notice?: string | null; message: string }[]) =>
    connectInteractiveTerminal({ terminalId: terminal.terminal_id, allowControl: true, read: (_part, fetcher) => fetcher(), write: async () => {}, reset: vi.fn(), state: s => states.push(s), reconnectDelay: () => 0, ...extra });

  it('auto control acquires once after the first info', async () => {
    const m = mock(); const states: { controlling: boolean; message: string }[] = [];
    const c = connect({ autoControl: true }, states);
    try {
      await vi.waitFor(() => expect(states.at(-1)?.controlling).toBe(true));
      expect(m.controls).toHaveLength(1);
    } finally { c.close(); }
  });
  it('auto control is not retried after an automatic reconnect', async () => {
    const m = mock({ failFirstTail: true }); const states: { controlling: boolean; message: string }[] = [];
    const c = connect({ autoControl: true }, states);
    try {
      await vi.waitFor(() => expect(states.some(s => s.message.startsWith('Reconnecting'))).toBe(true));
      await vi.waitFor(() => expect(vi.mocked(terminalJson).mock.calls.filter(call => String(call[0]).endsWith('/tail?subscription_id=10000000-0000-4000-8000-000000000004&after_sequence=0')).length).toBeGreaterThan(1));
      expect(m.controls).toHaveLength(1);
    } finally { c.close(); }
  });
  it('auto control never runs without terminal.control', async () => {
    const m = mock({ initialLease: foreign }); const states: { controlling: boolean; message: string }[] = [];
    const c = connect({ autoControl: true, allowControl: false }, states);
    try {
      await vi.waitFor(() => expect(states.at(-1)?.message).toBe('Watch only'));
      expect(m.controls).toHaveLength(0);
    } finally { c.close(); }
  });
  it('lease taken by another viewer drops control and raises the notice', async () => {
    const m = mock(); const states: { controlling: boolean; notice?: string | null; message: string }[] = [];
    const c = connect({ autoControl: true }, states);
    try {
      await vi.waitFor(() => expect(states.at(-1)?.controlling).toBe(true));
      m.setLease(foreign);
      await vi.waitFor(() => { expect(states.at(-1)?.controlling).toBe(false); expect(states.at(-1)?.notice).toBe(TAKEOVER_NOTICE_LOST); });
    } finally { c.close(); }
  });
  it("taking over another viewer's lease reports it", async () => {
    mock({ initialLease: foreign }); const states: { controlling: boolean; notice?: string | null; message: string }[] = [];
    const c = connect({}, states);
    try {
      await vi.waitFor(() => expect(states.length).toBeGreaterThan(0));
      await c.takeControl();
      await vi.waitFor(() => expect(states.at(-1)?.notice).toBe(TAKEOVER_NOTICE_TOOK));
    } finally { c.close(); }
  });
});
