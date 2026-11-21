import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { InteractiveTerminal } from './InteractiveTerminal';

// The pane's measured size, as FitAddon would propose it; tests change it to simulate a resize.
const mocks = vi.hoisted(() => ({
  proposed: undefined as { cols: number; rows: number } | undefined,
  reset: 0, resizeSent: vi.fn(), terminalResize: vi.fn(), observers: [] as Array<() => void>,
  onResize: undefined as ((size: { cols: number; rows: number }) => void) | undefined,
  managed: undefined as undefined | { emit: (state: Record<string, unknown>) => void },
  managedResize: vi.fn(),
}));
vi.mock('../../app/session', () => ({ useSession: () => ({
  bootstrap: { capability: () => ({ enabled: true }), principal: { displayName: 'Owner' } },
  queryContext: { principalId: 'owner', authorizationRevision: '1', contractVersion: '1' },
}) }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { proposeDimensions() { return mocks.proposed; } } }));
vi.mock('@xterm/xterm', () => ({ Terminal: class {
  rows = 24; cols = 80; options = {}; element = document.createElement('div'); textarea = document.createElement('textarea');
  buffer = { active: { baseY: 0, length: 0, getLine: () => undefined } };
  parser = { registerOscHandler: () => ({ dispose() {} }), registerCsiHandler: () => ({ dispose() {} }) };
  loadAddon() {} open() {} attachCustomKeyEventHandler() {} onData() { return { dispose() {} }; } onBinary() { return { dispose() {} }; }
  onResize(fn: (size: { cols: number; rows: number }) => void) { mocks.onResize = fn; return { dispose() {} }; }
  resize(cols: number, rows: number) {
    const changed = cols !== this.cols || rows !== this.rows;
    this.cols = cols; this.rows = rows; mocks.terminalResize(cols, rows);
    if (changed) mocks.onResize?.({ cols, rows });
  }
  reset() { mocks.reset += 1; }
  dispose() {} scrollLines() {} focus() {}
} }));
vi.mock('../../api/manualTerminalClient', () => ({ connectManualTerminal: () => ({
  close: vi.fn(), sendInput: vi.fn(), sendEscape: vi.fn(), repaint: vi.fn(), release: vi.fn(), resize: mocks.resizeSent,
}) }));

// A managed task/attempt terminal: the test drives the connection's state (controller or watcher, session grid).
vi.mock('../../api/nativeTerminalClient', () => ({ connectNativeTerminal: (options: { state: (state: Record<string, unknown>) => void }) => {
  mocks.managed = { emit: state => options.state({ message: 'x', connected: true, controlling: false, canControl: true, paused: false, ...state }) };
  return { close: vi.fn(), sendInput: vi.fn(), sendEscape: vi.fn(), repaint: vi.fn(), release: vi.fn(), takeControl: vi.fn(), resize: mocks.managedResize };
} }));

const rect = (width: number, height: number) => ({ x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height, toJSON() {} }) as DOMRect;

function stubObservers() {
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { mocks.observers.push(callback); } observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
}
const resizeContainer = () => act(() => { mocks.observers.forEach(callback => callback()); });

describe.each([['manual', { manual: true }], ['host-shell', { hostShell: true }]] as const)('%s terminal fits its pane', (_kind, props) => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mocks.proposed = undefined; mocks.reset = 0; mocks.observers = []; mocks.onResize = undefined;
    mocks.resizeSent.mockClear(); mocks.terminalResize.mockClear();
    stubObservers();
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 500));
  });
  afterEach(() => { rectSpy.mockRestore(); vi.unstubAllGlobals(); });

  const mount = () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><InteractiveTerminal terminalId="shell-1" name="Shell" {...props} /></QueryClientProvider>);
    return { ...view, done: () => { view.unmount(); client.clear(); } };
  };

  test('opens at the pane size, then follows container resizes without a reset or reconnect', () => {
    mocks.proposed = { cols: 132, rows: 41 };
    const { container, done } = mount();
    try {
      expect(mocks.terminalResize).toHaveBeenLastCalledWith(132, 41);
      expect(mocks.resizeSent).toHaveBeenLastCalledWith(132, 41);
      expect(container.querySelector<HTMLElement>('[data-cols]')?.dataset.cols).toBe('132');
      mocks.proposed = { cols: 100, rows: 30 };
      resizeContainer();
      expect(mocks.terminalResize).toHaveBeenLastCalledWith(100, 30);
      expect(mocks.resizeSent).toHaveBeenLastCalledWith(100, 30);
      expect(container.querySelector<HTMLElement>('[data-cols]')?.dataset.cols).toBe('100');
      expect(mocks.reset).toBe(0);
    } finally { done(); }
  });

  test('an unchanged size sends nothing, so repeated observer callbacks cannot loop', () => {
    mocks.proposed = { cols: 120, rows: 36 };
    const { done } = mount();
    try {
      const sent = mocks.resizeSent.mock.calls.length;
      for (let n = 0; n < 5; n += 1) resizeContainer();
      expect(mocks.resizeSent).toHaveBeenCalledTimes(sent);
    } finally { done(); }
  });

  test('a hidden pane keeps its size and is fitted when it is shown', () => {
    mocks.proposed = { cols: NaN, rows: NaN };
    rectSpy.mockReturnValue(rect(0, 0));
    const { done } = mount();
    try {
      expect(mocks.terminalResize).not.toHaveBeenCalled();
      rectSpy.mockReturnValue(rect(900, 500)); mocks.proposed = { cols: 110, rows: 32 };
      resizeContainer();
      expect(mocks.terminalResize).toHaveBeenLastCalledWith(110, 32);
      expect(mocks.resizeSent).toHaveBeenLastCalledWith(110, 32);
    } finally { done(); }
  });
});

