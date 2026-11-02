/** V1 terminalSocket lifecycle adapted to v2's authenticated finite-input relay.
 * Raw bytes never retry; receipt lookup is the only recovery after a POST failure.
 */
import { adaptControl, adaptInputReceipt, adaptInteractiveInfo, type TerminalInfo } from './adapters/terminalControl';
import { adaptTerminalTail, adaptWatch, sameTerminal } from './adapters/terminalTail';
import { isRecord, ContractError } from './adapters/contract';
import { terminalJson } from './terminalClient';
export interface TerminalState { message: string; connected: boolean; controlling: boolean; canControl: boolean; paused: boolean }
type Read = (part: string, fetcher: () => ReturnType<typeof terminalJson>) => ReturnType<typeof terminalJson>;
export function connectInteractiveTerminal(options: { terminalId: string; allowControl: boolean; initiallyPaused?: boolean; read: Read; write: (bytes: Uint8Array) => Promise<void>; reset: () => void; state: (state: TerminalState) => void }) {
  const abort = new AbortController(), { signal } = abort;
  const path = `/api/v1/terminals/${encodeURIComponent(options.terminalId)}`;
  let info: TerminalInfo | undefined, clock = 0, clockAt = 0, owned: string | null = null;
  let paused = options.initiallyPaused ?? false, connected = false, busy = false, queue: Uint8Array[] = [], queued = 0, resizeSequence = 0, renewing = false;
  let inputBatchTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingResize: { columns: number; rows: number } | null = null;
  const now = () => clock + performance.now() - clockAt;
  const active = () => !!(connected && !paused && info?.input_enabled && !info.disconnected && info.control.fence_acknowledged && !info.control.input_paused && info.control.lease?.lease_id === owned && info.control.lease.expires_at_ms > now());
  const emit = (message = active() ? 'You have control' : paused ? 'Input delivery uncertain — typing paused' : connected ? 'Watch only' : 'Connecting…') => {
    if (!signal.aborted) options.state({ message, connected, controlling: active(), canControl: !!(connected && info?.input_enabled && !info.disconnected && options.allowControl && !paused), paused });
  };
  const request: Read = async (part, fetcher) => {
    const value = await options.read(part, fetcher);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    clock = value.serverTime; clockAt = performance.now(); return value;
  };
  const json = (part: string, suffix = '', body?: unknown) => request(part, () => terminalJson(path + suffix, signal, body));
  const delay = (ms: number) => new Promise<void>(resolve => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', end); resolve(); };
    const timer = setTimeout(end, ms); signal.addEventListener('abort', end, { once: true });
  });
  async function inspect() {
    const raw = await json('info'); const next = adaptInteractiveInfo(raw.body, options.terminalId);
    if (info && (!sameTerminal(next.terminal, info.terminal) || next.session_revision !== info.session_revision)) throw new ContractError('Terminal binding changed');
    info = next;
    if (info.control.input_paused) { paused = true; queue = []; queued = 0; pendingResize = null; }
    if (owned && info.control.lease?.lease_id !== owned) { owned = null; queue = []; queued = 0; }
    connected = !info.disconnected; emit();
  }
  function fields() {
    if (!info || !owned || !active()) throw new Error('Control unavailable');
    return { terminal: info.terminal, lease_id: owned, expected_controller_generation: info.control.generation, expected_session_revision: info.session_revision };
  }
  function pause() { paused = true; queue = []; queued = 0; pendingResize = null; emit(); }
  async function receipt(operation: string, initial?: unknown) {
    if (!info) throw new Error('No binding');
    let body = initial;
    for (let n = 0; n < 15 && !signal.aborted; n++) {
      if (body === undefined) body = (await json(`receipt-${operation}`, `/receipts/${operation}`)).body;
      const r = adaptInputReceipt(body, info.terminal, operation);
      if (r.disposition === 'applied' && !r.input_paused) return;
      if (['delivery_unknown', 'expired', 'rejected'].includes(r.disposition) || r.input_paused) throw new Error('Input not confirmed');
      await delay(100); body = undefined;
    }
    throw new Error('Receipt not confirmed');
  }
  async function flush() {
    if (busy || !active()) return;
    busy = true;
    try {
      while (queue.length && active()) {
        // Preserve byte order while amortizing one durable receipt across a burst.
        const chunks: Uint8Array[] = []; let length = 0;
        while (queue.length && length + queue[0]!.length <= 4096) { const next = queue.shift()!; chunks.push(next); length += next.length; }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        queued -= bytes.length;
        const operation = crypto.randomUUID(); const binding = fields();
        let body: unknown;
        try {
          const raw = await json(`input-${operation}`, '/mutations', { kind: 'input', body: { ...binding, operation_id: operation, expires_at_ms: Math.floor(Math.min(now() + 1500, info!.control.lease!.expires_at_ms)), bytes: [...bytes] } });
          if (!isRecord(raw.body) || raw.body.kind !== 'input') throw new ContractError('Input reply');
          body = raw.body.body;
        } catch { /* The operation may already exist: never replay its bytes. */ }
        await receipt(operation, body);
      }
      if (pendingResize && active()) {
        const size = pendingResize; pendingResize = null;
        const operation = crypto.randomUUID(), sequence = ++resizeSequence;
        const raw = await json('resize', '/mutations', { kind: 'resize', body: { ...fields(), operation_id: operation, expires_at_ms: Math.floor(Math.min(now() + 1500, info!.control.lease!.expires_at_ms)), sequence, ...size } });
        if (!isRecord(raw.body) || raw.body.kind !== 'resize' || !isRecord(raw.body.body) || raw.body.body.operation_id !== operation || raw.body.body.sequence !== sequence || !sameTerminal(raw.body.body.terminal as TerminalInfo['terminal'], info!.terminal)) throw new ContractError('Resize reply');
      }
    } catch { if (!signal.aborted) pause(); }
    finally { busy = false; if ((queue.length || pendingResize) && active()) void flush(); }
  }
  async function control(kind: 'control' | 'renew') {
    if (renewing || !info || !connected || paused || !options.allowControl || !info.input_enabled) return;
    renewing = true;
    try {
      const operation = crypto.randomUUID();
      const raw = await json(kind, '/mutations', { kind, body: { terminal: info.terminal, operation_id: operation, expected_session_revision: info.session_revision, expected_controller_generation: info.control.generation, expires_at_ms: Math.floor(now() + 14000), ...(kind === 'renew' ? { lease_id: owned } : {}) } });
      if (!isRecord(raw.body) || raw.body.kind !== 'control' || !isRecord(raw.body.body) || raw.body.body.operation_id !== operation) throw new ContractError('Control reply');
      const status = adaptControl(raw.body.body.status, info.terminal, info.session_revision);
      if (!status.lease || status.lease.expires_at_ms <= now()) throw new ContractError('Control expiry');
      owned = status.lease.lease_id; info.control = status;
      if (kind === 'control') resizeSequence = 0;
      emit('Waiting for worker control acknowledgement…');
    } catch { owned = null; queue = []; queued = 0; emit('Control unavailable — select Take control to try again'); }
    finally { renewing = false; }
  }
  async function run() {
    try {
      await inspect(); let after = 0, lastInspect = performance.now();
      while (!signal.aborted) {
        const operation = crypto.randomUUID(); const requestedUntil = Math.floor(now() + 14000);
        const raw = await json('watch', '/mutations', { kind: 'watch', body: { terminal: info!.terminal, operation_id: operation, expected_session_revision: info!.session_revision, expires_at_ms: requestedUntil, after_sequence: after } });
        const subscription = adaptWatch(raw.body, info!.terminal, operation);
        if (subscription.session_revision !== info!.session_revision || subscription.expires_at_ms > requestedUntil || subscription.expires_at_ms <= now()) throw new ContractError('Watch binding');
        while (!signal.aborted && now() + 1000 < subscription.expires_at_ms) {
          const rawTail = await json('tail', `/tail?subscription_id=${encodeURIComponent(subscription.subscription_id)}&after_sequence=${after}`);
          const tail = await adaptTerminalTail(rawTail.body, info!.terminal, subscription.subscription_id, after);
          if (tail.server_time_ms !== rawTail.serverTime || tail.session_revision !== info!.session_revision || tail.expires_at_ms !== subscription.expires_at_ms) throw new ContractError('Tail binding');
          // Tail retention describes output coverage, not the controller peer.
          // TerminalInfo is the authority for live input connectivity.
          let discontinuity = tail.gaps.length > 0;
          let previous = after;
          for (const frame of tail.frames) { if (frame.sequence !== previous + 1) discontinuity = true; previous = frame.sequence; }
          if (discontinuity || tail.availability === 'not_retained') options.reset();
          for (const frame of tail.frames) await options.write(new Uint8Array(frame.bytes));
          after = tail.next_sequence;
          emit(tail.availability === 'not_retained' ? 'Output not retained' : discontinuity ? 'Output gap — screen restarted' : tail.disconnected ? 'Output stream disconnected' : undefined);
          if (performance.now() - lastInspect >= 750) {
            await inspect(); lastInspect = performance.now();
            if (owned && info!.control.lease && info!.control.lease.expires_at_ms - now() < 6000) await control('renew');
          }
          await delay(tail.more ? 50 : 200);
        }
      }
    } catch { if (!signal.aborted) { connected = false; owned = null; queue = []; queued = 0; options.reset(); emit('Disconnected — reconnect to watch; control released'); } }
  }
  void run();
  return {
    takeControl: () => control('control'),
    async release() {
      const lease = owned; owned = null; queue = []; queued = 0; pendingResize = null; emit();
      if (!lease || !info) return;
      try { await json('release', '/mutations', { kind: 'release', body: { terminal: info.terminal, operation_id: crypto.randomUUID(), expected_session_revision: info.session_revision, expected_controller_generation: info.control.generation, lease_id: lease } }); } catch { emit('Control released locally; server lease will expire'); }
    },
    sendInput(bytes: Uint8Array) {
      if (!active() || !bytes.length) return;
      if (queued + bytes.length > 16384) { pause(); return; }
      for (let i = 0; i < bytes.length; i += 4096) queue.push(bytes.slice(i, i + 4096));
      queued += bytes.length;
      if (inputBatchTimer === undefined) inputBatchTimer = setTimeout(() => { inputBatchTimer = undefined; void flush(); }, 20);
    },
    resize(columns: number, rows: number) {
      if (!active()) return;
      pendingResize = { columns: Math.max(2, Math.min(500, columns)), rows: Math.max(1, Math.min(300, rows)) }; void flush();
    },
    close() { if (inputBatchTimer !== undefined) clearTimeout(inputBatchTimer); if (busy) pause(); abort.abort(); owned = null; queue = []; queued = 0; },
  };
}
