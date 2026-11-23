import type { RefObject } from 'react';
import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';
import type { TerminalConnection, TerminalGrid } from '../../../api/interactiveTerminalClient';
import { TERMINAL_FONT_FAMILY, TERMINAL_FONT_SIZE } from './terminalSetup';

/** Spec §6: a split pane must fit at least this many columns at the readable font size. */
export const MIN_PANE_COLUMNS = 80;
/** Horizontal space a pane spends outside its character grid: `.frame` padding (2 × 12px)
 * plus the xterm viewport scrollbar FitAddon reserves when scrollback is enabled. */
export const SCROLLBAR_PX = 14;
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

interface LayoutOptions {
  term: Terminal;
  fit: FitAddon;
  host: RefObject<HTMLDivElement | null>;
  frame: RefObject<HTMLDivElement | null>;
  pane: RefObject<HTMLElement | null>;
  fixed: boolean;
  controlling: RefObject<boolean>;
  requested: RefObject<TerminalGrid | undefined>;
  transport: TerminalConnection;
  updateWidth: () => void;
  setPanColumns: (columns: number | null) => void;
}

/** Fit above the phone controls, measuring siblings rather than spare space in an expanded pane. */
function fitFrameToViewport(frame: HTMLDivElement, hasPane: boolean) {
  const viewport = window.visualViewport;
  const box = frame.getBoundingClientRect();
  let bottom = box.bottom;
  for (let after = frame.nextElementSibling; after; after = after.nextElementSibling) {
    bottom = Math.max(bottom, after.getBoundingClientRect().bottom);
  }
  const below = (hasPane ? bottom - box.bottom : 170) + 8;
  frame.style.maxHeight = viewport && viewport.width < 768
    ? `${Math.max(180, viewport.height + viewport.offsetTop - box.top - below)}px` : '';
}

function fitGrid(options: LayoutOptions, dimensions: ReturnType<FitAddon['proposeDimensions']>) {
  // A hidden host (frozen last observation) proposes NaN; keep the current size.
  if (!dimensions || !Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
  const { term, fixed, controlling, requested, transport, updateWidth } = options;
  const cols = Math.max(MIN_PANE_COLUMNS, Math.min(500, dimensions.cols));
  const rows = Math.max(8, Math.min(300, dimensions.rows));
  if (!fixed) {
    term.resize(cols, rows);
    return;
  }
  // Only the controller asks a managed session to follow the pane; watchers retain its grid.
  if (!controlling.current || !transport.resize) return;
  if (cols !== term.cols || rows !== term.rows) {
    term.resize(cols, rows);
    updateWidth();
  }
  if (cols !== requested.current?.columns || rows !== requested.current.rows) {
    requested.current = { columns: cols, rows };
    transport.resize(cols, rows);
  }
}

/** One layout scheduler per terminal attachment; disposing it releases its observers and frame. */
export function createTerminalLayout(options: LayoutOptions) {
  const { term, fit, host, frame, pane, setPanColumns } = options;
  let animation = 0;
  function measure() {
    const target = host.current;
    if (!target || !frame.current || target.getBoundingClientRect().width === 0 || target.getBoundingClientRect().height === 0) return;
    fitFrameToViewport(frame.current, !!pane.current);
    const dimensions = fit.proposeDimensions();
    fitGrid(options, dimensions);
    if (pane.current) {
      pane.current.dataset.cols = String(term.cols);
      pane.current.dataset.fitCols = dimensions ? String(dimensions.cols) : '';
    }
    const screen = target.querySelector<HTMLElement>('.xterm-screen');
    setPanColumns(screen && screen.scrollWidth > target.clientWidth ? term.cols : null);
  }
  function schedule() {
    cancelAnimationFrame(animation);
    animation = requestAnimationFrame(measure);
  }
  const observer = new ResizeObserver(schedule);
  return {
    schedule,
    observe() {
      if (host.current) observer.observe(host.current);
      // Expand moves and grows the pane without resizing the capped host.
      if (pane.current) observer.observe(pane.current);
      schedule();
      const screen = host.current?.querySelector('.xterm-screen');
      if (screen) observer.observe(screen);
      void document.fonts?.ready.then(schedule);
      window.visualViewport?.addEventListener('resize', schedule);
      window.visualViewport?.addEventListener('scroll', schedule);
    },
    dispose() {
      cancelAnimationFrame(animation);
      observer.disconnect();
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
    },
  };
}
