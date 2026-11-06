/** V1 terminalSocket lifecycle adapted to v2's authenticated finite-input relay.
 * Raw bytes never retry; receipt lookup is the only recovery after a POST failure.
 */
import { adaptControl, adaptInputReceipt, adaptInteractiveInfo, type TerminalInfo } from './adapters/terminalControl';
import { adaptTerminalTail, adaptWatch, sameTerminal } from './adapters/terminalTail';
import { isRecord, ContractError } from './adapters/contract';
import { terminalJson } from './terminalClient';
import { isRetryableError, retryDelayMs } from './retry';
export interface TerminalLease { mine: boolean; expiresAtMs: number }
/** `clock` maps the last server time header onto `performance.now()` so a view can count down server-time facts. */
export interface TerminalState { message: string; connected: boolean; controlling: boolean; canControl: boolean; paused: boolean;
  lease?: TerminalLease | null; clock?: { serverMs: number; at: number }; outputObservedAtMs?: number | null;
  /** The identity and epoch this connection observed; a reconnect passes it back as `expect`. */
  binding?: TerminalBinding }
export interface TerminalBinding { terminal: TerminalInfo['terminal']; session_revision: number }
class EpochChanged extends Error {}
class NotDelivered extends Error {}
type Read = (part: string, fetcher: () => ReturnType<typeof terminalJson>) => ReturnType<typeof terminalJson>;
/** Consecutive retryable failures before the watch stops and waits for an explicit Reconnect. */
export const MAX_AUTOMATIC_RECONNECTS = 6;
/**
 * Poll cadence (N-02). Output arriving: fast. Watch-only and idle: back off to
 * 2 s. Controlling: stay at 200 ms so typed input echoes promptly. Nothing
 * retained on a disconnected terminal: stop tailing, re-check its info slowly.
 */
