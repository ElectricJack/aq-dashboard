import { readyFrame, fixedGrid, rawChunks } from "./manualTerminalFrames";
/** A disposable raw tmux attachment. Input is never queued or replayed across connections. */
import { apiSend } from './client';
import { isRecord } from './adapters/contract';
import { terminalInputChunks } from './terminalInput';
import type { connectInteractiveTerminal, TerminalGrid, TerminalState } from './interactiveTerminalClient';

type Options = Parameters<typeof connectInteractiveTerminal>[0];
const OUTPUT_BOUND = 1024 * 1024;
const INPUT_BOUND = 65536;

export function connectManualTerminal(options: Options, path = `/api/manual-agents/${options.terminalId}/terminal`, mode: 'manual' | 'attempt' | 'attempt-watch' = 'manual') {
  const fixed = mode !== 'manual', readOnly = mode === 'attempt-watch';
  const abort = new AbortController(), client = crypto.randomUUID();
  let socket: WebSocket | null = null;
  let closed = false, connected = false, paused = options.initiallyPaused ?? false, repainting = false;
  let generation = 0, columns = 80, rows = 24, pending = 0, tries = 0;
  let observed: number | null = null, clock: { serverMs: number; at: number } | undefined, grid: TerminalGrid | undefined;
  let writing = Promise.resolve(), failure: string | null = null, didConnect = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  const connectedMessage = readOnly ? 'Connected' : 'Connected — ready for typing';

  function canSend() { return connected && !paused && !repainting; }
  function canRetry() { return !didConnect && !paused && tries < 5; }

  function emit(message: string) {
    const state: TerminalState = {
      message, connected, controlling: !readOnly && canSend(), canControl: !readOnly && connected,
      paused, outputObservedAtMs: observed, clock, grid, canRepaint: fixed && connected && !repainting,
    };
    options.state(state);
  }

  function freeze(message: string) {
    if (closed) return;
    failure ??= message;
    paused = true;
    connected = false;
    socket?.close();
    emit(failure);
  }

  async function connect() {
    if (paused) { emit('Reconnect to inspect the same agent before typing'); return; }
    try {
      const value = await apiSend<unknown>('POST', `${path}/connect`, { client_id: client }, AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]));
      if (closed) return;
      if (!isRecord(value) || !Number.isSafeInteger(value.generation)) throw new Error('Invalid terminal connection');
      generation = Number(value.generation);
      openSocket();
    } catch {
      if (!closed) freeze('Live terminal is connecting — reconnect to the same agent');
    }
  }

  function current(ws: WebSocket) { return !closed && socket === ws; }

  function markReady(ws: WebSocket, frame: Record<string, unknown>) {
    if (!current(ws) || paused) return;
    clock = { serverMs: Number(frame.server_time_ms), at: performance.now() };
    didConnect = true;
    connected = true;
    repainting = false;
    emit(connectedMessage);
  }

  function resetGrid(ws: WebSocket, frame: Record<string, unknown>) {
    const dimensions = fixedGrid(frame);
    if (!dimensions) { freeze('Invalid terminal dimensions — reconnect'); return; }
    // Order the reset after queued output from the old attachment and before the fresh paint.
    writing = writing.then(async () => {
      if (!current(ws) || paused) return;
      grid = dimensions;
      await options.reset();
      markReady(ws, frame);
    }).catch(() => freeze('Terminal repaint interrupted — reconnect'));
  }

  function ready(ws: WebSocket, text: string) {
    let frame: Record<string, unknown>;
    try { frame = readyFrame(text); }
    catch { freeze('Invalid terminal response — reconnect'); return; }
    if (fixed) { resetGrid(ws, frame); return; }
    void options.reset();
    markReady(ws, frame);
    ws.send(JSON.stringify({ kind: 'resize', columns, rows }));
  }

  async function display(bytes: Uint8Array) {
    try {
      if (closed || paused) return;
      await options.write(bytes);
      observed = clock ? clock.serverMs + performance.now() - clock.at : Date.now();
      emit(connectedMessage);
    } finally { pending -= bytes.length; }
  }

  function output(data: unknown) {
    if (!(data instanceof ArrayBuffer) || data.byteLength > 16384) {
      freeze('Terminal output exceeded its bound — reconnect');
      return;
    }
    const bytes = new Uint8Array(data);
    pending += bytes.length;
    if (pending > OUTPUT_BOUND) { freeze('Terminal display fell behind — reconnect'); return; }
    writing = writing.then(() => display(bytes)).catch(() => freeze('Terminal display interrupted — reconnect'));
  }

  function disconnected(ws: WebSocket) {
    if (!current(ws)) return;
    if (canRetry()) {
      emit('Connecting…');
      retry = setTimeout(openSocket, Math.min(2000, 200 * 2 ** tries++));
    } else {
      freeze('Disconnected — reconnect to the same agent');
    }
  }

  function openSocket() {
    if (closed || paused) return;
    const url = new URL(`${path}/live`, window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({ client_id: client, generation: String(generation) });
    if (fixed) params.set('read_only', String(readOnly));
    else { params.set('columns', String(columns)); params.set('rows', String(rows)); }
    url.search = params.toString();
    const ws = new WebSocket(url);
    socket = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = event => {
      if (!current(ws)) return;
      if (typeof event.data === 'string') ready(ws, event.data);
      else output(event.data);
    };
    ws.onerror = () => { if (didConnect) freeze('Terminal connection interrupted — reconnect to the same agent'); };
    ws.onclose = () => disconnected(ws);
  }

  function activeSocket(): WebSocket | null {
    if (closed || !canSend()) return null;
    return socket?.readyState === WebSocket.OPEN ? socket : null;
  }

  function sendInput(bytes: Uint8Array) {
    if (readOnly || !bytes.length) return;
    const ws = activeSocket();
    if (!ws) return;
    if (ws.bufferedAmount + bytes.length > INPUT_BOUND) { freeze('Terminal input connection fell behind — reconnect'); return; }
    const chunks = fixed ? terminalInputChunks(bytes, 4096) : rawChunks(bytes);
    if (!chunks) { freeze('Incomplete terminal input — reconnect to type'); return; }
    for (const chunk of chunks) ws.send(chunk);
  }

  void connect();
  return {
    async takeControl() { /* Explicit reconnect constructs a new fenced attachment. */ },
    async release() { paused = true; connected = false; socket?.close(); },
    sendInput,
    sendEscape() {
      if (!readOnly) activeSocket()?.send(fixed ? JSON.stringify({ kind: 'escape' }) : Uint8Array.of(0x1b));
    },
    resize(c: number, r: number) {
      if (readOnly || ![c, r].every(Number.isFinite)) return;
      columns = Math.max(2, Math.min(500, Math.round(c)));
      rows = Math.max(1, Math.min(300, Math.round(r)));
      activeSocket()?.send(JSON.stringify({ kind: 'resize', columns, rows }));
    },
    repaint() {
      const ws = activeSocket();
      if (!fixed || !ws) return;
      repainting = true;
      emit('Repainting terminal…');
      ws.send(JSON.stringify({ kind: 'repaint' }));
    },
    close() {
      closed = true;
      if (retry) clearTimeout(retry);
      abort.abort();
      socket?.close();
      socket = null;
      connected = false;
    },
  };
}
