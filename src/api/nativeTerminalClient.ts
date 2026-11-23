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

function viewerStatus(finite: TerminalState, viewer: TerminalState): TerminalState {
  return {
    ...finite, connected: viewer.connected, controlling: !!viewer.canRepaint && finite.controlling,
    outputObservedAtMs: viewer.outputObservedAtMs, grid: viewer.grid, canRepaint: viewer.canRepaint,
    message: viewer.canRepaint ? finite.message : viewer.message,
  };
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
      options.state(viewerStatus(finiteState, viewerState));
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

  function updateViewer(next: TerminalState) {
    viewerState = next;
    if (!showingViewer && next.paused) {
      viewer?.close();
      viewer = null;
      if (finiteState) options.state({ ...finiteState, canRepaint: true, message: 'Repaint unavailable' });
      return;
    }
    emit();
  }

  async function resetViewer() {
    showingViewer = true;
    await finiteWrite;
    if (!abort.signal.aborted) await options.reset();
  }

  function startViewer(target: NativeAttempt) {
    if (!finiteState?.connected) return;
    viewer = connectManualTerminal({
      ...options, initiallyPaused: false,
      reset: resetViewer,
      state: updateViewer,
    }, livePath(target), 'attempt-watch');
    emit();
  }

  function repaint() {
    if (viewer) { viewer.repaint?.(); return; }
    if (attempt?.finiteInput) startViewer(attempt);
    else input?.repaint?.();
  }

  const acceptsKeyboard = () => !showingViewer || viewerState?.canRepaint;

  return {
    takeControl: async () => { await input?.takeControl(); },
    // Start both releases now: their synchronous state must land before the caller's own (Disconnected).
    release: async () => { await Promise.all([viewer?.release(), input?.release()]); },
    sendInput(bytes) { if (acceptsKeyboard()) input?.sendInput(bytes); },
    sendEscape() { if (acceptsKeyboard()) input?.sendEscape(); },
    repaint,
    // The read-only repaint viewer keeps the geometry it attached with; only the current controller resizes.
    resize(columns, rows) { if (!showingViewer) input?.resize?.(columns, rows); },
    close() { abort.abort(); viewer?.close(); input?.close(); },
  };
}
