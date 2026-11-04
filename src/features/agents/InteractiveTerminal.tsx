import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/session';
import { queryKey } from '../../api/queryKeys';
import { connectInteractiveTerminal, type TerminalState } from '../../api/interactiveTerminalClient';
import { terminalOptions, guardUntrustedOutput, guardObservedTerminalQueries, isObservedFocusReport, withControlModifier, clampTerminalFontSize, TERMINAL_FONT_SIZE, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_STEP, TERMINAL_LINE_HEIGHT } from './terminal/terminalSetup';
import { canFocusTerminal } from './terminal/terminalFocus';
import { attachTouchScroll } from './terminal/terminalTouchScroll';
import { ActionButton } from '../../components/layout/Workspace';
import type { OutputFeed } from './TerminalTail';
import styles from './InteractiveTerminal.module.css';

/** Phone key bar keys, in the spec's order: Esc, Tab, Ctrl (separate), arrows, Enter. */
const KEYS = [['Esc', 'Esc', '\x1b'], ['Tab', 'Tab', '\t'], ['←', 'Left arrow', '\x1b[D'], ['↑', 'Up arrow', '\x1b[A'], ['↓', 'Down arrow', '\x1b[B'], ['→', 'Right arrow', '\x1b[C'], ['Enter', 'Enter', '\r']] as const;

/** Port of agent-queue2 InteractiveTerminal/TerminalPane; the renderer and gestures
 * are unchanged in principle, while authority comes exclusively from v2 receipts. */
