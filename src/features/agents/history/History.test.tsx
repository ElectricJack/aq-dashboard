import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter } from 'react-router';
import { App } from '../../../app/App';
import { handlersFor } from '../../../mocks/handlers';
import { Component } from './index';

const id='00000000-0000-4000-8000-000000000001';
const session={id,node_id:'00000000-0000-4000-8000-000000000002',project_id:'00000000-0000-4000-8000-000000000003',spec:{provider:'anthropic',model:'fixture'},status:'stopped',stage:'Ended',desired_running:false,created_at_ms:1000,updated_at_ms:2000,worker_seen_at_ms:2000,conversation_available:true};
const server=setupServer(...handlersFor('default'));
beforeAll(()=>{server.listen({onUnhandledFrame:'error'});HTMLElement.prototype.scrollIntoView=vi.fn();});
afterEach(()=>server.resetHandlers());
afterAll(()=>server.close());
function setup() {
 const router=createMemoryRouter([{path:'/agents/history',Component}],{initialEntries:[`/agents/history?session=manual:${id}`]});
 const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:5000}}});
 const view=render(<App router={router} queryClient={client}/>);
 return {...view,client,dispose:()=>{router.dispose();client.clear();}};
}
function handlers() {
 server.use(
  http.get('/api/manual-agents/:id/conversation',()=>HttpResponse.json({session_id:id,project_id:session.project_id,conversation:null})),
  http.get('/api/manual-agents/history',()=>HttpResponse.json({sessions:[session],next_cursor:null,server_time_ms:2000})),
 );
}
test('opens a saved conversation and searches native text',async()=>{
 handlers();
 server.use(http.get('/api/manual-agents/:id/conversation',()=>HttpResponse.json({
  session_id:id,project_id:session.project_id,conversation:{partial:false,messages:[
   {role:'user',text:'Explain [scope].'},
   {role:'assistant',text:'The [scope] is project-specific.\nUse West.'},
  ]},
 })));
 const view=setup();const user=userEvent.setup();
 try{
  const conversation=await screen.findByLabelText('Saved conversation');
  expect(within(conversation).getByText('You')).toBeVisible();
  expect(within(conversation).getByText('Agent')).toBeVisible();
  await user.click(screen.getByLabelText('Find in conversation'));
  await user.paste('[scope]');
  await user.click(screen.getByRole('button',{name:'Find'}));
  expect(conversation.querySelector('mark')).toHaveTextContent('[scope]');
  expect(screen.getByRole('status')).toHaveTextContent('Match 1 of 2');
  await user.click(screen.getByRole('button',{name:'Next'}));
  expect(screen.getByRole('status')).toHaveTextContent('Match 2 of 2');
 }finally{view.dispose();}
});
test('shows an empty state for a session without a saved conversation',async()=>{
 handlers();
 const view=setup();
 try{
  expect(await screen.findByText('No saved conversation for this session.')).toBeVisible();
 }finally{view.dispose();}
});
test('an authorization refusal clears a previously saved conversation',async()=>{
 handlers();
 let refused=false;
 server.use(http.get('/api/manual-agents/:id/conversation',()=>refused
  ? new HttpResponse(null,{status:403})
  : HttpResponse.json({session_id:id,project_id:session.project_id,conversation:{partial:false,messages:[{role:'assistant',text:'A saved reply.'}]}})));
 const view=setup();
 try{
  expect(await screen.findByText('A saved reply.')).toBeVisible();
  refused=true;
  await view.client.invalidateQueries({queryKey:['history-conversation']});
  expect(await screen.findByRole('alert')).toHaveTextContent('access was refused');
  expect(screen.queryByText('A saved reply.')).not.toBeInTheDocument();
 }finally{view.dispose();}
});

const internalRun={id:'00000000-0000-4000-8000-0000000000a1',purpose:'playbook_call',status:'answered',affected:{kind:'task',id:'T-7',project_id:null},instructions:'i',input:'x',answer:{ok:true},attempts:[],provider:'openai',model:'gpt-x',way:'api',elapsed_ms:1500,created_at_ms:1000,finished_at_ms:2500,escalation:'none'};
test('Internal is off by default: sessions show and no internal runs are requested',async()=>{
 handlers();let runRequests=0;server.use(http.get('/api/internal-work/runs',()=>{runRequests++;return HttpResponse.json({runs:[internalRun],next_cursor:null});}));
 const router=createMemoryRouter([{path:'/agents/history',Component}],{initialEntries:['/agents/history']});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<App router={router} queryClient={client}/>);
 try{const list=await screen.findByRole('list',{name:'Session history'});await waitFor(()=>expect(within(list).getByText(/anthropic · fixture/)).toBeVisible());expect(screen.getByLabelText('Internal')).not.toBeChecked();expect(runRequests).toBe(0);}finally{router.dispose();client.clear();}
});
test('?internal=1 opens History with Internal on, as an internal work attention item links it',async()=>{
 handlers();let runRequests=0;server.use(http.get('/api/internal-work/runs',()=>{runRequests++;return HttpResponse.json({runs:[internalRun],next_cursor:null});}));
 const router=createMemoryRouter([{path:'/agents/history',Component}],{initialEntries:['/agents/history?internal=1']});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<App router={router} queryClient={client}/>);
 try{const list=await screen.findByRole('list',{name:'Internal work'});expect(await within(list).findByText('playbook call')).toBeVisible();expect(screen.getByLabelText('Internal')).toBeChecked();expect(runRequests).toBe(1);}finally{router.dispose();client.clear();}
});
test('turning Internal on lists internal runs instead of sessions',async()=>{
 handlers();const search:string[]=[];server.use(http.get('/api/internal-work/runs',({request})=>{search.push(new URL(request.url).search);return HttpResponse.json({runs:[internalRun],next_cursor:null});}));
 const router=createMemoryRouter([{path:'/agents/history',Component}],{initialEntries:['/agents/history']});const client=new QueryClient({defaultOptions:{queries:{retry:false}}});render(<App router={router} queryClient={client}/>);const user=userEvent.setup();
 try{await screen.findByText(/anthropic · fixture/);await user.click(screen.getByLabelText('Internal'));
 const list=await screen.findByRole('list',{name:'Internal work'});expect(within(list).getByText('playbook call')).toBeVisible();expect(within(list).getByText(/task T-7 · answered/)).toBeVisible();expect(within(list).getByText(/openai · gpt-x · 1\.5 s/)).toBeVisible();
 expect(screen.queryByText(/anthropic · fixture/)).not.toBeInTheDocument();expect(search).toEqual(['?limit=50']);
 await user.click(screen.getByLabelText('Internal'));expect(await screen.findByText(/anthropic · fixture/)).toBeVisible();expect(screen.queryByRole('list',{name:'Internal work'})).not.toBeInTheDocument();}finally{router.dispose();client.clear();}
});
