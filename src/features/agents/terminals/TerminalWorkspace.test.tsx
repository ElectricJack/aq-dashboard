import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { vi } from 'vitest';
import bootstrap from '../../../../contracts/proposed/bootstrap.json';
import { handlersFor } from '../../../mocks/handlers';
import { renderApp } from '../../../test/renderApp';

const mounts = vi.hoisted(() => ({ counts: new Map<string, number>() }));
vi.mock('../InteractiveTerminal', async () => {
  const React = await import('react');
  return { InteractiveTerminal: ({ terminalId }: {terminalId: string}) => {
    React.useEffect(() => { mounts.counts.set(terminalId, (mounts.counts.get(terminalId) ?? 0) + 1); }, [terminalId]);
    return <div data-testid={`terminal-${terminalId}`}>Fixture terminal {terminalId}</div>;
  } };
});
const server = setupServer(...handlersFor('default', { fixtures: true }));
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
beforeEach(() => { sessionStorage.clear(); mounts.counts.clear(); server.use(http.get('/api/v1/bootstrap', () => HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c => c.name !== "swarm.read"),{name:"swarm.read",version:"1",enabled:true}]}}))); });
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test('four fixture sessions remain mounted through selection, search, expand and removal', async () => {
  renderApp('/agents');
  const roster = await screen.findByRole('complementary', { name: 'Agent roster' });
  const buttons = await within(roster).findAllByRole('button', { name: /^Add .* to workspace$/ });
  for (const button of buttons.slice(0, 4)) fireEvent.click(button);
  await waitFor(() => expect(screen.getAllByTestId(/^terminal-/)).toHaveLength(4));
  const initial = new Map(mounts.counts);
  fireEvent.change(within(roster).getByRole('textbox', { name: 'Search agents' }), { target: { value: 'Replay' } });
  fireEvent.click(screen.getAllByRole('button', { name: 'Expand' })[0]!);
  fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
  expect(mounts.counts).toEqual(initial);
  fireEvent.click(screen.getAllByRole('button', { name: /^Close .* pane$/ })[0]!);
  expect(screen.getAllByTestId(/^terminal-/)).toHaveLength(3);
  for (const [id, count] of mounts.counts) expect(count).toBe(initial.get(id));
});
