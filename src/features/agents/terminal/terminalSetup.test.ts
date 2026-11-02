import { Terminal } from '@xterm/xterm';
import { expect, it } from 'vitest';
import { guardObservedTerminalQueries } from './terminalSetup';
it('renders watched bytes without duplicating upstream DA/DSR replies and preserves user input', async () => {
  const term = new Terminal({ cols: 80, rows: 24 });
  const data: string[] = []; const input = term.onData(value => data.push(value));
  const guards = guardObservedTerminalQueries(term);
  try {
    await new Promise<void>(resolve => term.write('\x1b[c\x1b[>c\x1b[=c\x1b[5n\x1b[6n\x1b[?6n\x1b[32mLive terminal\x1b[0m', resolve));
    expect(data).toEqual([]);
    expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe('Live terminal');
    term.input('hello\r', true);
    expect(data).toEqual(['hello\r']);
  } finally { guards.forEach(g => g.dispose()); input.dispose(); term.dispose(); }
});
