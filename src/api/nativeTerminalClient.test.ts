import type { TerminalIdentity } from './wire/terminalTail';
import { terminalJson } from './terminalClient';
import { expect, it, vi } from 'vitest';
import { liveAttempt } from './nativeTerminalClient';
import { apiSend } from './client';
vi.mock('./terminalClient', () => ({ terminalJson: vi.fn() }));
vi.mock('./client', () => ({ apiSend: vi.fn() }));
const id = (n: number) => `10000000-0000-4000-8000-00000000000${n}`;
const terminal: TerminalIdentity = { terminal_id: id(1), epoch: 1, session: { kind: 'remote', node_id: id(2), boot_id: id(3), attempt_id: id(4), assignment_generation: 1, session_id: id(5) } };
const info = (input_enabled: boolean) => ({ terminal, session_revision: 2, input_mode: 'finite_v1', terminal_policy: { input_enabled }, disconnected: false, control: { terminal, session_revision: 2, generation: 0, lease: null, fence_acknowledged: false, input_paused: false } });
const answer = (body: unknown) => vi.mocked(terminalJson).mockResolvedValueOnce({ body, serverTime: 1 });
it('a sandboxed attempt (output-only finite policy) is served by its live attempt stream', async () => {
  answer(info(false)); vi.mocked(apiSend).mockResolvedValueOnce({ generation: 1 });
  expect(await liveAttempt(id(1), new AbortController().signal)).toBe(id(4));
  expect(vi.mocked(apiSend).mock.calls[0]?.[1]).toBe(`/api/attempt-terminals/${id(4)}/terminal/connect`);
  expect(vi.mocked(terminalJson).mock.calls[0]?.[0]).toBe(`/api/v1/terminals/${id(1)}`);
});
it('a finite-input terminal, an ended one, or one that cannot be inspected, keeps the finite relay', async () => {
  answer(info(false)); vi.mocked(apiSend).mockRejectedValueOnce(new Error('409: the attempt no longer runs'));
  expect(await liveAttempt(id(1), new AbortController().signal)).toBeNull();
  answer(info(true));
  expect(await liveAttempt(id(1), new AbortController().signal)).toBeNull();
  vi.mocked(terminalJson).mockRejectedValueOnce(new Error('offline'));
  expect(await liveAttempt(id(1), new AbortController().signal)).toBeNull();
});
