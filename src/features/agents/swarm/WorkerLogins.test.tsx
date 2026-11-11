import {screen,fireEvent,waitFor} from '@testing-library/react';
import {http,HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {handlersFor} from '../../../mocks/handlers';
import {renderApp} from '../../../test/renderApp';
import {stubReactFlowDom} from '../../../test/reactFlow';
import {SWARM_MOCKUP} from '../../../mocks/swarm';
const server=setupServer(...handlersFor('default'));
let restore:()=>void;
beforeAll(()=>{restore=stubReactFlowDom();server.listen({onUnhandledFrame:'error'});});
beforeEach(()=>{sessionStorage.clear();localStorage.clear();});
afterEach(()=>{server.resetHandlers();vi.unstubAllEnvs();});
afterAll(()=>{server.close();restore();});
const node=SWARM_MOCKUP.machines[0]!.nodes[0]!.node.id;
test('selects providers and queues logins without exposing material',async()=>{
 const seen:Record<string,unknown>[]=[];
 server.use(http.post(`/api/worker-logins/${node}`,async({request})=>{const req=await request.json() as Record<string,unknown>;seen.push(req);return HttpResponse.json({generation:req.operation_id});}));
 renderApp(`/agents?select=node:${node}`);
 const push=await screen.findByRole('button',{name:'Push logins'});
 fireEvent.click(screen.getByRole('checkbox',{name:'Codex'}));fireEvent.click(push);
 await waitFor(()=>expect(seen).toHaveLength(1));expect(seen[0]!.providers).toEqual(['anthropic']);expect(seen[0]).not.toHaveProperty('material');
});
test('uncertain push retries same operation and provider choice',async()=>{
 const seen:Record<string,unknown>[]=[];
 server.use(http.post(`/api/worker-logins/${node}`,async({request})=>{const req=await request.json() as Record<string,unknown>;seen.push(req);return seen.length===1?HttpResponse.error():HttpResponse.json({generation:req.operation_id});}));
 renderApp(`/agents?select=node:${node}`);fireEvent.click(await screen.findByRole('button',{name:'Push logins'}));fireEvent.click(await screen.findByRole('button',{name:'Retry push'}));
 await waitFor(()=>expect(seen).toHaveLength(2));expect(seen[0]).toEqual(seen[1]);
});
test('old worker shows update command while pending, new receiver confirms installed',async()=>{
 vi.stubEnv('VITE_AQ_WORKER_INSTALL_URL','https://worker.example');vi.stubEnv('VITE_AQ_WORKER_INSTALL_SHA256','a'.repeat(64));
 server.use(http.get('/api/worker-logins',()=>HttpResponse.json({deliveries:[{node_id:node,generation:'test',providers:['anthropic','openai'],status:'pending',receiver_seen_at_ms:null}],server_time_ms:Date.now()})));
 renderApp(`/agents?select=node:${node}`);expect(await screen.findByText('Logins queued. Waiting for the worker’s login receiver.')).toBeInTheDocument();fireEvent.click(screen.getByText('Update this worker'));expect(screen.getByRole('button',{name:'Copy install command'})).toBeInTheDocument();
});
