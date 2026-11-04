import type { IDisposable, ITerminalOptions, ITheme, Terminal } from "@xterm/xterm";

/**
 * What every dashboard terminal looks like: the desktop terminal and the phone
 * terminal render the same tmux bytes with this one theme, so a colour on a
 * phone is the colour on a desktop. The sixteen ANSI colours are xterm.js's
 * own defaults, written out so the palette is a contract rather than whatever
 * the library ships next. xterm.css paints `.xterm-viewport` #000 whatever
 * the theme says, so each host also sets `[&_.xterm-viewport]:bg-[#0d1117]!`.
 */
export const TERMINAL_BACKGROUND = "#0d1117";

export const TERMINAL_THEME: ITheme = {
  background: TERMINAL_BACKGROUND,
  foreground: "#d1d5db",
  cursor: "#e5e7eb",
  selectionBackground: "#6366f14d",
  black: "#2e3436",
  red: "#cc0000",
  green: "#4e9a06",
  yellow: "#c4a000",
  blue: "#3465a4",
  magenta: "#75507b",
  cyan: "#06989a",
  white: "#d3d7cf",
  brightBlack: "#555753",
  brightRed: "#ef2929",
  brightGreen: "#8ae234",
  brightYellow: "#fce94f",
  brightBlue: "#729fcf",
  brightMagenta: "#ad7fa8",
  brightCyan: "#34e2e2",
  brightWhite: "#eeeeec",
};

export const TERMINAL_FONT_FAMILY = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace';
export const TERMINAL_LINE_HEIGHT = 1.2;
/** The host shell's fixed font size, used by every terminal. */
export const TERMINAL_FONT_SIZE = 14;
/** Preserve the host shell's existing scrollback limit. */
export const TERMINAL_SCROLLBACK = 2000;

/**
 * The xterm options every dashboard terminal is built from. One factory, so the
 * host shell page's remote shell, an agent or session window's terminal and the
 * phone's are the same terminal: the same font, line height, palette,
 * scrollback and input policy.
 */
export function terminalOptions(fontSize: number = TERMINAL_FONT_SIZE): ITerminalOptions {
  return {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize,
    lineHeight: TERMINAL_LINE_HEIGHT,
    cursorBlink: true,
    scrollback: TERMINAL_SCROLLBACK,
    // Input is enabled only after the attach is ready.
    disableStdin: true,
    logLevel: "off",
    theme: TERMINAL_THEME,
  };
}

/**
 * Terminal output is untrusted. Keep manual copy/paste, but never let escape
 * sequences access the clipboard (OSC 52) or activate remote hyperlinks (OSC 8).
 */
export function guardUntrustedOutput(terminal: Terminal): IDisposable[] {
  return [
    terminal.parser.registerOscHandler(52, () => true),
    terminal.parser.registerOscHandler(8, () => true),
  ];
}

/** The upstream tmux owns the application TTY and already answers its device
 * queries. A Watch renderer must not turn those queries into operator input. */
export function guardObservedTerminalQueries(terminal: Terminal): IDisposable[] {
  return [
    terminal.parser.registerCsiHandler({ final: 'c' }, () => true),
    terminal.parser.registerCsiHandler({ prefix: '>', final: 'c' }, () => true),
    terminal.parser.registerCsiHandler({ prefix: '=', final: 'c' }, () => true),
    terminal.parser.registerCsiHandler({ final: 'n' }, () => true),
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'n' }, () => true),
  ];
}

/** Focus notifications describe the local viewer, not operator keystrokes.
 * Upstream tmux already owns application focus. Ordinary Escape is untouched. */
export function isObservedFocusReport(data: string): boolean {
  return data === '\x1b[I' || data === '\x1b[O';
}

/** Phone text-size bounds (spec §6): never below the 14px readable default. */
export const TERMINAL_FONT_SIZE_MIN = TERMINAL_FONT_SIZE;
export const TERMINAL_FONT_SIZE_MAX = 20;
export const TERMINAL_FONT_SIZE_STEP = 2;
export function clampTerminalFontSize(size: number): number {
  return Math.max(TERMINAL_FONT_SIZE_MIN, Math.min(TERMINAL_FONT_SIZE_MAX, size));
}

const CTRL_SYMBOLS: Record<string, number> = { '@': 0, ' ': 0, '2': 0, '[': 0x1b, '3': 0x1b, '\\': 0x1c, '4': 0x1c, ']': 0x1d, '5': 0x1d, '^': 0x1e, '6': 0x1e, '_': 0x1f, '-': 0x1f, '7': 0x1f, '/': 0x1f, '?': 0x7f, '8': 0x7f };
const CTRL_ARROWS: Record<string, string> = { '\x1b[A': '\x1b[1;5A', '\x1b[B': '\x1b[1;5B', '\x1b[C': '\x1b[1;5C', '\x1b[D': '\x1b[1;5D', '\x1bOA': '\x1b[1;5A', '\x1bOB': '\x1b[1;5B', '\x1bOC': '\x1b[1;5C', '\x1bOD': '\x1b[1;5D' };

/** Apply a sticky on-screen Ctrl modifier to the next key's data, as xterm
 * would encode the chord: letters and the C0 symbols become control codes and
 * arrows gain the xterm Ctrl parameter. Anything else passes through unchanged. */
export function withControlModifier(data: string): string {
  if (CTRL_ARROWS[data]) return CTRL_ARROWS[data];
  if (data.length !== 1) return data;
  const code = data.charCodeAt(0);
  if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) return String.fromCharCode(code & 0x1f);
  const symbol = CTRL_SYMBOLS[data];
  return symbol === undefined ? data : String.fromCharCode(symbol);
}
