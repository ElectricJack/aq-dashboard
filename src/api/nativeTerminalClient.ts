/** Queued attempts have a finite relay and, on the sandbox worker, a live tmux
 * viewer. When finite input is offered, it remains the keyboard authority. */
import { adaptInteractiveInfo } from './adapters/terminalControl';
import { sameTerminal } from './adapters/terminalTail';
import { apiSend } from './client';
import { connectInteractiveTerminal, type TerminalConnection, type TerminalState } from './interactiveTerminalClient';
import { connectManualTerminal } from './manualTerminalClient';
import { terminalJson } from './terminalClient';

type Options = Parameters<typeof connectInteractiveTerminal>[0];
interface NativeAttempt { id: string; finiteInput: boolean }
const livePath = (attempt: NativeAttempt) => `/api/attempt-terminals/${attempt.id}/terminal`;

export async function liveAttempt(terminalId: string, signal: AbortSignal, expect?: Options['expect']): Promise<NativeAttempt | null> {
  try {
    const info = adaptInteractiveInfo((await terminalJson(`/api/v1/terminals/${encodeURIComponent(terminalId)}`, signal)).body, terminalId);
    if (info.terminal.session.kind !== 'remote' ||
      (expect && (!sameTerminal(expect.terminal, info.terminal) || expect.session_revision !== info.session_revision))) return null;
    const attempt = { id: info.terminal.session.attempt_id, finiteInput: info.input_enabled };
    // A finite session uses the raw attachment only when the viewer asks for
    // a fresh screen. Keep its receipt-based input path in either view.
    if (!attempt.finiteInput) {
      await apiSend<unknown>('POST', `${livePath(attempt)}/connect`, { client_id: crypto.randomUUID() }, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    }
    return attempt;
  } catch {
    return null;
  }
}

export function connectNativeTerminal(options: Options): TerminalConnection {
  const abort = new AbortController();
  let attempt: NativeAttempt | null = null;
  let input: TerminalConnection | null = null, viewer: TerminalConnection | null = null;
  let finiteState: TerminalState | undefined, viewerState: TerminalState | undefined;
  let showingViewer = false, finiteWrite: Promise<void> | undefined;
  const emit = () => {
    if (!finiteState) return;
    if (showingViewer && viewerState) {
      options.state({
        ...finiteState, connected: viewerState.connected,
        controlling: !!viewerState.canRepaint && finiteState.controlling,
        outputObservedAtMs: viewerState.outputObservedAtMs,
        grid: viewerState.grid, canRepaint: viewerState.canRepaint,
        message: viewerState.canRepaint ? finiteState.message : viewerState.message,
      });
      return;
    }
    options.state({ ...finiteState, canRepaint: !!attempt?.finiteInput && finiteState.connected && !viewer });
  };
  void liveAttempt(options.terminalId, abort.signal, options.expect).then(selected => {
    if (abort.signal.aborted) return;
    attempt = selected;
    if (attempt && !attempt.finiteInput) {
      input = connectManualTerminal(options, livePath(attempt), 'attempt');
      return;
    }
    input = connectInteractiveTerminal({
      ...options,
      write: bytes => showingViewer ? Promise.resolve() : (finiteWrite = options.write(bytes)),
      reset: () => { if (!showingViewer) options.reset(); },
      state: next => { finiteState = next; emit(); },
    });
  });

  function repaint() {
    if (viewer) { viewer.repaint?.(); return; }
    if (!attempt?.finiteInput) { input?.repaint?.(); return; }
    if (!finiteState?.connected) return;
    viewer = connectManualTerminal({
      ...options, initiallyPaused: false,
      reset: async () => {
        showingViewer = true;
        await finiteWrite;
        if (!abort.signal.aborted) await options.reset();
      },
      state: next => {
        viewerState = next;
        if (!showingViewer && next.paused) {
          viewer?.close(); viewer = null;
          if (finiteState) options.state({ ...finiteState, canRepaint: true, message: 'Repaint unavailable' });
          return;
        }
        emit();
      },
    }, livePath(attempt), 'attempt-watch');
    emit();
  }

  return {
    takeControl: async () => { await input?.takeControl(); },
    // Start both releases now: their synchronous state must land before the caller's own (Disconnected).
    release: async () => { await Promise.all([viewer?.release(), input?.release()]); },
    sendInput(bytes) { if (!showingViewer || viewerState?.canRepaint) input?.sendInput(bytes); },
    sendEscape() { if (!showingViewer || viewerState?.canRepaint) input?.sendEscape(); },
    repaint,
    // The read-only repaint viewer keeps the geometry it attached with; only the current controller resizes.
    resize(columns, rows) { if (!showingViewer) input?.resize?.(columns, rows); },
    close() { abort.abort(); viewer?.close(); input?.close(); },
  };
}
