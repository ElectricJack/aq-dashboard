/** V1 terminalSocket lifecycle adapted to v2's authenticated finite-input relay.
 * Raw bytes never retry; receipt lookup is the only recovery after a POST failure.
 */
import { adaptInputReceipt, adaptInteractiveInfo, type TerminalInfo } from './adapters/terminalControl';
import { adaptTerminalTail, adaptWatch } from './adapters/terminalTail';
import { ContractError } from './adapters/contract';
import { terminalInputChunks } from './terminalInput';
import { terminalJson } from './terminalClient';
import { isRetryableError, retryDelayMs } from './retry';
import {
  canWrite, checkResizeReply, controlLease, delivered, heldByOtherViewer, inputReply, nextInputBatch, NotDelivered, outputGap, outputMessage, sameBinding,
  type InputPacket, type Tail, type Watch,
} from './interactiveTerminalProtocol';

export interface TerminalGrid { columns: number; rows: number }
export interface TerminalConnection {
  takeControl(): Promise<void>;
  release(): Promise<void>;
  sendInput(bytes: Uint8Array): void;
  sendEscape(): void;
  resize?(columns: number, rows: number): void;
  repaint?(): void;
  close(): void;
}
export interface TerminalLease { mine: boolean; expiresAtMs: number }
/** `clock` maps the last server time header onto `performance.now()` so a view can count down server-time facts. */
export interface TerminalState { message: string; connected: boolean; controlling: boolean; canControl: boolean; paused: boolean;
  lease?: TerminalLease | null; clock?: { serverMs: number; at: number }; outputObservedAtMs?: number | null;
  /** The identity and epoch this connection observed; a reconnect passes it back as `expect`. */
  binding?: TerminalBinding; grid?: TerminalGrid; canRepaint?: boolean; inputDeliveryUncertain?: boolean;
  /** Identifies a controller change between connections. */
  notice?: string | null }
