import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/session';
import { queryKey } from '../../api/queryKeys';
import { connectInteractiveTerminal, type TerminalState } from '../../api/interactiveTerminalClient';
import { terminalOptions, guardUntrustedOutput, guardObservedTerminalQueries, isObservedFocusReport } from './terminal/terminalSetup';
import { canFocusTerminal } from './terminal/terminalFocus';
import { attachTouchScroll } from './terminal/terminalTouchScroll';
import { ActionButton } from '../../components/layout/Workspace';
import { useMediaQuery } from '../../components/useMediaQuery';
import { formatAge } from '../../components/time/relative';
import type { OutputFeed } from './TerminalTail';
import styles from './InteractiveTerminal.module.css';

/** Port of agent-queue2 InteractiveTerminal/TerminalPane; the renderer and gestures
 * are unchanged in principle, while authority comes exclusively from v2 receipts. */
export interface TerminalPaneProps {
  terminalId: string; name: string;
  /** Republishes this pane's active Watch output for the Transcript drawer (no second watch). */
  feed?: OutputFeed;
  /** The Transcript drawer (AG-C) is open; the phone Terminal | Transcript switch opens it and reflects it. */
  transcriptOpen?: boolean;
  onTranscript?: (opener: HTMLElement) => void;
  /** Opens Session details from the phone More menu. */
  onDetails?: (opener: HTMLElement) => void;
  /** Why the Message slot is unavailable (AG-C); shown in the phone action bar's description. */
  messageReason?: string;
  /** Session facts appended to the one-row status footer. */
  facts?: ReactNode;
}
export function InteractiveTerminal(props: TerminalPaneProps) {
  const { queryContext: c } = useSession();
  return <TerminalPane key={`${props.terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} {...props} />;
}
function TerminalPane({ terminalId, name, feed, transcriptOpen = false, onTranscript, onDetails, messageReason = 'Messaging unavailable on this AQ server', facts }: TerminalPaneProps) {
  const { bootstrap, queryContext } = useSession();
  const queryClient = useQueryClient();
  const allowControl = bootstrap.capability('terminal.control').enabled;
  const phone = useMediaQuery('(max-width: 767px)');
  const ids = useId(), menuId = `${ids}-more`, messageNoteId = `${ids}-message-note`;
  const actions = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), typeButton = useRef<HTMLButtonElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const uncertain = useRef(false);
  const connection = useRef<ReturnType<typeof connectInteractiveTerminal> | null>(null);
  const [state, setState] = useState<TerminalState>({ message: 'Connecting…', connected: false, controlling: false, canControl: false, paused: false });
  const [attempt, setAttempt] = useState(0), [watching, setWatching] = useState(true);
  useEffect(() => {
    if (!host.current || !watching) return;
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
        // Phone: fit the frame above the pane's footer, key bar and action bar (all below it in the pane).
        const box = frame.current.getBoundingClientRect(), pane = frame.current.closest('section')?.getBoundingClientRect();
        const below = (pane ? pane.bottom - box.bottom : 170) + 8;
        frame.current.style.maxHeight = viewport && viewport.width < 768 ? `${Math.max(180, viewport.height + viewport.offsetTop - box.top - below)}px` : '';
        const dimensions = fit.proposeDimensions();
        if (dimensions) term.resize(Math.max(80, Math.min(500, dimensions.cols)), Math.max(8, Math.min(300, dimensions.rows)));
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
  }, [terminalId, name, allowControl, queryClient, queryContext.principalId, queryContext.authorizationRevision, queryContext.contractVersion, attempt, watching, feed]);
  useEffect(() => {
    if (state.controlling && terminal.current) connection.current?.resize(terminal.current.cols, terminal.current.rows);
  }, [state.controlling]);
  const now = useServerNow(state);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node) || !actions.current?.contains(event.target)) setMoreOpen(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [moreOpen]);
  function send(value: string) { connection.current?.sendInput(new TextEncoder().encode(value)); if (canFocusTerminal()) terminal.current?.focus(); }
  const toggleControl = () => { if (state.controlling) void connection.current?.release(); else void connection.current?.takeControl(); };
  const controlBlocked = !state.controlling && (!state.canControl || state.paused);
  const reconnect = () => { setWatching(true); setAttempt(n => n + 1); };
  const disconnect = () => { void connection.current?.release(); setWatching(false); setState({ message: 'Disconnected', controlling: false, connected: false, canControl: false, paused: state.paused }); };
  const phase = state.connected ? 'connected' : watching && state.message === 'Connecting…' ? 'connecting' : 'disconnected';
  const lease = state.lease && now !== null ? state.lease : null;
  const leaseText = lease && `Controlled by ${lease.mine ? `${bootstrap.principal.displayName} (you)` : 'another viewer'} · lease expires in ${countdown(lease.expiresAtMs - now!)}`;
  // The lease line restates the default mode message, so keep that message for assistive technology only.
  const routineMessage = state.message === 'You have control' || state.message === 'Watch only';
  const viewSwitch = onTranscript && <OutputViewSwitch transcript={transcriptOpen} onTranscript={onTranscript} />;
  const controlButton = <ActionButton className={phone ? styles.primary : state.controlling ? undefined : styles.primaryOutline} disabled={controlBlocked} onClick={toggleControl}>{state.controlling ? 'Release control' : 'Take control'}</ActionButton>;
  const moreButton = () => actions.current?.querySelector<HTMLButtonElement>('[aria-haspopup]') ?? undefined;
  const closeMore = () => { setMoreOpen(false); moreButton()?.focus(); };
  return <section className={styles.pane} aria-label="Interactive agent terminal" data-interactive-terminal>
    <div className={styles.toolbar}>
      <div className={styles.controls}>
        <span className={styles.state}>
          <span role="status" className={leaseText && routineMessage ? 'visually-hidden' : undefined}>{state.message}</span>
          {leaseText && <span className={styles.lease}>{leaseText}</span>}
        </span>
        <label className={styles.mode}><span className="visually-hidden">Terminal mode</span>
          <select value={state.controlling ? 'control' : 'watch'} onChange={event => { if ((event.target.value === 'control') !== state.controlling) toggleControl(); }}>
            <option value="watch">Watch only</option>
            <option value="control" disabled={!state.controlling && controlBlocked}>Controlling</option>
          </select>
        </label>
        {!phone && controlButton}
        {!phone && phase === 'disconnected' && <ActionButton onClick={reconnect} disabled={state.paused}>Reconnect</ActionButton>}
      </div>
    </div>
    <>
      <div className={styles.frame} ref={frame}><div className={styles.host} ref={host} /></div>
      <footer className={styles.footer}>
        {/* Reference 08 order: Output · Progress · ● Connected. */}
        <span>{state.outputObservedAtMs && now !== null ? `Output ${formatAge(new Date(now).toISOString(), new Date(state.outputObservedAtMs).toISOString())}` : 'Output unavailable'}</span>
        <span>Progress unavailable</span>
        <span className={styles.connection} data-phase={phase}><span className={styles.dot} aria-hidden="true" />{phase === 'connected' ? 'Connected' : phase === 'connecting' ? 'Connecting' : 'Disconnected'}</span>
        {facts && <span className={styles.facts}>{facts}</span>}
        <span className={styles.provenance} title="This is a rendering of the available byte stream. Earlier output may be missing.">Resident output · incomplete</span>
      </footer>
      {/* Phone watch mode (reference 11) has no key bar: every key is inert until control, and Disconnect is under More. */}
      {(!phone || state.controlling) && <div className={styles.keys} aria-label="Terminal keyboard">
        <button type="button" ref={typeButton} disabled={!state.controlling} onClick={() => terminal.current?.focus()}>Type</button>
        {([['Esc', '\x1b'], ['Tab', '\t'], ['Ctrl+C', '\x03'], ['↑', '\x1b[A'], ['↓', '\x1b[B'], ['←', '\x1b[D'], ['→', '\x1b[C'], ['Enter', '\r']] as const).map(([label, bytes]) => <button type="button" key={label} disabled={!state.controlling} aria-label={label === '↑' ? 'Up arrow' : label === '↓' ? 'Down arrow' : label === '←' ? 'Left arrow' : label === '→' ? 'Right arrow' : label} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" onClick={disconnect}>Disconnect</button>
      </div>}
      <p id="terminal-input-help" className={styles.help}>Take control to type. Ctrl+M returns focus to the controls. Ctrl+C sends an interrupt; it does not cancel the task.</p>
    </>
    {phone && <div className={styles.dock} ref={actions} data-terminal-actions>
      {viewSwitch}
      <div className={styles.actionBar}>
        {controlButton}
        {/* Message slot (AG-C): no durable session-message capability exists yet. */}
        <ActionButton disabled aria-describedby={messageNoteId}>Message</ActionButton>
        <span id={messageNoteId} className="visually-hidden">{messageReason}</span>
        <ActionButton aria-label="More terminal actions" aria-haspopup="true" aria-expanded={moreOpen} aria-controls={menuId} onClick={() => setMoreOpen(v => !v)}>…</ActionButton>
        {moreOpen && <div id={menuId} className={styles.more} role="group" aria-label="More terminal actions" onKeyDown={event => { if (event.key === 'Escape') closeMore(); }}>
          <ActionButton autoFocus disabled={state.paused} onClick={() => { closeMore(); reconnect(); }}>Reconnect</ActionButton>
          <ActionButton disabled={!watching} onClick={() => { closeMore(); disconnect(); }}>Disconnect</ActionButton>
          {onDetails && <ActionButton aria-haspopup="dialog" onClick={() => { const opener = moreButton(); setMoreOpen(false); if (opener) onDetails(opener); }}>Session details</ActionButton>}
        </div>}
      </div>
    </div>}
  </section>;
}

/** Server "now" from the transport's clock sample, ticking once a second while a lease or output time is shown. */
function useServerNow(state: TerminalState) {
  const [, tick] = useState(0);
  const live = !!(state.clock && (state.lease || state.outputObservedAtMs));
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(timer);
  }, [live]);
  return state.clock ? state.clock.serverMs + performance.now() - state.clock.at : null;
}
function countdown(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Phone Terminal | Transcript segmented control (reference 11), a radio group with roving focus.
 * Transcript opens the AG-C Transcript drawer over the still-mounted terminal; closing the drawer
 * returns to Terminal, so the terminal radio is the drawer's focus-return target. */
function OutputViewSwitch({ transcript, onTranscript }: { transcript: boolean; onTranscript: (opener: HTMLElement) => void }) {
  const group = useRef<HTMLDivElement>(null);
  const open = () => { const terminal = group.current?.querySelector<HTMLButtonElement>('[data-view=terminal]'); if (terminal) onTranscript(terminal); };
  function keys(event: KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault(); if (!transcript) open();
  }
  return <div ref={group} className={styles.segments} role="radiogroup" aria-label="Output view" onKeyDown={keys}>
    {([['Terminal', false], ['Transcript', true]] as const).map(([label, value]) =>
      <button key={label} type="button" role="radio" data-view={label.toLowerCase()} aria-checked={transcript === value} tabIndex={transcript === value ? 0 : -1} onClick={() => { if (value && !transcript) open(); }}>{label}</button>)}
  </div>;
}
