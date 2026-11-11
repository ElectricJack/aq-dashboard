import {screen,fireEvent,waitFor} from '@testing-library/react';
import {http,HttpResponse} from 'msw';
import {setupServer} from 'msw/node';
import {handlersFor} from '../../../mocks/handlers';
import {renderApp} from '../../../test/renderApp';
import {stubReactFlowDom} from '../../../test/reactFlow';
import {SWARM_MOCKUP} from '../../../mocks/swarm';
const server=setupServer(...handlersFor('default'));let restore:()=>void;
beforeAll(()=>{restore=stubReactFlowDom();server.listen({onUnhandledFrame:'error'});});
beforeEach(()=>{sessionStorage.clear();localStorage.clear();});
afterEach(()=>{server.resetHandlers();vi.unstubAllEnvs();});afterAll(()=>{server.close();restore();});
const node=SWARM_MOCKUP.machines[0]!.nodes[0]!.node.id;
test('queues checks and shows the returned engine error',async()=>{
 let jobs:unknown[]=[];const seen:unknown[]=[];
 server.use(http.get('/api/worker-diagnostics',()=>HttpResponse.json({jobs,receivers:[{node_id:node,version:1,seen_at_ms:Date.now()}],server_time_ms:Date.now()})),http.post(`/api/worker-diagnostics/${node}`,async({request})=>{const body=await request.json() as Record<string,unknown>;seen.push(body);jobs=[{id:body.operation_id,node_id:node,kind:'sandbox_startup_v1',status:'completed',result:{ok:false,phase:'container_start',error:'Network helper failed',details:{CgroupVersion:'2'}}}];return HttpResponse.json({operation_id:body.operation_id});}));
 renderApp(`/agents?select=node:${node}`);fireEvent.click(await screen.findByRole('button',{name:'Run checks'}));expect(await screen.findByText('container_start: Network helper failed')).toBeInTheDocument();expect(seen[0]).toMatchObject({kind:'sandbox_startup_v1'});
});
test('receiver update carries the published installer pin and no command',async()=>{
 vi.stubEnv('VITE_AQ_WORKER_INSTALL_URL','https://worker.example');vi.stubEnv('VITE_AQ_WORKER_INSTALL_SHA256','a'.repeat(64));const seen:Record<string,unknown>[]=[];
 server.use(http.get('/api/worker-diagnostics',()=>HttpResponse.json({jobs:[],receivers:[{node_id:node,version:1,seen_at_ms:Date.now()}],server_time_ms:Date.now()})),http.post(`/api/worker-diagnostics/${node}`,async({request})=>{const body=await request.json() as Record<string,unknown>;seen.push(body);return HttpResponse.json({operation_id:body.operation_id});}));
 renderApp(`/agents?select=node:${node}`);fireEvent.click(await screen.findByRole('button',{name:'Update controls'}));await waitFor(()=>expect(seen).toHaveLength(1));expect(seen[0]).toMatchObject({kind:'receiver_update_v1',installer_sha256:'a'.repeat(64)});expect(seen[0]).not.toHaveProperty('command');
});
test('unknown request outcome keeps its operation identity for retry',async()=>{
 const seen:Record<string,unknown>[]=[];server.use(http.post(`/api/worker-diagnostics/${node}`,async({request})=>{const body=await request.json() as Record<string,unknown>;seen.push(body);return seen.length===1?HttpResponse.error():HttpResponse.json({operation_id:body.operation_id});}));
 renderApp(`/agents?select=node:${node}`);fireEvent.click(await screen.findByRole('button',{name:'Run checks'}));fireEvent.click(await screen.findByRole('button',{name:'Retry request'}));await waitFor(()=>expect(seen).toHaveLength(2));expect(seen[0]).toEqual(seen[1]);
});
