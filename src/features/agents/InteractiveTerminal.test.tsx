import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { InteractiveTerminal } from './InteractiveTerminal';

const mocks = vi.hoisted(() => ({
  lines: [] as string[],
  onData: undefined as ((value: string) => void) | undefined,
  state: undefined as ((value: { message: string; connected: boolean; controlling: boolean; canControl: boolean; paused: boolean }) => void) | undefined,
  close: vi.fn(), sendInput: vi.fn(), dispose: vi.fn(),
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
  onBinary() { return { dispose() {} }; } onResize() { return { dispose() {} }; }
  dispose() { mocks.dispose(); } scrollLines() {} focus() {}
} }));
vi.mock('../../api/interactiveTerminalClient', () => ({ connectInteractiveTerminal: (options: { state: typeof mocks.state }) => {
  mocks.state = options.state;
  return { close: mocks.close, sendInput: mocks.sendInput, resize: vi.fn(), release: vi.fn() };
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
