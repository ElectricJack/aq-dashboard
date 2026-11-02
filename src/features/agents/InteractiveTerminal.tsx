import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/session';
import { queryKey } from '../../api/queryKeys';
import { connectInteractiveTerminal, type TerminalState } from '../../api/interactiveTerminalClient';
import { terminalOptions, guardUntrustedOutput, guardObservedTerminalQueries } from './terminal/terminalSetup';
import { canFocusTerminal } from './terminal/terminalFocus';
import { attachTouchScroll } from './terminal/terminalTouchScroll';
import { ActionButton } from '../../components/layout/Workspace';
import { TerminalTail } from './TerminalTail';
import styles from './InteractiveTerminal.module.css';

/** Port of agent-queue2 InteractiveTerminal/TerminalPane; the renderer and gestures
 * are unchanged in principle, while authority comes exclusively from v2 receipts. */
export function InteractiveTerminal({ terminalId, name }: { terminalId: string; name: string }) {
  const { queryContext: c } = useSession();
  return <TerminalPane key={`${terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} terminalId={terminalId} name={name} />;
}
function TerminalPane({ terminalId, name }: { terminalId: string; name: string }) {
  const { bootstrap, queryContext } = useSession();
  const queryClient = useQueryClient();
  const allowControl = bootstrap.capability('terminal.control').enabled;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), typeButton = useRef<HTMLButtonElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const uncertain = useRef(false);
  const connection = useRef<ReturnType<typeof connectInteractiveTerminal> | null>(null);
  const [state, setState] = useState<TerminalState>({ message: 'Not connected', connected: false, controlling: false, canControl: false, paused: false });
  const [attempt, setAttempt] = useState(0), [watching, setWatching] = useState(true), [transcript, setTranscript] = useState(false);
  useEffect(() => {
    if (!host.current || !watching || transcript) return;
    const term = new Terminal({ ...terminalOptions(), cols: 80, rows: 24 }); terminal.current = term;
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    const guarded = [...guardUntrustedOutput(term), ...guardObservedTerminalQueries(term)];
    term.textarea?.setAttribute('aria-label', `${name} terminal input`);
    term.textarea?.setAttribute('aria-describedby', 'terminal-input-help');
    term.attachCustomKeyEventHandler(event => {
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'm') { typeButton.current?.focus(); return false; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) return false;
      return true;
    });
    const job = crypto.randomUUID();
    const transport = connectInteractiveTerminal({ terminalId, allowControl, initiallyPaused: uncertain.current,
      read: (part, fetcher) => queryClient.fetchQuery({ queryKey: queryKey(queryContext, 'terminal-tail', { terminalId, part, watchJob: job }), queryFn: fetcher, retry: false, staleTime: 0, gcTime: 0 }),
      write: bytes => new Promise<void>(resolve => { term.write(bytes, resolve); }),
      reset: () => term.reset(),
      state: next => { uncertain.current ||= next.paused; term.options.disableStdin = !next.controlling; setState(next); },
    }); connection.current = transport;
    const data = term.onData(value => transport.sendInput(new TextEncoder().encode(value)));
    const binary = term.onBinary(value => transport.sendInput(Uint8Array.from(value, c => c.charCodeAt(0) & 255)));
    const resize = term.onResize(size => transport.resize(size.cols, size.rows));
    let animation = 0;
    const layout = () => {
      cancelAnimationFrame(animation); animation = requestAnimationFrame(() => {
        if (!host.current || !frame.current) return;
        const viewport = window.visualViewport;
        frame.current.style.maxHeight = viewport && viewport.width < 768 ? `${Math.max(180, viewport.height + viewport.offsetTop - frame.current.getBoundingClientRect().top - 170)}px` : '';
        const dimensions = fit.proposeDimensions();
        if (dimensions) term.resize(Math.max(80, Math.min(500, dimensions.cols)), Math.max(8, Math.min(300, dimensions.rows)));
      });
    };
    const observer = new ResizeObserver(layout); observer.observe(host.current); layout();
    void document.fonts?.ready.then(layout);
    const touch = attachTouchScroll(host.current, { lineHeight: () => 14 * 1.2, scroll: lines => term.scrollLines(lines), onTap: () => { if (canFocusTerminal()) term.focus(); } });
    window.visualViewport?.addEventListener('resize', layout); window.visualViewport?.addEventListener('scroll', layout);
    return () => {
      transport.close(); connection.current = null; cancelAnimationFrame(animation); observer.disconnect(); touch();
      window.visualViewport?.removeEventListener('resize', layout); window.visualViewport?.removeEventListener('scroll', layout);
      data.dispose(); binary.dispose(); resize.dispose(); guarded.forEach(g => g.dispose()); term.dispose(); terminal.current = null;
    };
  }, [terminalId, name, allowControl, queryClient, queryContext.principalId, queryContext.authorizationRevision, queryContext.contractVersion, attempt, watching, transcript]);
  useEffect(() => {
    if (state.controlling && terminal.current) connection.current?.resize(terminal.current.cols, terminal.current.rows);
  }, [state.controlling]);
  function send(value: string) { connection.current?.sendInput(new TextEncoder().encode(value)); if (canFocusTerminal()) terminal.current?.focus(); }
  return <section className={styles.pane} aria-label="Interactive agent terminal" data-interactive-terminal>
    <div className={styles.toolbar}>
      <div className={styles.tabs} aria-label="Output view">
        <button type="button" aria-pressed={!transcript} onClick={() => setTranscript(false)}>Terminal</button>
        <button type="button" aria-pressed={transcript} onClick={() => setTranscript(true)}>Transcript</button>
      </div>
      {!transcript && <div className={styles.actions}>
        {state.controlling ? <ActionButton onClick={() => void connection.current?.release()}>Release control</ActionButton>
          : <ActionButton disabled={!state.canControl || state.paused} onClick={() => void connection.current?.takeControl()}>Take control</ActionButton>}
        <ActionButton onClick={() => { setWatching(true); setAttempt(n => n + 1); }} disabled={state.paused}>Reconnect</ActionButton>
      </div>}
    </div>
    {transcript ? <TerminalTail terminalId={terminalId} /> : <>
      <div className={styles.frame} ref={frame}><div className={styles.host} ref={host} /></div>
      <div className={styles.status}><span role="status">{state.message}</span><span title="This is a rendering of the available byte stream. Earlier output may be missing.">Resident output · incomplete</span></div>
      <div className={styles.keys} aria-label="Terminal keyboard">
        <button className={styles.phoneControl} type="button" disabled={!state.controlling && (!state.canControl || state.paused)} onClick={() => { if (state.controlling) void connection.current?.release(); else void connection.current?.takeControl(); }}>{state.controlling ? "Release" : "Take control"}</button>
        <button type="button" ref={typeButton} disabled={!state.controlling} onClick={() => terminal.current?.focus()}>Type</button>
        {([['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['Enter', '\r']] as const).map(([label, bytes]) => <button type="button" key={label} disabled={!state.controlling} aria-label={label === '↑' ? 'Up arrow' : label === '↓' ? 'Down arrow' : label === '←' ? 'Left arrow' : label === '→' ? 'Right arrow' : label} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" onClick={() => { void connection.current?.release(); setWatching(false); setState({ message: 'Disconnected', controlling: false, connected: false, canControl: false, paused: state.paused }); }}>Disconnect</button>
      </div>
      <p id="terminal-input-help" className={styles.help}>Take control to type. Ctrl+M returns focus to the controls. Ctrl+C sends an interrupt; it does not cancel the task.</p>
    </>}
  </section>;
}