export const TERMINAL_CADENCE = { more: 50, output: 200, idleMax: 2000, inspectWatching: 3000, inspectControlling: 750, dormantMin: 5000, dormantMax: 30000 } as const;
/** `expect` pins a reconnect to the identity and epoch seen before: a changed binding is reported, never watched. */
export function connectInteractiveTerminal(options: { terminalId: string; allowControl: boolean; initiallyPaused?: boolean; expect?: TerminalBinding | null; read: Read; write: (bytes: Uint8Array) => Promise<void>; reset: () => void; state: (state: TerminalState) => void;
  /** Wait before automatic reconnect `attempt` (0-based); tests shorten it. */
  reconnectDelay?: (attempt: number, error: unknown) => number }) {
  const abort = new AbortController(), { signal } = abort;
  const path = `/api/v1/terminals/${encodeURIComponent(options.terminalId)}`;
  let info: TerminalInfo | undefined, clock = 0, clockAt = 0, owned: string | null = null;
  let paused = options.initiallyPaused ?? false, connected = false, busy = false, queue: Uint8Array[] = [], queued = 0, resizeSequence = 0, renewing = false;
  let outputObservedAtMs: number | null = null;
  const acquired = new Set<string>();
  let inputBatchTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingResize: { columns: number; rows: number } | null = null;
  const now = () => clock + performance.now() - clockAt;
  const active = () => !!(connected && !paused && info?.input_enabled && !info.disconnected && info.control.fence_acknowledged && !info.control.input_paused && info.control.lease?.lease_id === owned && info.control.lease.expires_at_ms > now());
  const emit = (message = active() ? 'You have control' : paused ? 'Input delivery uncertain — typing paused' : connected ? 'Watch only' : 'Connecting…') => {
    if (signal.aborted) return;
    const lease = connected && info?.control.lease ? { mine: acquired.has(info.control.lease.lease_id), expiresAtMs: info.control.lease.expires_at_ms } : null;
    options.state({ message, connected, controlling: active(), canControl: !!(info?.input_enabled && options.allowControl && !paused), paused, lease, clock: { serverMs: clock, at: clockAt }, outputObservedAtMs, binding: info ? { terminal: info.terminal, session_revision: info.session_revision } : undefined });
  };
  const request: Read = async (part, fetcher) => {
    const value = await options.read(part, fetcher);
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    clock = value.serverTime; clockAt = performance.now(); return value;
  };
  const json = (part: string, suffix = '', body?: unknown) => request(part, () => terminalJson(path + suffix, signal, body));
  // `wake` ends the current poll wait early, e.g. after control is acquired.
  const sleeping = new Set<() => void>(); let inspectNow = false;
  const wake = () => { inspectNow = true; for (const end of [...sleeping]) end(); };
  const delay = (ms: number) => new Promise<void>(resolve => {
    const end = () => { clearTimeout(timer); signal.removeEventListener('abort', end); sleeping.delete(end); resolve(); };
    const timer = setTimeout(end, ms); signal.addEventListener('abort', end, { once: true }); sleeping.add(end);
  });
  const reconnectDelay = options.reconnectDelay ?? ((attempt: number, error: unknown) => retryDelayMs(attempt + 1, error));
  async function inspect() {
    const raw = await json('info'); const next = adaptInteractiveInfo(raw.body, options.terminalId);
    const pinned = !info && options.expect;
    if (pinned && (!sameTerminal(next.terminal, pinned.terminal) || next.session_revision !== pinned.session_revision)) throw new EpochChanged();
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
      if (r.input_paused || r.disposition === 'delivery_unknown') throw new Error('Input not confirmed');
      if (r.disposition === 'expired' || r.disposition === 'rejected') throw new NotDelivered(`Input ${r.disposition} — type again`);
      await delay(100); body = undefined;
    }
    throw new Error('Receipt not confirmed');
  }
  async function flush() {
    if (busy || !active()) return;
    busy = true; let inputInFlight = false;
    try {
      while (queue.length && active()) {
        // Preserve byte order while amortizing one durable receipt across a burst.
        const chunks: Uint8Array[] = []; let length = 0;
        while (queue.length && length + queue[0]!.length <= 4096) { const next = queue.shift()!; chunks.push(next); length += next.length; }
        const bytes = new Uint8Array(length); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        queued -= bytes.length;
        const operation = crypto.randomUUID(); const binding = fields(); inputInFlight = true;
        let body: unknown;
        try {
          const raw = await json(`input-${operation}`, '/mutations', { kind: 'input', body: { ...binding, operation_id: operation, expires_at_ms: Math.floor(Math.min(now() + 1500, info!.control.lease!.expires_at_ms)), bytes: [...bytes] } });
          if (!isRecord(raw.body) || raw.body.kind !== 'input') throw new ContractError('Input reply');
          body = raw.body.body;
        } catch { /* The operation may already exist: never replay its bytes. */ }
        await receipt(operation, body); inputInFlight = false;
      }
      if (pendingResize && active()) {
        const size = pendingResize; pendingResize = null;
        const operation = crypto.randomUUID(), sequence = ++resizeSequence;
        const raw = await json('resize', '/mutations', { kind: 'resize', body: { ...fields(), operation_id: operation, expires_at_ms: Math.floor(Math.min(now() + 1500, info!.control.lease!.expires_at_ms)), sequence, ...size } });
        if (!isRecord(raw.body) || raw.body.kind !== 'resize' || !isRecord(raw.body.body) || raw.body.body.operation_id !== operation || raw.body.body.sequence !== sequence || !sameTerminal(raw.body.body.terminal as TerminalInfo['terminal'], info!.terminal)) throw new ContractError('Resize reply');
      }
    } catch (error) { if (!signal.aborted) {
      if (error instanceof NotDelivered) { queue = []; queued = 0; emit(error.message); }
      else if (inputInFlight) pause();
      else emit('Resize unavailable — keyboard control retained');
    } }
    finally { busy = false; if ((queue.length || pendingResize) && active()) void flush(); }
  }
  async function control(kind: 'control' | 'renew') {
    if (renewing || !info || (kind === 'renew' && !connected) || paused || !options.allowControl || !info.input_enabled) return;
    renewing = true;
    try {
      const operation = crypto.randomUUID();
      const raw = await json(kind, '/mutations', { kind, body: { terminal: info.terminal, operation_id: operation, expected_session_revision: info.session_revision, expected_controller_generation: info.control.generation, expires_at_ms: Math.floor(now() + 14000), ...(kind === 'renew' ? { lease_id: owned } : {}) } });
      if (!isRecord(raw.body) || raw.body.kind !== 'control' || !isRecord(raw.body.body) || raw.body.body.operation_id !== operation) throw new ContractError('Control reply');
      const status = adaptControl(raw.body.body.status, info.terminal, info.session_revision);
      if (!status.lease || status.lease.expires_at_ms <= now()) throw new ContractError('Control expiry');
      owned = status.lease.lease_id; acquired.add(owned); info.control = status;
      if (kind === 'control') resizeSequence = 0;
      emit('Waiting for worker control acknowledgement…'); wake();
    } catch { owned = null; queue = []; queued = 0; emit('Control unavailable — select Take control to try again'); }
    finally { renewing = false; }
  }
  let after = 0, failures = 0, availability: string | undefined;
  async function watch() {
    await inspect(); let lastInspect = performance.now(), idle = 0, dormant = false, dormantMs: number = TERMINAL_CADENCE.dormantMin;
    while (!signal.aborted) {
      if (dormant) {
        // Nothing is retained and the terminal is gone: no tail can return output, so only re-check its info.
        emit('Output not retained');
        await delay(dormantMs); dormantMs = Math.min(TERMINAL_CADENCE.dormantMax, dormantMs * 2);
        if (signal.aborted) return;
        await inspect(); lastInspect = performance.now(); inspectNow = false;
        if (info!.disconnected) continue;
        dormant = false; dormantMs = TERMINAL_CADENCE.dormantMin;
      }
      const operation = crypto.randomUUID(); const requestedUntil = Math.floor(now() + 14000);
      const raw = await json('watch', '/mutations', { kind: 'watch', body: { terminal: info!.terminal, operation_id: operation, expected_session_revision: info!.session_revision, expires_at_ms: requestedUntil, after_sequence: after } });
      const subscription = adaptWatch(raw.body, info!.terminal, operation);
      if (subscription.session_revision !== info!.session_revision || subscription.expires_at_ms > requestedUntil || subscription.expires_at_ms <= now()) throw new ContractError('Watch binding');
      while (!signal.aborted && now() + 1000 < subscription.expires_at_ms) {
        const rawTail = await json('tail', `/tail?subscription_id=${encodeURIComponent(subscription.subscription_id)}&after_sequence=${after}`);
        const tail = await adaptTerminalTail(rawTail.body, info!.terminal, subscription.subscription_id, after);
        if (tail.server_time_ms !== rawTail.serverTime || tail.session_revision !== info!.session_revision || tail.expires_at_ms !== subscription.expires_at_ms) throw new ContractError('Tail binding');
        failures = 0;
        // Tail retention describes output coverage, not the controller peer.
        // TerminalInfo is the authority for live input connectivity.
        let discontinuity = tail.gaps.length > 0;
        let previous = after;
        for (const frame of tail.frames) { if (frame.sequence !== previous + 1) discontinuity = true; previous = frame.sequence; }
        const retained = tail.availability !== 'not_retained';
        // Restart the screen when coverage breaks, not on every tail that still has nothing retained.
        if (discontinuity || (!retained && availability !== 'not_retained')) options.reset();
        availability = tail.availability;
        for (const frame of tail.frames) await options.write(new Uint8Array(frame.bytes));
        after = tail.next_sequence;
        outputObservedAtMs = tail.last_observed_at_ms;
        emit(!retained ? 'Output not retained' : discontinuity ? 'Output gap — screen restarted' : tail.disconnected ? 'Output stream disconnected' : undefined);
        if (inspectNow || performance.now() - lastInspect >= (owned ? TERMINAL_CADENCE.inspectControlling : TERMINAL_CADENCE.inspectWatching)) {
          inspectNow = false; await inspect(); lastInspect = performance.now();
          if (owned && info!.control.lease && info!.control.lease.expires_at_ms - now() < 6000) await control('renew');
        }
        if (!retained && !owned && (tail.disconnected || info!.disconnected)) { dormant = true; break; }
        idle = tail.frames.length ? 0 : idle + 1;
        await delay(tail.more ? TERMINAL_CADENCE.more : tail.frames.length || owned ? TERMINAL_CADENCE.output : Math.min(TERMINAL_CADENCE.idleMax, TERMINAL_CADENCE.output * 2 ** idle));
      }
    }
  }
  async function run() {
    while (!signal.aborted) {
      try { await watch(); return; }
      catch (error) {
        if (signal.aborted) return;
        connected = false; owned = null; queue = []; queued = 0;
        // A changed epoch is a different terminal: keep the last observation and do not attach to it.
        if (error instanceof EpochChanged) { emit('Terminal epoch changed — this is no longer the terminal you were watching; open the session again'); return; }
        // N-01: capacity and unavailability clear by themselves; reattach the same terminal with backoff.
        if (isRetryableError(error) && failures < MAX_AUTOMATIC_RECONNECTS) {
          const wait = reconnectDelay(failures++, error);
          emit(`Reconnecting… (attempt ${failures} of ${MAX_AUTOMATIC_RECONNECTS}); control released`);
          await delay(wait); continue;
        }
        options.reset(); emit('Disconnected — reconnect to watch; control released'); return;
      }
    }
  }
  void run();
  return {
    takeControl: () => control('control'),
    async release() {
      const lease = owned; owned = null; queue = []; queued = 0; pendingResize = null;
      // The release reply ends this lease; stop showing its countdown now, not at the next inspect.
      if (lease && info?.control.lease?.lease_id === lease) info.control = { ...info.control, lease: null };
      emit();
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
