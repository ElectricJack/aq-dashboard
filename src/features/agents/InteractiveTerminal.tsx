import { useEffect, useId, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/session';
import { queryKey } from '../../api/queryKeys';
import { connectInteractiveTerminal, type TerminalState } from '../../api/interactiveTerminalClient';
import { terminalOptions, guardUntrustedOutput, guardObservedTerminalQueries, isObservedFocusReport, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminal/terminalSetup';
import { canFocusTerminal } from './terminal/terminalFocus';
import { attachTouchScroll } from './terminal/terminalTouchScroll';
import { ActionButton } from '../../components/layout/Workspace';
import type { OutputFeed } from './TerminalTail';
import styles from './InteractiveTerminal.module.css';

/** Spec §6: a split pane must fit at least this many columns at the readable font size. */
export const MIN_PANE_COLUMNS = 80;
/** Horizontal space a pane spends outside its character grid: `.frame` padding (2 × 12px)
 * plus the xterm viewport scrollbar FitAddon reserves when scrollback is enabled. */
const SCROLLBAR_PX = 14;
const PANE_CHROME_PX = 24 + SCROLLBAR_PX;
let cellWidth: number | null = null;
/** Cell width xterm measures for the terminal font (it measures 'W' on a canvas; letter spacing is 0). */
export function terminalCellWidth(): number {
  if (cellWidth) return cellWidth;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return TERMINAL_FONT_SIZE * 0.6;
  context.font = `${TERMINAL_FONT_SIZE}px ${TERMINAL_FONT_FAMILY}`;
  const width = context.measureText('W'.repeat(32)).width / 32;
  if (width > 0) cellWidth = width;
  return width > 0 ? width : TERMINAL_FONT_SIZE * 0.6;
}
/** Columns an InteractiveTerminal pane of `paneWidth` CSS pixels fits without shrinking the font. */
export function columnsForPane(paneWidth: number): number {
  return Math.max(0, Math.floor((paneWidth - PANE_CHROME_PX) / terminalCellWidth()));
}

type PaneProps = { terminalId: string; name: string; feed?: OutputFeed; label?: string; fill?: boolean };
/** Port of agent-queue2 InteractiveTerminal/TerminalPane; the renderer and gestures
 * are unchanged in principle, while authority comes exclusively from v2 receipts.
 * `label` names the region when several panes share a page; `fill` lets the frame take the
 * container's height (expanded workspace) instead of the fixed viewport-relative height. */
export function InteractiveTerminal(props: PaneProps) {
  const { queryContext: c } = useSession();
  return <TerminalPane key={`${props.terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} {...props} />;
}
/** `feed` republishes this pane's active Watch output for the Transcript drawer (no second watch).
 * The pane reports `data-cols` (rendered) and `data-fit-cols` (what its width fits, before the 80-column floor). */
function TerminalPane({ terminalId, name, feed, label = 'Interactive agent terminal', fill }: PaneProps) {
  const { bootstrap, queryContext } = useSession();
  const queryClient = useQueryClient();
  const allowControl = bootstrap.capability('terminal.control').enabled;
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), pane = useRef<HTMLElement>(null), typeButton = useRef<HTMLButtonElement>(null);
  const helpId = useId();
  const terminal = useRef<Terminal | null>(null);
  const uncertain = useRef(false);
  const connection = useRef<ReturnType<typeof connectInteractiveTerminal> | null>(null);
  const [state, setState] = useState<TerminalState>({ message: 'Not connected', connected: false, controlling: false, canControl: false, paused: false });
  const [attempt, setAttempt] = useState(0), [watching, setWatching] = useState(true);
  useEffect(() => {
    if (!host.current || !watching) return;
    const term = new Terminal({ ...terminalOptions(), cols: 80, rows: 24 }); terminal.current = term;
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    // Below 80 columns the frame scrolls instead of the font shrinking; size the floor in terminal cells, not page `ch`.
    if (term.element) term.element.style.minInlineSize = `${Math.ceil(MIN_PANE_COLUMNS * terminalCellWidth()) + SCROLLBAR_PX}px`;
    const guarded = [...guardUntrustedOutput(term), ...guardObservedTerminalQueries(term)];
    term.textarea?.setAttribute('aria-label', `${name} terminal input`);
    term.textarea?.setAttribute('aria-describedby', helpId);
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
    const data = term.onData(value => { if (!isObservedFocusReport(value)) transport.sendInput(new TextEncoder().encode(value)); });
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
        if (pane.current) { pane.current.dataset.cols = String(term.cols); pane.current.dataset.fitCols = dimensions ? String(dimensions.cols) : ''; }
      });
    };
    const observer = new ResizeObserver(layout); observer.observe(host.current); layout();
    void document.fonts?.ready.then(layout);
    const touch = attachTouchScroll(host.current, { lineHeight: () => 14 * 1.2, scroll: lines => term.scrollLines(lines), onTap: () => { if (canFocusTerminal()) term.focus(); } });
    window.visualViewport?.addEventListener('resize', layout); window.visualViewport?.addEventListener('scroll', layout);
    return () => {
      transport.close(); connection.current = null; feed?.end(); cancelAnimationFrame(animation); observer.disconnect(); touch();
      window.visualViewport?.removeEventListener('resize', layout); window.visualViewport?.removeEventListener('scroll', layout);
      data.dispose(); binary.dispose(); resize.dispose(); guarded.forEach(g => g.dispose()); term.dispose(); terminal.current = null;
    };
  }, [terminalId, name, helpId, allowControl, queryClient, queryContext.principalId, queryContext.authorizationRevision, queryContext.contractVersion, attempt, watching, feed]);
  useEffect(() => {
    if (state.controlling && terminal.current) connection.current?.resize(terminal.current.cols, terminal.current.rows);
  }, [state.controlling]);
  function send(value: string) { connection.current?.sendInput(new TextEncoder().encode(value)); if (canFocusTerminal()) terminal.current?.focus(); }
  return <section ref={pane} className={styles.pane} aria-label={label} data-interactive-terminal data-fill={fill || undefined} data-controlling={state.controlling || undefined}>
    <div className={styles.toolbar}>
      <div className={styles.actions}>
        {state.controlling ? <ActionButton onClick={() => void connection.current?.release()}>Release control</ActionButton>
          : <ActionButton disabled={!state.canControl || state.paused} onClick={() => void connection.current?.takeControl()}>Take control</ActionButton>}
        <ActionButton onClick={() => { setWatching(true); setAttempt(n => n + 1); }} disabled={state.paused}>Reconnect</ActionButton>
      </div>
    </div>
    <>
      <div className={styles.frame} ref={frame}><div className={styles.host} ref={host} /></div>
      <div className={styles.status}><span role="status">{state.message}</span><span title="This is a rendering of the available byte stream. Earlier output may be missing.">Resident output · incomplete</span></div>
      <div className={styles.keys} aria-label="Terminal keyboard">
        <button className={styles.phoneControl} type="button" disabled={!state.controlling && (!state.canControl || state.paused)} onClick={() => { if (state.controlling) void connection.current?.release(); else void connection.current?.takeControl(); }}>{state.controlling ? "Release" : "Take control"}</button>
        <button type="button" ref={typeButton} disabled={!state.controlling} onClick={() => terminal.current?.focus()}>Type</button>
        {([['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['Enter', '\r']] as const).map(([label, bytes]) => <button type="button" key={label} disabled={!state.controlling} aria-label={label === '↑' ? 'Up arrow' : label === '↓' ? 'Down arrow' : label === '←' ? 'Left arrow' : label === '→' ? 'Right arrow' : label} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" onClick={() => { void connection.current?.release(); setWatching(false); setState({ message: 'Disconnected', controlling: false, connected: false, canControl: false, paused: state.paused }); }}>Disconnect</button>
      </div>
      <p id={helpId} className={styles.help}>Take control to type. Ctrl+M returns focus to the controls. Ctrl+C sends an interrupt; it does not cancel the task.</p>
    </>
  </section>;
}