export const TAKEOVER_NOTICE_LOST = 'Another connection is using this terminal. Reconnect to interact.';
export const TAKEOVER_NOTICE_TOOK = 'You took control from another viewer.';
export interface TerminalBinding { terminal: TerminalInfo['terminal']; session_revision: number }
class EpochChanged extends Error {}
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
export function connectInteractiveTerminal(options: { terminalId: string; allowControl: boolean; initiallyPaused?: boolean; expect?: TerminalBinding | null; read: Read; write: (bytes: Uint8Array) => Promise<void>; reset: () => void | Promise<void>; state: (state: TerminalState) => void;
  /** Wait before automatic reconnect `attempt` (0-based); tests shorten it. */
  reconnectDelay?: (attempt: number, error: unknown) => number }): TerminalConnection {
  const abort = new AbortController(), { signal } = abort;
  const path = `/api/v1/terminals/${encodeURIComponent(options.terminalId)}`;
  let info: TerminalInfo | undefined, clock = 0, clockAt = 0, owned: string | null = null;
  let paused = options.initiallyPaused ?? false, connected = false, busy = false, queue: InputPacket[] = [], queued = 0, renewing = false;
  let inputDeliveryUncertain = paused;
  let outputObservedAtMs: number | null = null;
  let notice: string | null = null;
  const acquired = new Set<string>();
  let inputBatchTimer: ReturnType<typeof setTimeout> | undefined;
  let grid: TerminalGrid | undefined;
  const now = () => clock + performance.now() - clockAt;
  const active = () => !!(connected && !paused && info && canWrite(info, owned, now()));
  function statusMessage() {
    if (active()) return 'You have control';
    if (paused) return 'Input delivery uncertain — typing paused';
    return connected ? 'Waiting for interactive connection' : 'Connecting…';
  }
  function displayLease(): TerminalLease | null {
    const held = connected && info?.control.lease;
    return held ? { mine: acquired.has(held.lease_id), expiresAtMs: held.expires_at_ms } : null;
  }
  const emit = (message = statusMessage()) => {
    if (signal.aborted) return;
    const lease = displayLease();
    options.state({ message, connected, controlling: active(), canControl: !!(info?.input_enabled && options.allowControl && !paused), paused, lease, clock: { serverMs: clock, at: clockAt }, outputObservedAtMs, grid, inputDeliveryUncertain, notice, binding: info ? { terminal: info.terminal, session_revision: info.session_revision } : undefined });
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
  function clearQueue() { queue = []; queued = 0; }

  function loseLease(next: TerminalInfo) {
    owned = null;
    clearQueue();
    const lease = next.control.lease;
    if (lease && !acquired.has(lease.lease_id)) notice = TAKEOVER_NOTICE_LOST;
  }

  function validateBinding(next: TerminalInfo) {
    const previous = info ?? options.expect;
    if (!previous || sameBinding(next, previous)) return;
    if (info) throw new ContractError('Terminal binding changed');
    throw new EpochChanged();
  }

  async function inspect() {
    const raw = await json('info'); const next = adaptInteractiveInfo(raw.body, options.terminalId);
    validateBinding(next);
    info = next;
    if (info.control.input_paused) { paused = true; inputDeliveryUncertain = true; clearQueue(); }
    if (owned && info.control.lease?.lease_id !== owned) loseLease(info);
    connected = !info.disconnected; emit();
  }
  function fields() {
    const lease = active() ? owned : null;
    if (!info || !lease) throw new Error('Control unavailable');
    return { terminal: info.terminal, lease_id: lease, expected_controller_generation: info.control.generation, expected_session_revision: info.session_revision };
  }
  // Resize is a controller action: it needs the same acknowledged lease as input, but never carries or implies input.
  // `sequence` must exceed the terminal's last resize, so it is the server-clock millisecond, kept strictly increasing.
  let resizeSequence = 0, resizing = false, resizePending: TerminalGrid | undefined;
  async function sendResize(size: TerminalGrid) {
    const operation = crypto.randomUUID();
    resizeSequence = Math.max(resizeSequence + 1, Math.floor(now()));
    const raw = await json(`resize-${operation}`, '/mutations', { kind: 'resize', body: {
      ...fields(), operation_id: operation, expires_at_ms: inputExpiry(), sequence: resizeSequence, ...size,
    } });
    checkResizeReply(raw.body);
  }

  function inputExpiry() { return Math.floor(Math.min(now() + 1500, info!.control.lease!.expires_at_ms)); }

  async function flushResize() {
    if (resizing) return;
    resizing = true;
    try {
      while (resizePending && active()) {
        const size = resizePending;
        resizePending = undefined;
        await sendResize(size);
      }
    } catch { if (!signal.aborted) emit('Terminal resize not applied'); }
    finally {
      resizing = false;
      const pending = !signal.aborted && resizePending;
      if (pending && active()) void flushResize();
    }
  }
  function pause(message?: string, deliveryUncertain = false) {
    paused = true; inputDeliveryUncertain ||= deliveryUncertain; clearQueue(); emit(message);
  }
  async function receipt(operation: string, initial?: unknown) {
    if (!info) throw new Error('No binding');
    let body = initial;
    for (let n = 0; n < 15 && !signal.aborted; n++) {
      if (body === undefined) body = (await json(`receipt-${operation}`, `/receipts/${operation}`)).body;
      const r = adaptInputReceipt(body, info.terminal, operation);
      if (delivered(r)) return;
      await delay(100); body = undefined;
    }
    throw new Error('Receipt not confirmed');
  }
  async function submitPacket(packet: InputPacket, operation: string, binding: ReturnType<typeof fields>) {
    let initial: unknown;
    try {
      const raw = await json(`input-${operation}`, '/mutations', { kind: 'input', body: {
        ...binding, operation_id: operation, expires_at_ms: inputExpiry(), bytes: [...packet.bytes],
        ...(packet.escapeKey ? { escape_key: true } : {}),
      } });
      initial = inputReply(raw.body);
    } catch { /* The operation may already exist; only its receipt can establish delivery. */ }
    await receipt(operation, initial);
  }

  function inputFailed(error: unknown, inFlight: boolean) {
    if (signal.aborted) return;
    if (error instanceof NotDelivered) { clearQueue(); emit(error.message); }
    else if (inFlight) pause(undefined, true);
    else emit('Terminal input unavailable');
  }

  async function flush() {
    if (busy || !active()) return;
    busy = true;
    let inFlight = false;
    try {
      while (queue.length && active()) {
        const packet = nextInputBatch(queue, info!.maxInputBytes);
        queued -= packet.bytes.length;
        const operation = crypto.randomUUID(), binding = fields();
        inFlight = true;
        await submitPacket(packet, operation, binding);
        inFlight = false;
      }
    } catch (error) { inputFailed(error, inFlight); }
    finally { busy = false; if (queue.length && active()) void flush(); }
  }
  async function control(kind: 'control' | 'renew') {
    if (renewing || !info || (kind === 'renew' && !connected) || paused || !options.allowControl || !info.input_enabled) return;
    renewing = true;
    const tookControl = kind === 'control' && heldByOtherViewer(info, acquired, now());
    try {
      const operation = crypto.randomUUID();
      const raw = await json(kind, '/mutations', { kind, body: { terminal: info.terminal, operation_id: operation, expected_session_revision: info.session_revision, expected_controller_generation: info.control.generation, expires_at_ms: Math.floor(now() + 14000), ...(kind === 'renew' ? { lease_id: owned } : {}) } });
      const { status, lease } = controlLease(raw.body, operation, info, now);
      owned = lease.lease_id; acquired.add(owned); info.control = status;
      if (kind === 'control') { notice = tookControl ? TAKEOVER_NOTICE_TOOK : null; }
      emit('Waiting for worker control acknowledgement…'); wake();
    } catch { owned = null; clearQueue(); emit('Interactive connection unavailable — reconnect to try again'); }
    finally { renewing = false; }
  }
  let after = 0, failures = 0, availability: string | undefined;
  async function readTail(subscription: Watch): Promise<Tail> {
    const raw = await json('tail', `/tail?subscription_id=${encodeURIComponent(subscription.subscription_id)}&after_sequence=${after}`);
    const tail = await adaptTerminalTail(raw.body, info!.terminal, subscription.subscription_id, after);
    const sameClock = tail.server_time_ms === raw.serverTime && tail.expires_at_ms === subscription.expires_at_ms;
    if (!sameClock || tail.session_revision !== info!.session_revision) throw new ContractError('Tail binding');
    return tail;
  }

  function updateGrid(tail: Tail) {
    if (!tail.grid) return;
    const [columns, rows] = tail.grid;
    if (columns === grid?.columns && rows === grid.rows) return;
    grid = { columns, rows };
    emit();
  }

  async function renderTail(tail: Tail) {
    updateGrid(tail);
    const gap = outputGap(tail, after);
    const retained = tail.availability !== 'not_retained';
    // Restart once on a transition to missing coverage, or whenever output contains a gap.
    const lostCoverage = !retained && availability !== 'not_retained';
    if (gap || lostCoverage) await options.reset();
    availability = tail.availability;
    for (const frame of tail.frames) await options.write(new Uint8Array(frame.bytes));
    after = tail.next_sequence;
    outputObservedAtMs = tail.last_observed_at_ms;
    emit(outputMessage(tail, gap));
    return retained;
  }

  type PollState = { lastInspect: number; idle: number; dormant: boolean; dormantMs: number };

  async function subscribe() {
    const operation = crypto.randomUUID();
    const requestedUntil = Math.floor(now() + 14000);
    const raw = await json('watch', '/mutations', { kind: 'watch', body: {
      terminal: info!.terminal, operation_id: operation, expected_session_revision: info!.session_revision,
      expires_at_ms: requestedUntil, after_sequence: after,
    } });
    const subscription = adaptWatch(raw.body, info!.terminal, operation);
    const validExpiry = subscription.expires_at_ms <= requestedUntil && subscription.expires_at_ms > now();
    if (subscription.session_revision !== info!.session_revision || !validExpiry) throw new ContractError('Watch binding');
    return subscription;
  }

  async function refreshControl(state: PollState) {
    const cadence = owned ? TERMINAL_CADENCE.inspectControlling : TERMINAL_CADENCE.inspectWatching;
    if (!inspectNow && performance.now() - state.lastInspect < cadence) return;
    inspectNow = false;
    await inspect();
    state.lastInspect = performance.now();
    const lease = owned && info!.control.lease;
    if (lease && lease.expires_at_ms - now() < 6000) await control('renew');
  }

  function pollDelay(tail: Tail, idle: number) {
    if (tail.more) return TERMINAL_CADENCE.more;
    if (tail.frames.length || owned) return TERMINAL_CADENCE.output;
    return Math.min(TERMINAL_CADENCE.idleMax, TERMINAL_CADENCE.output * 2 ** idle);
  }

  async function poll(subscription: Watch, state: PollState) {
    while (!signal.aborted && now() + 1000 < subscription.expires_at_ms) {
      const tail = await readTail(subscription);
      failures = 0;
      const retained = await renderTail(tail);
      await refreshControl(state);
      const disconnected = tail.disconnected || info!.disconnected;
      const noOutputOrController = !retained && !owned;
      if (disconnected && noOutputOrController) { state.dormant = true; return; }
      state.idle = tail.frames.length ? 0 : state.idle + 1;
      await delay(pollDelay(tail, state.idle));
    }
  }

  async function inspectDormant(state: PollState) {
    emit('Output not retained');
    await delay(state.dormantMs);
    state.dormantMs = Math.min(TERMINAL_CADENCE.dormantMax, state.dormantMs * 2);
    if (signal.aborted) return;
    await inspect();
    state.lastInspect = performance.now();
    inspectNow = false;
    state.dormant = info!.disconnected;
    if (!state.dormant) state.dormantMs = TERMINAL_CADENCE.dormantMin;
  }

  async function watch() {
    await inspect();
    if (options.allowControl) await control('control');
    const state: PollState = { lastInspect: performance.now(), idle: 0, dormant: false, dormantMs: TERMINAL_CADENCE.dormantMin };
    while (!signal.aborted) {
      if (state.dormant) {
        await inspectDormant(state);
        if (state.dormant || signal.aborted) continue;
      }
      await poll(await subscribe(), state);
    }
  }
  async function run() {
    while (!signal.aborted) {
      try { await watch(); return; }
      catch (error) {
        if (signal.aborted) return;
        connected = false; owned = null; clearQueue();
        // A changed epoch is a different terminal: keep the last observation and do not attach to it.
        if (error instanceof EpochChanged) { emit('Terminal epoch changed — this is no longer the terminal you were watching; open the session again'); return; }
        // N-01: capacity and unavailability clear by themselves; reattach the same terminal with backoff.
        if (isRetryableError(error) && failures < MAX_AUTOMATIC_RECONNECTS) {
          const wait = reconnectDelay(failures++, error);
          emit(`Reconnecting… (attempt ${failures} of ${MAX_AUTOMATIC_RECONNECTS}); control released`);
          await delay(wait); continue;
        }
        await options.reset(); emit('Disconnected — reconnect to watch; control released'); return;
      }
    }
  }
  function enqueue(packets: InputPacket[], length: number) {
    queue.push(...packets); queued += length;
    if (inputBatchTimer === undefined) inputBatchTimer = setTimeout(() => { inputBatchTimer = undefined; void flush(); }, 20);
  }
  void run();
  return {
    takeControl: () => { notice = null; return control('control'); },
    async release() {
      const lease = owned; owned = null; clearQueue(); notice = null;
      // The release reply ends this lease; stop showing its countdown now, not at the next inspect.
      if (lease && info?.control.lease?.lease_id === lease) info.control = { ...info.control, lease: null };
      emit();
      if (!lease || !info) return;
      try { await json('release', '/mutations', { kind: 'release', body: { terminal: info.terminal, operation_id: crypto.randomUUID(), expected_session_revision: info.session_revision, expected_controller_generation: info.control.generation, lease_id: lease } }); } catch { emit('Control released locally; server lease will expire'); }
    },
    sendInput(bytes) {
      if (!active() || !bytes.length) return;
      if (queued + bytes.length > info!.maxPendingInputBytes) { pause(); return; }
      const chunks = terminalInputChunks(bytes, info!.maxInputBytes);
      if (!chunks) { pause('Incomplete terminal input — reconnect to type'); return; }
      enqueue(chunks.map(bytes => ({ bytes })), bytes.length);
    },
    sendEscape() {
      if (!active()) return;
      if (queued >= info!.maxPendingInputBytes) { pause(); return; }
      enqueue([{ bytes: Uint8Array.of(0x1b), escapeKey: true }], 1);
    },
    resize(columns, rows) {
      if (!active() || ![columns, rows].every(Number.isFinite)) return;
      // The latest size wins while one is in flight; each request still binds the lease and generation it was made under.
      resizePending = { columns: Math.max(1, Math.min(1000, Math.round(columns))), rows: Math.max(1, Math.min(1000, Math.round(rows))) };
      void flushResize();
    },
    close() { if (inputBatchTimer !== undefined) clearTimeout(inputBatchTimer); if (busy) pause(undefined, true); abort.abort(); owned = null; clearQueue(); },
  };
}
