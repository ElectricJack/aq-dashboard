import { Terminal } from '@xterm/xterm';
import { expect, it } from 'vitest';
import { clampTerminalFontSize, guardObservedTerminalQueries, isObservedFocusReport, withControlModifier } from './terminalSetup';
it('renders watched bytes without duplicating upstream DA/DSR replies and preserves user input', async () => {
  const term = new Terminal({ cols: 80, rows: 24 });
  const data: string[] = []; const input = term.onData(value => { if (!isObservedFocusReport(value)) data.push(value); });
  const guards = guardObservedTerminalQueries(term);
  try {
    await new Promise<void>(resolve => term.write('\x1b[c\x1b[>c\x1b[=c\x1b[5n\x1b[6n\x1b[?6n\x1b[32mLive terminal\x1b[0m', resolve));
    expect(data).toEqual([]);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('Live terminal');
    term.input('hello\r', true);
    term.input('\x1b[I'); term.input('\x1b[O'); term.input('\x1b', true);
    expect(data).toEqual(['hello\r', '\x1b']);
  } finally { guards.forEach(g => g.dispose()); input.dispose(); term.dispose(); }
});
it('encodes the sticky Ctrl modifier like an xterm chord', () => {
  expect(withControlModifier('c')).toBe('\x03');
  expect(withControlModifier('C')).toBe('\x03');
  expect(withControlModifier('[')).toBe('\x1b');
  expect(withControlModifier(' ')).toBe('\x00');
  expect(withControlModifier('?')).toBe('\x7f');
  expect(withControlModifier('\x1b[A')).toBe('\x1b[1;5A');
  expect(withControlModifier('\x1bOD')).toBe('\x1b[1;5D');
  expect(withControlModifier('\r')).toBe('\r');
  expect(withControlModifier('ab')).toBe('ab');
  expect(withControlModifier('é')).toBe('é');
});
it('bounds the text size between the readable minimum and 20px', () => {
  expect(clampTerminalFontSize(10)).toBe(14);
  expect(clampTerminalFontSize(16)).toBe(16);
  expect(clampTerminalFontSize(26)).toBe(20);
});
