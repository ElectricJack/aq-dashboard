import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { TerminalState } from '../../api/interactiveTerminalClient';
import { InteractiveTerminal } from './InteractiveTerminal';

const mocks = vi.hoisted(() => ({
  lines: [] as string[],
  onData: undefined as ((value: string) => void) | undefined,
  state: undefined as ((value: TerminalState) => void) | undefined,
  close: vi.fn(), sendInput: vi.fn(), sendEscape: vi.fn(), repaint: vi.fn(), resize: vi.fn(), dispose: vi.fn(),
}));
vi.mock('../../app/session', () => ({ useSession: () => ({
  bootstrap: { capability: () => ({ enabled: true }), principal: { displayName: 'Owner' } },
  queryContext: { principalId: 'owner', authorizationRevision: '1', contractVersion: '1' },
}) }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return undefined; } } }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  rows = 24; cols = 80; options = {}; element = document.createElement('div'); textarea = document.createElement('textarea');
  buffer = { active: { get baseY() { return 0; }, get length() { return mocks.lines.length; }, getLine: (i: number) => ({ translateToString: () => mocks.lines[i] ?? '' }) } };
  parser = { registerOscHandler: () => ({ dispose() {} }), registerCsiHandler: () => ({ dispose() {} }) };
  loadAddon() {} open() {} attachCustomKeyEventHandler() {} onData(fn: (value: string) => void) { mocks.onData = fn; return { dispose() {} }; }
  resize(cols: number, rows: number) { this.cols = cols; this.rows = rows; mocks.resize(cols, rows); }
  onBinary() { return { dispose() {} }; } onResize() { return { dispose() {} }; }
  dispose() { mocks.dispose(); } scrollLines() {} focus() {}
} }));
// A running native terminal is opened through the native chooser (finite relay or live attempt stream).
vi.mock('../../api/nativeTerminalClient', () => ({ connectNativeTerminal: (options: { state: typeof mocks.state }) => {
  mocks.state = options.state;
  return { close: mocks.close, sendInput: mocks.sendInput, sendEscape: mocks.sendEscape, repaint: mocks.repaint, release: vi.fn() };
} }));

test('ending a live terminal preserves its latest visible screen and fences input', () => {
  mocks.lines = ['Earlier observation'];
  mocks.close.mockReset().mockImplementation(() => { mocks.lines = []; });
  mocks.sendInput.mockReset(); mocks.dispose.mockReset();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = (inputEnabled: boolean) => <QueryClientProvider client={client}><InteractiveTerminal terminalId="term-1" name="Agent" compact inputEnabled={inputEnabled} /></QueryClientProvider>;
  const { rerender, unmount } = render(view(true));
  act(() => mocks.state?.({ message: 'Disconnected', connected: false, controlling: false, canControl: false, paused: false }));
  act(() => mocks.state?.({ message: 'Connected', connected: true, controlling: true, canControl: true, paused: false }));
  mocks.lines = ['Latest output', 'Still visible'];
  rerender(view(false));
  const observation = screen.getByRole('figure', { name: 'Last observation' });
  expect(observation.querySelector('pre')).toHaveTextContent('Latest output Still visible');
  expect(observation).not.toHaveTextContent('Earlier observation');
  expect(screen.getByText('Ended')).toBeVisible();
  expect(mocks.close).toHaveBeenCalledTimes(1);
  expect(mocks.dispose).not.toHaveBeenCalled();
  act(() => mocks.onData?.('x'));
  expect(mocks.sendInput).not.toHaveBeenCalled();
  unmount(); client.clear();
});

test('task terminal renders the pane grid and keeps mouse and repaint out of keyboard input', () => {
  mocks.resize.mockClear(); mocks.sendInput.mockClear(); mocks.repaint.mockClear();
  const client = new QueryClient();
  const { container, unmount } = render(<QueryClientProvider client={client}><InteractiveTerminal terminalId="task-term" name="Agent" /></QueryClientProvider>);
  try {
    act(() => mocks.state?.({ message: 'Connected', connected: true, controlling: true, canControl: true, paused: false, canRepaint: true, grid: { columns: 120, rows: 40 } }));
    expect(mocks.resize).toHaveBeenCalledExactlyOnceWith(120, 40);
    const captured = container.querySelector('[data-fixed]')!;
    const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 30 });
    fireEvent(captured, wheel);
    expect(wheel.defaultPrevented).toBe(true);
    act(() => mocks.onData?.('\x1b[<43;37;5M'));
    fireEvent.click(screen.getByRole('button', { name: 'Repaint' }));
    expect(mocks.repaint).toHaveBeenCalledOnce();
    expect(mocks.sendInput).not.toHaveBeenCalled();
    act(() => mocks.onData?.('\x1b[D'));
    expect(mocks.sendInput).toHaveBeenCalledExactlyOnceWith(new TextEncoder().encode('\x1b[D'));
  } finally { unmount(); client.clear(); }
});