describe('managed task terminal', () => {
  let rectSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mocks.proposed = { cols: 132, rows: 41 }; mocks.observers = []; mocks.onResize = undefined; mocks.managed = undefined;
    mocks.managedResize.mockClear(); mocks.terminalResize.mockClear(); mocks.resizeSent.mockClear();
    stubObservers();
    rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect(900, 500));
  });
  afterEach(() => { rectSpy.mockRestore(); vi.unstubAllGlobals(); });
  const mount = () => {
    const client = new QueryClient();
    const view = render(<QueryClientProvider client={client}><InteractiveTerminal terminalId="task-1" name="Worker" /></QueryClientProvider>);
    return { ...view, done: () => { view.unmount(); client.clear(); } };
  };
  const pane = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-cols]')!;

  test('the controller fits the pane and asks the session to follow each distinct size', () => {
    const { container, done } = mount();
    try {
      act(() => mocks.managed!.emit({ grid: { columns: 120, rows: 40 }, controlling: false }));
      // A watcher keeps the session's grid and never resizes it.
      expect(mocks.managedResize).not.toHaveBeenCalled();
      expect(pane(container).dataset.cols).toBe('120');
      act(() => mocks.managed!.emit({ grid: { columns: 120, rows: 40 }, controlling: true }));
      expect(mocks.managedResize).toHaveBeenLastCalledWith(132, 41);
      expect(pane(container).dataset.cols).toBe('132');
      mocks.proposed = { cols: 100, rows: 30 };
      resizeContainer();
      expect(mocks.managedResize).toHaveBeenLastCalledWith(100, 30);
      expect(pane(container).dataset.cols).toBe('100');
      const sent = mocks.managedResize.mock.calls.length;
      for (let n = 0; n < 5; n += 1) resizeContainer();
      act(() => mocks.managed!.emit({ grid: { columns: 100, rows: 30 }, controlling: true }));
      expect(mocks.managedResize).toHaveBeenCalledTimes(sent);
      expect(mocks.resizeSent).not.toHaveBeenCalled();
    } finally { done(); }
  });

  test('a session already at the pane size is not resized, and a watcher keeps its grid when the pane changes', () => {
    mocks.proposed = { cols: 120, rows: 40 };
    const { container, done } = mount();
    try {
      act(() => mocks.managed!.emit({ grid: { columns: 120, rows: 40 }, controlling: true }));
      expect(mocks.managedResize).not.toHaveBeenCalled();
      act(() => mocks.managed!.emit({ grid: { columns: 120, rows: 40 }, controlling: false }));
      mocks.proposed = { cols: 90, rows: 20 };
      resizeContainer();
      expect(mocks.managedResize).not.toHaveBeenCalled();
      expect(pane(container).dataset.cols).toBe('120');
    } finally { done(); }
  });

  test('a hidden pane is fitted and resized once it is shown', () => {
    mocks.proposed = { cols: NaN, rows: NaN };
    rectSpy.mockReturnValue(rect(0, 0));
    const { done } = mount();
    try {
      act(() => mocks.managed!.emit({ grid: { columns: 120, rows: 40 }, controlling: true }));
      expect(mocks.managedResize).not.toHaveBeenCalled();
      rectSpy.mockReturnValue(rect(900, 500)); mocks.proposed = { cols: 110, rows: 32 };
      resizeContainer();
      expect(mocks.managedResize).toHaveBeenLastCalledWith(110, 32);
    } finally { done(); }
  });
});