export function InteractiveTerminal({ terminalId, name, feed }: { terminalId: string; name: string; feed?: OutputFeed }) {
  const { queryContext: c } = useSession();
  return <TerminalPane key={`${terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} terminalId={terminalId} name={name} feed={feed} />;
}
/** `feed` republishes this pane's active Watch output for the Transcript drawer (no second watch). */
function TerminalPane({ terminalId, name, feed }: { terminalId: string; name: string; feed?: OutputFeed }) {
  const { bootstrap, queryContext } = useSession();
  const queryClient = useQueryClient();
  const allowControl = bootstrap.capability('terminal.control').enabled;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), typeButton = useRef<HTMLButtonElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const uncertain = useRef(false);
  const connection = useRef<ReturnType<typeof connectInteractiveTerminal> | null>(null);
  const [state, setState] = useState<TerminalState>({ message: 'Not connected', connected: false, controlling: false, canControl: false, paused: false });
  const [attempt, setAttempt] = useState(0), [watching, setWatching] = useState(true);
  // Sticky on-screen Ctrl: the ref is read by xterm's onData, the state renders aria-pressed.
  const [ctrl, setCtrlState] = useState(false), ctrlArmed = useRef(false);
  const setCtrl = useCallback((on: boolean) => { ctrlArmed.current = on; setCtrlState(on); }, []);
  const [fontSize, setFontSize] = useState(TERMINAL_FONT_SIZE), fontSizeRef = useRef(fontSize);
  const relayout = useRef<(forceResize?: boolean) => void>(() => {});
  const [panColumns, setPanColumns] = useState<number | null>(null);
  const keys = useRef<HTMLDivElement>(null);
  const [keyFade, setKeyFade] = useState({ start: false, end: false });
  useEffect(() => {
    if (!host.current || !watching) return;
    const term = new Terminal({ ...terminalOptions(fontSizeRef.current), cols: 80, rows: 24 }); terminal.current = term;
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
      write: bytes => new Promise<void>(resolve => { feed?.append(bytes); term.write(bytes, resolve); }),
      reset: () => { feed?.restart(); term.reset(); },
      state: next => { uncertain.current ||= next.paused; term.options.disableStdin = !next.controlling; feed?.status(next.message, next.connected); setState(next); },
    }); connection.current = transport;
    const data = term.onData(value => {
      if (isObservedFocusReport(value)) return;
      if (ctrlArmed.current) { value = withControlModifier(value); setCtrl(false); }
      transport.sendInput(new TextEncoder().encode(value));
    });
    const binary = term.onBinary(value => transport.sendInput(Uint8Array.from(value, c => c.charCodeAt(0) & 255)));
    const resize = term.onResize(size => transport.resize(size.cols, size.rows));
    let animation = 0, force = false;
    const measurePan = () => {
      const screen = host.current?.querySelector<HTMLElement>('.xterm-screen');
      setPanColumns(screen && host.current && screen.scrollWidth > host.current.clientWidth ? term.cols : null);
    };
    const layout = (forceResize = false) => {
      force ||= forceResize;
      cancelAnimationFrame(animation); animation = requestAnimationFrame(() => {
        if (!host.current || !frame.current) return;
        const viewport = window.visualViewport;
        frame.current.style.maxHeight = viewport && viewport.width < 768 ? `${Math.max(180, viewport.height + viewport.offsetTop - frame.current.getBoundingClientRect().top - 170)}px` : '';
        const dimensions = fit.proposeDimensions();
        if (dimensions) term.resize(Math.max(80, Math.min(500, dimensions.cols)), Math.max(8, Math.min(300, dimensions.rows)));
        // A text-size change re-sends the controller's size even when the grid is unchanged.
        if (force) { force = false; transport.resize(term.cols, term.rows); }
        measurePan();
      });
    };
    relayout.current = layout;
    const observer = new ResizeObserver(() => layout()); observer.observe(host.current); layout();
    const screen = host.current.querySelector('.xterm-screen'); if (screen) observer.observe(screen);
    void document.fonts?.ready.then(() => layout());
    const touch = attachTouchScroll(host.current, { lineHeight: () => fontSizeRef.current * TERMINAL_LINE_HEIGHT, scroll: lines => term.scrollLines(lines), onTap: () => { if (canFocusTerminal()) term.focus(); } });
    const viewportLayout = () => layout();
    window.visualViewport?.addEventListener('resize', viewportLayout); window.visualViewport?.addEventListener('scroll', viewportLayout);
    return () => {
      relayout.current = () => {}; setPanColumns(null);
      transport.close(); connection.current = null; feed?.end(); cancelAnimationFrame(animation); observer.disconnect(); touch();
      window.visualViewport?.removeEventListener('resize', viewportLayout); window.visualViewport?.removeEventListener('scroll', viewportLayout);
      data.dispose(); binary.dispose(); resize.dispose(); guarded.forEach(g => g.dispose()); term.dispose(); terminal.current = null;
    };
  }, [terminalId, name, allowControl, queryClient, queryContext.principalId, queryContext.authorizationRevision, queryContext.contractVersion, attempt, watching, feed, setCtrl]);
  useEffect(() => {
    if (state.controlling && terminal.current) connection.current?.resize(terminal.current.cols, terminal.current.rows);
    if (!state.controlling) setCtrl(false);
  }, [state.controlling, setCtrl]);
  useEffect(() => {
    if (fontSizeRef.current === fontSize) return;
    fontSizeRef.current = fontSize;
    if (terminal.current) { terminal.current.options.fontSize = fontSize; relayout.current(true); }
  }, [fontSize]);
  const updateKeyFade = useCallback(() => {
    const bar = keys.current; if (!bar) return;
    const start = bar.scrollLeft > 1, end = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    setKeyFade(previous => previous.start === start && previous.end === end ? previous : { start, end });
  }, []);
  useEffect(() => {
    const bar = keys.current; if (!bar) return;
    const observer = new ResizeObserver(updateKeyFade); observer.observe(bar); updateKeyFade();
    return () => observer.disconnect();
  }, [updateKeyFade]);
  function focusTerminal() { if (canFocusTerminal()) terminal.current?.focus(); }
  function send(value: string) {
    if (ctrlArmed.current) { value = withControlModifier(value); setCtrl(false); }
    connection.current?.sendInput(new TextEncoder().encode(value)); focusTerminal();
  }
  return <section className={styles.pane} aria-label="Interactive agent terminal" data-interactive-terminal>
    <div className={styles.toolbar}>
      <div className={styles.actions}>
        {state.controlling ? <ActionButton onClick={() => void connection.current?.release()}>Release control</ActionButton>
          : <ActionButton disabled={!state.canControl || state.paused} onClick={() => void connection.current?.takeControl()}>Take control</ActionButton>}
        <ActionButton onClick={() => { setWatching(true); setAttempt(n => n + 1); }} disabled={state.paused}>Reconnect</ActionButton>
      </div>
    </div>
    <>
      <div className={styles.frame} ref={frame}><div className={styles.host} ref={host} /></div>
      <div className={styles.view}>
        {panColumns !== null && <span className={styles.pan}>{panColumns} columns · pan to view <span aria-hidden="true">→</span></span>}
        <div className={styles.textSize} role="group" aria-label="Text size">
          <button type="button" aria-label="A− Decrease text size" disabled={fontSize <= TERMINAL_FONT_SIZE_MIN} onClick={() => setFontSize(size => clampTerminalFontSize(size - TERMINAL_FONT_SIZE_STEP))}>A−</button>
          <span className={styles.size}>{fontSize}px</span>
          <button type="button" aria-label="A+ Increase text size" disabled={fontSize >= TERMINAL_FONT_SIZE_MAX} onClick={() => setFontSize(size => clampTerminalFontSize(size + TERMINAL_FONT_SIZE_STEP))}>A+</button>
        </div>
      </div>
      {/* Reference 11: a phone viewer sees no key bar. While watching, the status, Take control and
          Disconnect share one row and the inert keys are hidden, so the terminal keeps its height. */}
      <div className={styles.dock} data-watching={!state.controlling || undefined}>
      <div className={styles.status}><span role="status">{state.message}</span><span className={styles.provenance} title="This is a rendering of the available byte stream. Earlier output may be missing.">Resident output · incomplete</span></div>
      <div className={styles.keys} ref={keys} role="group" aria-label="Terminal keyboard" data-fade-start={keyFade.start || undefined} data-fade-end={keyFade.end || undefined} onScroll={updateKeyFade}>
        <button className={styles.phoneControl} type="button" disabled={!state.controlling && (!state.canControl || state.paused)} onClick={() => { if (state.controlling) void connection.current?.release(); else void connection.current?.takeControl(); }}>{state.controlling ? "Release" : "Take control"}</button>
        <button type="button" className={styles.key} ref={typeButton} disabled={!state.controlling} onClick={() => terminal.current?.focus()}>Type</button>
        {KEYS.slice(0, 2).map(([label, name, bytes]) => <button type="button" className={styles.key} key={label} disabled={!state.controlling} aria-label={name} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" className={`${styles.key} ${styles.modifier}`} disabled={!state.controlling} aria-pressed={ctrl} onClick={() => { setCtrl(!ctrlArmed.current); focusTerminal(); }}>Ctrl</button>
        {KEYS.slice(2).map(([label, name, bytes]) => <button type="button" className={styles.key} key={label} disabled={!state.controlling} aria-label={name} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" onClick={() => { void connection.current?.release(); setWatching(false); setState({ message: 'Disconnected', controlling: false, connected: false, canControl: false, paused: state.paused }); }}>Disconnect</button>
      </div>
      </div>
      <p id="terminal-input-help" className={styles.help}>Take control to type. Ctrl+M returns focus to the controls. The Ctrl key applies to the next key only; Ctrl then C sends an interrupt, which does not cancel the task.</p>
    </>
  </section>;
}
