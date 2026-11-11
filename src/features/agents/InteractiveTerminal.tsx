import {connectManualTerminal} from '../../api/manualTerminalClient';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useQueryClient } from '@tanstack/react-query';
import { useSession } from '../../app/session';
import { queryKey } from '../../api/queryKeys';
import { connectInteractiveTerminal, type TerminalBinding, type TerminalState } from '../../api/interactiveTerminalClient';
import { readPreferences } from '../../app/preferences';
import { terminalOptions, guardUntrustedOutput, guardObservedTerminalQueries, isObservedFocusReport, withControlModifier, clampTerminalFontSize, TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE, TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN, TERMINAL_FONT_SIZE_STEP, TERMINAL_LINE_HEIGHT } from './terminal/terminalSetup';
import { canFocusTerminal } from './terminal/terminalFocus';
import { attachTouchScroll } from './terminal/terminalTouchScroll';
import { snapshotLines } from './terminal/terminalSnapshot';
import { ActionButton } from '../../components/layout/Workspace';
import { useMediaQuery } from '../../components/useMediaQuery';
import { formatAge } from '../../components/time/relative';
import type { OutputFeed } from './TerminalTail';
import styles from './InteractiveTerminal.module.css';

/** Spec §6: a split pane must fit at least this many columns at the readable font size. */
export const MIN_PANE_COLUMNS = 80;
/** Horizontal space a pane spends outside its character grid: `.frame` padding (2 × 12px)
 * plus the xterm viewport scrollbar FitAddon reserves when scrollback is enabled. */
const SCROLLBAR_PX = 14;
const PANE_CHROME_PX = 24 + SCROLLBAR_PX;
const cellWidths = new Map<number, number>();
/** Cell width xterm measures for the terminal font (it measures 'W' on a canvas; letter spacing is 0). */
export function terminalCellWidth(fontSize = TERMINAL_FONT_SIZE): number {
  const cached = cellWidths.get(fontSize);
  if (cached) return cached;
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return fontSize * 0.6;
  context.font = `${fontSize}px ${TERMINAL_FONT_FAMILY}`;
  const width = context.measureText('W'.repeat(32)).width / 32;
  if (width > 0) cellWidths.set(fontSize, width);
  return width > 0 ? width : fontSize * 0.6;
}
/** Columns an InteractiveTerminal pane of `paneWidth` CSS pixels fits without shrinking the font. */
export function columnsForPane(paneWidth: number): number {
  return Math.max(0, Math.floor((paneWidth - PANE_CHROME_PX) / terminalCellWidth()));
}

