import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { vi } from 'vitest';
import bootstrap from '../../../../contracts/proposed/bootstrap.json';
import { envelope, handlersFor } from '../../../mocks/handlers';
import { SESSIONS } from '../../../mocks/inspectionData';
import { graphId, graphProject } from '../../../test/humanGraph';
import { SWARM_MOCKUP } from '../../../mocks/swarm';
import { renderApp } from '../../../test/renderApp';

const mounts = vi.hoisted(() => ({ counts: new Map<string, number>() }));
vi.mock('../InteractiveTerminal', async () => {
  const React = await import('react');
  return { InteractiveTerminal: ({ terminalId, inputEnabled }: {terminalId: string; inputEnabled?: boolean}) => {
    React.useEffect(() => { mounts.counts.set(terminalId, (mounts.counts.get(terminalId) ?? 0) + 1); }, [terminalId]);
    return <div data-testid={`terminal-${terminalId}`} data-input-enabled={String(inputEnabled)}>Fixture terminal {terminalId}</div>;
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

test('saved unavailable selections remain individually removable', async () => {
  const { router, queryClient } = renderApp('/agents');
  const roster = await screen.findByRole('complementary', { name: 'Agent roster' });
  const button = (await within(roster).findAllByRole('button', { name: /^Add .* to workspace$/ }))[0]!;
  fireEvent.click(button);
  await screen.findByTestId(/^terminal-/);
  await router.navigate('/overview');
  queryClient.clear();
  server.use(http.get('/api/v1/swarm', () => HttpResponse.error()), http.get('/api/v1/sessions/:id', () => new HttpResponse(null, {status: 404})));
  await router.navigate('/agents');
  expect(await screen.findByText(/unavailable in this scope/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', {name: /^Close .* pane$/}));
  expect(await screen.findByText('Select an agent to open its terminal.')).toBeInTheDocument();
});


test('launch immediately opens its pending pane and reports a refused request after the form closes', async () => {
  const node = SWARM_MOCKUP.machines[0]!.nodes[0]!.node.id, repo = graphId(101);
  let release: () => void = () => {};
  const delayed = new Promise<void>(resolve => { release = resolve; });
  server.use(
    http.get('/api/v1/bootstrap', () => HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c => !['swarm.read','tasks.create'].includes(c.name)),{name:'swarm.read',version:'1',enabled:true},{name:'tasks.create',version:'1',enabled:true}]}})),
    http.get('/api/manual-agents', () => HttpResponse.json({launch_profiles:[{profile_id:'standard-medium',profile_version:1,candidate_id:'one',name:'Standard',provider:'anthropic',model:'fixture-model',reasoning:'medium',harness:'claude'}],sessions:[],workers:[{node_id:node,max_slots:4,providers:['anthropic'],repositories:[repo],observed_at_ms:Date.now()}],slots:[],projects:[{id:graphProject,name:'Fixture project',repository_id:repo}],server_time_ms:Date.now()})),
    http.post(`/api/manual-agents/workers/${node}/projects/${graphProject}`, async () => { await delayed; return new HttpResponse(null,{status:403}); }),
  );
  renderApp('/agents');
  fireEvent.click(await screen.findByRole('button',{name:'Launch agent'}));
  const start = await screen.findByRole('button',{name:'Start agent'});
  await waitFor(() => expect(start).toBeEnabled());
  fireEvent.click(start);
  expect(await screen.findByRole('button',{name:'Close Fixture project pane'})).toBeInTheDocument();
  expect(screen.getByText('Starting agent…')).toBeInTheDocument();
  release();
  expect(await screen.findByText(/Launch could not be confirmed/)).toBeInTheDocument();
});


test('a native pane follows session detail into ended state without remounting', async () => {
  const first = SESSIONS[0]!;
  let stopped = false;
  server.use(http.get(`/api/v1/sessions/${first.id}`, () => HttpResponse.json(envelope({...first, observation:{...first.observation,state:stopped ? 'reported_stopped' : 'reported_running'}}))));
  const { queryClient } = renderApp('/agents');
  const roster = await screen.findByRole('complementary', {name:'Agent roster'});
  fireEvent.click((await within(roster).findAllByRole('button',{name:/^Add .* to workspace$/}))[0]!);
  const pane = await screen.findByTestId(`terminal-${first.terminal!.id}`);
  await waitFor(() => expect(pane).toHaveAttribute('data-input-enabled','true'));
  const count = mounts.counts.get(first.terminal!.id);
  stopped = true;
  await queryClient.invalidateQueries({ predicate: q => q.queryKey.includes('session') });
  await waitFor(() => expect(pane).toHaveAttribute('data-input-enabled','false'));
  expect(mounts.counts.get(first.terminal!.id)).toBe(count);
  expect(screen.getByText(/Native transcript availability/)).toBeInTheDocument();
});

test('refused manual roster refresh disconnects an open pane and clears its stale roster row', async () => {
  let refused = false;
  const node = SWARM_MOCKUP.machines[0]!.nodes[0]!.node.id, repo = graphId(101), id = graphId(995);
  const agent = {id,node_id:node,project_id:graphProject,spec:{project_name:'Fixture private agent',repository_id:repo,provider:'anthropic',model:'fixture'},status:'running',stage:'Running',desired_running:true,created_at_ms:1,updated_at_ms:2,worker_seen_at_ms:2};
  server.use(
    http.get('/api/v1/bootstrap', () => HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c => !['swarm.read','tasks.create'].includes(c.name)),{name:'swarm.read',version:'1',enabled:true},{name:'tasks.create',version:'1',enabled:true}]}})),
    http.get('/api/manual-agents', () => refused ? new HttpResponse(null,{status:403}) : HttpResponse.json({sessions:[agent],workers:[],slots:[],projects:[],server_time_ms:2})),
    http.get(`/api/manual-agents/${id}/transcript`, () => new HttpResponse(null,{status:403})),
  );
  const {queryClient} = renderApp('/agents');
  fireEvent.click(await screen.findByRole('button',{name:'Add Fixture private agent to workspace'}));
  await screen.findByTestId(`terminal-${id}`);
  refused = true;
  await queryClient.invalidateQueries({queryKey:['manual-agents']});
  expect(await screen.findByText('Interactive agents could not be loaded.')).toBeInTheDocument();
  expect(screen.queryByTestId(`terminal-${id}`)).not.toBeInTheDocument();
  expect(screen.queryByText('Fixture private agent')).not.toBeInTheDocument();
  expect(screen.getByText(/unavailable in this scope/)).toBeInTheDocument();
});
