/** The terminal of a queued (native) session. A sandboxed attempt's pane has no
 * finite input policy: it is watched and typed into over the same disposable live
 * tmux stream as a hand-started agent, which paints the current screen on attach.
 * A terminal whose policy enables finite input keeps the finite relay client.
 */
import { adaptInteractiveInfo } from './adapters/terminalControl';
import { apiSend } from './client';
import { connectInteractiveTerminal } from './interactiveTerminalClient';
import { connectManualTerminal } from './manualTerminalClient';
import { terminalJson } from './terminalClient';
type Options = Parameters<typeof connectInteractiveTerminal>[0];
type Connection = ReturnType<typeof connectInteractiveTerminal> | ReturnType<typeof connectManualTerminal>;
/** The attempt whose live stream serves this terminal, or null for the finite relay:
 * a terminal with finite input, or one whose attempt no longer runs (the server
 * refuses the stream's connect), keeps the finite client and its retained tail. */
export async function liveAttempt(terminalId: string, signal: AbortSignal): Promise<string | null> {
  try {
    const info = adaptInteractiveInfo((await terminalJson(`/api/v1/terminals/${encodeURIComponent(terminalId)}`, signal)).body, terminalId);
    if (info.input_enabled || info.terminal.session.kind !== 'remote') return null;
    const attempt = info.terminal.session.attempt_id;
    await apiSend<unknown>('POST', `/api/attempt-terminals/${attempt}/terminal/connect`, { client_id: crypto.randomUUID() }, AbortSignal.any([signal, AbortSignal.timeout(5000)]));
    return attempt;
  } catch { return null; }
}
export function connectNativeTerminal(options: Options) {
  const abort = new AbortController();
  let inner: Connection | null = null, size: [number, number] | null = null;
  void liveAttempt(options.terminalId, abort.signal).then(attempt => {
    if (abort.signal.aborted) return;
    inner = attempt ? connectManualTerminal(options, `/api/attempt-terminals/${attempt}/terminal`) : connectInteractiveTerminal(options);
    if (size) inner.resize(...size);
  });
  return {
    takeControl: async () => { await inner?.takeControl(); },
    release: async () => { await inner?.release(); },
    sendInput(bytes: Uint8Array) { inner?.sendInput(bytes); },
    resize(columns: number, rows: number) { size = [columns, rows]; inner?.resize(columns, rows); },
    close() { abort.abort(); inner?.close(); },
  };
}