/** Phone key bar keys, in the spec's order: Esc, Tab, Ctrl (separate), arrows, Enter. */
const KEYS = [['Esc', 'Esc', '\x1b'], ['Tab', 'Tab', '\t'], ['←', 'Left arrow', '\x1b[D'], ['↑', 'Up arrow', '\x1b[A'], ['↓', 'Down arrow', '\x1b[B'], ['→', 'Right arrow', '\x1b[C'], ['Enter', 'Enter', '\r']] as const;

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
  /** Why the Message slot is unavailable (AG-C), or null when Message is offered; shown in the phone action bar's description. */
  messageReason?: string | null;
  /** Opens the Message drawer from the phone action bar. */
  onMessage?: (opener: HTMLElement) => void;
  /** Session facts appended to the one-row status footer. */
  facts?: ReactNode;
  /** Names the region when several panes share a page (split view). */
  label?: string;
  /** Persistent manual session transport. */
  manual?: boolean;
  /** Freeze input after lifecycle completion without remounting the observed screen. */
  inputEnabled?: boolean;
  compact?: boolean;
}
export function InteractiveTerminal(props: TerminalPaneProps) {
  const { queryContext: c } = useSession();
  return <TerminalPane key={`${props.terminalId}:${c.principalId}:${c.authorizationRevision}:${c.contractVersion}`} {...props} />;
}
/** The pane reports `data-cols` (rendered) and `data-fit-cols` (what its width fits, before the 80-column floor). */
function TerminalPane({ terminalId, name, feed, transcriptOpen = false, onTranscript, onDetails, messageReason = 'Session messages are not offered here', onMessage, facts, label = 'Interactive agent terminal', manual = false, inputEnabled = true, compact = false }: TerminalPaneProps) {
  const { bootstrap, queryContext } = useSession();
  const queryClient = useQueryClient();
  const controlCapability = bootstrap.capability('terminal.control'), allowControl = manual || controlCapability.enabled;
  const phone = useMediaQuery('(max-width: 767px)');
  const ids = useId(), helpId = `${ids}-help`, menuId = `${ids}-more`, messageNoteId = `${ids}-message-note`;
  const actions = useRef<HTMLDivElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), pane = useRef<HTMLElement>(null), typeButton = useRef<HTMLButtonElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const inputAllowed = useRef(inputEnabled); inputAllowed.current = inputEnabled;
  const uncertain = useRef(false);
  const connection = useRef<ReturnType<typeof connectInteractiveTerminal> | null>(null);
  const [state, setState] = useState<TerminalState>({ message: 'Connecting…', connected: false, controlling: false, canControl: false, paused: false });
  const [attempt, setAttempt] = useState(0), [watching, setWatching] = useState(true);
  // U11: the screen at the moment observation stopped, and the identity/epoch a reconnect must match.
  const [snapshot, setSnapshot] = useState<string[] | null>(null);
  const binding = useRef<TerminalBinding | null>(null);
  // Sticky on-screen Ctrl: the ref is read by xterm's onData, the state renders aria-pressed.
  const [ctrl, setCtrlState] = useState(false), ctrlArmed = useRef(false);
  const setCtrl = useCallback((on: boolean) => { ctrlArmed.current = on; setCtrlState(on); }, []);
  const [fontSize, setFontSize] = useState(() => clampTerminalFontSize(readPreferences().terminalFontSize)), fontSizeRef = useRef(fontSize);
  const relayout = useRef<(forceResize?: boolean) => void>(() => {});
  const [panColumns, setPanColumns] = useState<number | null>(null);
  const keys = useRef<HTMLDivElement>(null);
  const [keyFade, setKeyFade] = useState({ start: false, end: false });
  useEffect(() => {
    if (!host.current || !watching) return;
    const term = new Terminal({ ...terminalOptions(fontSizeRef.current), cols: 80, rows: 24 }); terminal.current = term;
    const fit = new FitAddon(); term.loadAddon(fit); term.open(host.current);
    // Below 80 columns the frame scrolls instead of the font shrinking; size the floor in terminal cells, not page `ch`.
    if (term.element) term.element.style.minInlineSize = `${Math.ceil(MIN_PANE_COLUMNS * terminalCellWidth(fontSizeRef.current)) + SCROLLBAR_PX}px`;
    const guarded = [...guardUntrustedOutput(term), ...(manual?[]:guardObservedTerminalQueries(term))];
    term.textarea?.setAttribute('aria-label', `${name} terminal input`);
    term.textarea?.setAttribute('aria-describedby', helpId);
    term.attachCustomKeyEventHandler(event => {
      if (event.type === 'keydown' && event.ctrlKey && event.key.toLowerCase() === 'm') { (typeButton.current??pane.current)?.focus(); return false; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && term.hasSelection()) return false;
      return true;
    });
    const job = crypto.randomUUID();
    const freeze = () => { const lines = snapshotLines(term.buffer.active, term.rows); if (lines.length) setSnapshot(lines); };
    const transport = (manual ? connectManualTerminal : connectInteractiveTerminal)({ terminalId, allowControl, initiallyPaused: uncertain.current, expect: binding.current,
      read: (part, fetcher) => queryClient.fetchQuery({ queryKey: queryKey(queryContext, 'terminal-tail', { terminalId, part, watchJob: job }), queryFn: fetcher, retry: false, staleTime: 0, gcTime: 0 }),
      write: bytes => new Promise<void>(resolve => { feed?.append(bytes); term.write(bytes, resolve); }),
      reset: () => { freeze(); feed?.restart(); term.reset(); },
      state: next => { uncertain.current ||= next.paused; if (next.binding) binding.current = next.binding; if (!next.connected) freeze(); term.options.disableStdin = !next.controlling; feed?.status(next.message, next.connected); setState(next); },
    }); connection.current = transport;
    const data = term.onData(value => {
      if (isObservedFocusReport(value)) return;
      if (ctrlArmed.current) { value = withControlModifier(value); setCtrl(false); }
      if (inputAllowed.current) transport.sendInput(new TextEncoder().encode(value));
    });
    const binary = term.onBinary(value => inputAllowed.current && transport.sendInput(Uint8Array.from(value, c => c.charCodeAt(0) & 255)));
    const resize = term.onResize(size => transport.resize(size.cols, size.rows));
    let animation = 0, force = false;
    const measurePan = () => {
      const screen = host.current?.querySelector<HTMLElement>('.xterm-screen');
      setPanColumns(screen && host.current && screen.scrollWidth > host.current.clientWidth ? term.cols : null);
    };
    const layout = (forceResize = false) => {
      force ||= forceResize;
      cancelAnimationFrame(animation); animation = requestAnimationFrame(() => {
        if (!host.current || !frame.current || host.current.getBoundingClientRect().width === 0 || host.current.getBoundingClientRect().height === 0) return;
        const viewport = window.visualViewport;
        // Phone: fit the frame above the pane's footer, key bar and action bar (all below it in the pane).
        // Measure the rows after the frame, not the pane: a stretched (expanded) pane's spare space is not "below".
        const box = frame.current.getBoundingClientRect();
        let after = frame.current.nextElementSibling, bottom = box.bottom;
        for (; after; after = after.nextElementSibling) bottom = Math.max(bottom, after.getBoundingClientRect().bottom);
        const below = (pane.current ? bottom - box.bottom : 170) + 8;
        frame.current.style.maxHeight = viewport && viewport.width < 768 ? `${Math.max(180, viewport.height + viewport.offsetTop - box.top - below)}px` : '';
        const dimensions = fit.proposeDimensions();
        // A hidden host (frozen last observation) proposes NaN; keep the current size.
        if (dimensions && Number.isFinite(dimensions.cols) && Number.isFinite(dimensions.rows)) term.resize(Math.max(80, Math.min(500, dimensions.cols)), Math.max(8, Math.min(300, dimensions.rows)));
        if (pane.current) { pane.current.dataset.cols = String(term.cols); pane.current.dataset.fitCols = dimensions ? String(dimensions.cols) : ''; }
        // A text-size change re-sends the controller's size even when the grid is unchanged.
        if (force) { force = false; transport.resize(term.cols, term.rows); }
        measurePan();
      });
    };
    relayout.current = layout;
    // The pane too: Expand moves and grows it without resizing the capped host.
    const observer = new ResizeObserver(() => layout()); observer.observe(host.current); if (pane.current) observer.observe(pane.current); layout();
    const screen = host.current.querySelector('.xterm-screen'); if (screen) observer.observe(screen);
    void document.fonts?.ready.then(() => layout());
    const touch = attachTouchScroll(host.current, { lineHeight: () => fontSizeRef.current * TERMINAL_LINE_HEIGHT, scroll: lines => term.scrollLines(lines), onTap: () => { if (canFocusTerminal()) term.focus(); } });
    const viewportLayout = () => layout();
    window.visualViewport?.addEventListener('resize', viewportLayout); window.visualViewport?.addEventListener('scroll', viewportLayout);
    return () => {
      relayout.current = () => {}; setPanColumns(null);
      freeze(); transport.close(); connection.current = null; feed?.end(); cancelAnimationFrame(animation); observer.disconnect(); touch();
      window.visualViewport?.removeEventListener('resize', viewportLayout); window.visualViewport?.removeEventListener('scroll', viewportLayout);
      data.dispose(); binary.dispose(); resize.dispose(); guarded.forEach(g => g.dispose()); term.dispose(); terminal.current = null;
    };
  }, [terminalId, name, manual, allowControl, queryClient, queryContext.principalId, queryContext.authorizationRevision, queryContext.contractVersion, attempt, watching, feed, setCtrl, helpId]);
  // Ending a process fences input and stops reconnect/lease work without disposing its screen.
  useEffect(() => {
    if (inputEnabled) return;
    connection.current?.close();
    connection.current = null;
    setState({ message: 'Ended', connected: false, controlling: false, canControl: false, paused: false });
  }, [inputEnabled]);
  useEffect(() => {
    if (state.controlling && terminal.current) connection.current?.resize(terminal.current.cols, terminal.current.rows);
    if (!state.controlling) setCtrl(false);
  }, [state.controlling, setCtrl]);
  useEffect(() => {
    if (fontSizeRef.current === fontSize) return;
    fontSizeRef.current = fontSize;
    if (terminal.current) {
      terminal.current.options.fontSize = fontSize;
      if (terminal.current.element) terminal.current.element.style.minInlineSize = `${Math.ceil(MIN_PANE_COLUMNS * terminalCellWidth(fontSize)) + SCROLLBAR_PX}px`;
      relayout.current(true);
    }
  }, [fontSize]);
  // Keys become active after the interactive connection is acknowledged.
  const keyBar = phone && state.controlling;
  const updateKeyFade = useCallback(() => {
    const bar = keys.current; if (!bar) return;
    const start = bar.scrollLeft > 1, end = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    setKeyFade(previous => previous.start === start && previous.end === end ? previous : { start, end });
  }, []);
  useEffect(() => {
    const bar = keys.current; if (!bar || !keyBar) return;
    const observer = new ResizeObserver(updateKeyFade); observer.observe(bar); updateKeyFade();
    return () => observer.disconnect();
  }, [updateKeyFade, keyBar]);
  const now = useServerNow(state);
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: PointerEvent) => { if (!(event.target instanceof Node) || !actions.current?.contains(event.target)) setMoreOpen(false); };
    document.addEventListener('pointerdown', close); return () => document.removeEventListener('pointerdown', close);
  }, [moreOpen]);
  function focusTerminal() { if (canFocusTerminal()) terminal.current?.focus(); }
  function send(value: string) {
    if (ctrlArmed.current) { value = withControlModifier(value); setCtrl(false); }
    if (inputAllowed.current) connection.current?.sendInput(new TextEncoder().encode(value)); focusTerminal();
  }
  const controlBlocked = !state.controlling && (!state.canControl || state.paused);
  // Why typing is temporarily unavailable (N-07), from what this pane knows: capability, delivery pause, connection, policy.
  const controlReason = !controlBlocked ? null
    : !allowControl ? controlCapability.enabled ? 'Terminal control is not offered by this AQ server' : controlCapability.reason
    : state.paused ? manual ? null : 'Input delivery is uncertain, so typing is paused. Reconnect to check this terminal again.'
    : !state.connected ? 'Connecting to the terminal for input.'
    : 'This terminal does not accept input: its AQ terminal policy has input turned off.';
  const controlReasonId = `${ids}-control-reason`;
  const reconnect = () => { if (!inputAllowed.current) return; if(manual) uncertain.current=false; setWatching(true); setAttempt(n => n + 1); };
  const disconnect = () => { void connection.current?.release(); setWatching(false); setState({ message: 'Disconnected', controlling: false, connected: false, canControl: false, paused: state.paused }); };
  const phase = state.connected ? 'connected' : watching && state.message === 'Connecting…' ? 'connecting' : 'disconnected';
  const lease = state.lease && now !== null ? state.lease : null;
  const frozen = phase === 'disconnected' && snapshot !== null;
  const leaseText = lease && `Controlled by ${lease.mine ? `${bootstrap.principal.displayName} (you)` : 'another viewer'} · lease expires in ${countdown(lease.expiresAtMs - now!)}`;
  // The lease line restates the default mode message, so keep that message for assistive technology only.
  const routineMessage = state.message === 'You have control' || state.message === 'Waiting for interactive connection';
  const viewSwitch = onTranscript && <OutputViewSwitch transcript={transcriptOpen} onTranscript={onTranscript} />;

  const moreButton = () => actions.current?.querySelector<HTMLButtonElement>('[aria-label="More terminal actions"]') ?? undefined;
  const closeMore = () => { setMoreOpen(false); moreButton()?.focus(); };
  const panHint = panColumns !== null && <span className={styles.pan}>{panColumns} columns · pan to view <span aria-hidden="true">→</span></span>;
  return <section ref={pane} className={styles.pane} tabIndex={-1} aria-label={label} data-interactive-terminal data-controlling={state.controlling || undefined}>
    {(!compact || phone || (inputEnabled && (phase === 'disconnected' || state.paused))) && <div className={styles.toolbar}>
      {state.notice && <p role="status" className={styles.notice}>{state.notice}</p>}
      <div className={styles.controls} data-lease={leaseText ? true : undefined} data-disconnected={phase === 'disconnected' || undefined}>
        <span className={styles.state}>
          <span role="status" className={leaseText && routineMessage ? 'visually-hidden' : undefined}>{state.message}</span>
          {leaseText && <span className={styles.lease}>{leaseText}</span>}
        </span>
        {/* Phone text size (desktop keeps browser zoom) shares the mode row so the terminal keeps its height. */}
        <div className={styles.textSize} role="group" aria-label="Text size">
          <button type="button" aria-label="A− Decrease text size" disabled={fontSize <= TERMINAL_FONT_SIZE_MIN} onClick={() => setFontSize(size => clampTerminalFontSize(size - TERMINAL_FONT_SIZE_STEP))}>A−</button>
          <span className={styles.size}>{fontSize}px</span>
          <button type="button" aria-label="A+ Increase text size" disabled={fontSize >= TERMINAL_FONT_SIZE_MAX} onClick={() => setFontSize(size => clampTerminalFontSize(size + TERMINAL_FONT_SIZE_STEP))}>A+</button>
        </div>
        {!phone && (phase === 'disconnected'||state.paused) && <ActionButton onClick={reconnect}>Reconnect</ActionButton>}
        {!phone && phase === 'connected' && !state.paused && <ActionButton onClick={disconnect}>Disconnect</ActionButton>}
        {!phone && controlReason && <span id={controlReasonId} className={styles.controlReason}>{controlReason}</span>}
      </div>
    </div>}
    <>
      <div className={styles.frame} ref={frame}>
        <div className={styles.host} ref={host} hidden={frozen} />
        {/* Input is frozen while disconnected: the last observation is text, never a live terminal. */}
        {frozen && <figure className={styles.observation} aria-label="Last observation">
          <pre tabIndex={0}>{snapshot.join('\n')}</pre>
          <figcaption>Last observation · output after this point was not observed. Reconnect reads this same terminal{binding.current ? ` (epoch ${binding.current.terminal.epoch})` : ''} again and replays what it retained; it never relaunches the agent.</figcaption>
        </figure>}
      </div>
      {!compact && !phone && panHint && <div className={styles.view}>{panHint}</div>}
      <footer className={styles.footer}>
        {/* Reference 08 order: Output · Progress · ● Connected. */}
        {!compact && <span>{state.outputObservedAtMs && now !== null ? `Output ${formatAge(new Date(now).toISOString(), new Date(state.outputObservedAtMs).toISOString())}` : 'Output unavailable'}</span>}
        {!compact && !manual&&<span>Progress unavailable</span>}
        <span className={styles.connection} data-phase={phase}><span className={styles.dot} aria-hidden="true" />{!inputEnabled ? 'Ended' : phase === 'connected' ? 'Connected' : phase === 'connecting' ? 'Connecting' : 'Disconnected'}</span>
        {/* Phone: the pan hint joins the footer's second line so the terminal keeps its rows. */}
        {(phone || compact) && panHint}
        {facts && <span className={styles.facts}>{facts}</span>}
        {!compact && <span className={styles.provenance} title="This is a rendering of the available byte stream. Earlier output may be missing.">{manual?'Live tmux session':'Resident output · incomplete'}</span>}
      </footer>
      {keyBar && <div className={styles.keys} ref={keys} role="group" aria-label="Terminal keyboard" data-fade-start={keyFade.start || undefined} data-fade-end={keyFade.end || undefined} onScroll={updateKeyFade}>
        <button type="button" ref={typeButton} disabled={!state.controlling} onClick={() => terminal.current?.focus()}>Type</button>
        {KEYS.slice(0, 2).map(([label, name, bytes]) => <button type="button" key={label} disabled={!state.controlling} aria-label={name} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" className={styles.modifier} disabled={!state.controlling} aria-pressed={ctrl} onClick={() => { setCtrl(!ctrlArmed.current); focusTerminal(); }}>Ctrl</button>
        {KEYS.slice(2).map(([label, name, bytes]) => <button type="button" key={label} disabled={!state.controlling} aria-label={name} onClick={() => send(bytes)}>{label}</button>)}
        <button type="button" onClick={disconnect}>Disconnect</button>
      </div>}
      <p id={helpId} className={phone?styles.help:'visually-hidden'}>{phone?'Type to interact. Ctrl+M returns focus to the controls. The Ctrl key applies to the next key only; Ctrl then C sends an interrupt, which does not cancel the task.':'Type to interact. Ctrl+M moves focus outside the terminal. Ctrl+C sends an interrupt.'}</p>
    </>
    {phone && (!compact || (inputEnabled && (phase === 'disconnected' || state.paused))) && <div className={styles.dock} ref={actions} data-terminal-actions>
      {viewSwitch}
      {controlReason && <p id={controlReasonId} className={styles.controlReason}>{controlReason}</p>}
      <div className={styles.actionBar}>
        {/* Message slot (AG-C): the session's durable mailbox message, when offered. */}
        <ActionButton disabled={!!messageReason || !onMessage} aria-describedby={messageReason ? messageNoteId : undefined} aria-haspopup="dialog" onClick={event => onMessage?.(event.currentTarget)}>Message</ActionButton>
        {messageReason && <span id={messageNoteId} className="visually-hidden">{messageReason}</span>}
        <ActionButton aria-label="More terminal actions" aria-haspopup="true" aria-expanded={moreOpen} aria-controls={menuId} onClick={() => setMoreOpen(v => !v)}>…</ActionButton>
        {moreOpen && <div id={menuId} className={styles.more} role="group" aria-label="More terminal actions" onKeyDown={event => { if (event.key === 'Escape') closeMore(); }}>
          <ActionButton autoFocus onClick={() => { closeMore(); reconnect(); }}>Reconnect</ActionButton>
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
