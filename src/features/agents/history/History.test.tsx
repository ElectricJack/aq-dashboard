import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { createMemoryRouter } from 'react-router';
import { App } from '../../../app/App';
import { handlersFor } from '../../../mocks/handlers';
import { Component } from './index';

// Values and shape are based on the server's manual-transcript-wire.json fixture.
const id='00000000-0000-4000-8000-000000000001';
const session={id,node_id:'00000000-0000-4000-8000-000000000002',project_id:'00000000-0000-4000-8000-000000000003',spec:{provider:'anthropic',model:'fixture'},status:'stopped',stage:'Ended',desired_running:false,created_at_ms:1000,updated_at_ms:2000,worker_seen_at_ms:2000,archive:{state:'complete',coverage:'complete',reason:null,first_sequence:1,last_sequence:40,bytes:100,updated_at_ms:2000}};
const chunks=Array.from({length:40},(_,i)=>({sequence:i+1,text:i===31?'éhel':i===32?'lo🐈':i===37?'hello':`line ${i+1}\n`}));
const byteLength=(s:string)=>new TextEncoder().encode(s).length;
const firstOffset=chunks.slice(0,31).reduce((n,c)=>n+byteLength(c.text),0)+byteLength('é');
const secondOffset=chunks.slice(0,37).reduce((n,c)=>n+byteLength(c.text),0);
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
function handlers(options:{failExport?:boolean; status?:()=>string}={}) {
 const requests: string[]=[];
 server.use(
  http.get('/api/manual-agents/history',()=>HttpResponse.json({sessions:[session],next_cursor:null,server_time_ms:2000})),
  http.get('/api/manual-agents/:id/transcript/search',({request})=>{const u=new URL(request.url);requests.push(u.search);const after=u.searchParams.get('after');return HttpResponse.json({matches:[after===null?{offset:firstOffset,length:5,sequence:32,excerpt:'éhello🐈'}:{offset:secondOffset,length:5,sequence:38,excerpt:'hello'}],next_after:after===null?firstOffset:secondOffset,has_more:after===null,through_sequence:40,server_time_ms:2000});}),
  http.get('/api/manual-agents/:id/transcript',({request})=>{const u=new URL(request.url);requests.push(u.search);const after=Number(u.searchParams.get('after')??0);if(options.failExport && after===32)return new HttpResponse(null,{status:503});const end=Math.min(after+32,40);return HttpResponse.json({session:{...session,archive:{...session.archive,state:options.status?.()??'complete'}},chunks:chunks.slice(after,end),next_after:end,has_more:end<40,through_sequence:40,server_time_ms:2000});}),
 );return requests;
}
test('find navigates unloaded cross-chunk UTF-8 matches and pages search by byte offset',async()=>{
 const requests=handlers();const view=setup();const user=userEvent.setup();
 try{const output=await screen.findByLabelText('Terminal transcript');await waitFor(()=>expect(output).toHaveTextContent('éhel'));expect(output).not.toHaveTextContent('éhello');
 await user.type(screen.getByLabelText('Find'),'hello');await user.click(screen.getByRole('button',{name:'Find'}));
 await waitFor(()=>expect(output.querySelector('mark')).toHaveTextContent('hello'));
 expect(output).toHaveTextContent('éhello🐈');expect(screen.getByText('Match 1+')).toBeVisible();
 expect(requests).toContain('?q=hello&through=40');expect(requests).toContain('?after=32&through=40&limit=32');
 await user.click(screen.getByRole('button',{name:'Next'}));await waitFor(()=>expect(screen.getByText('Match 2 of 2')).toBeVisible());expect(requests).toContain(`?q=hello&after=${firstOffset}&through=40`);
 await user.click(screen.getByRole('button',{name:'Previous'}));await waitFor(()=>expect(screen.getByText('Match 1 of 2')).toBeVisible());expect(output.querySelector('mark')).toHaveTextContent('hello');
 }finally{view.dispose();}
});
test('failed multi-page export does not create or claim a complete download',async()=>{
 handlers({failExport:true});const view=setup();const user=userEvent.setup();const create=vi.fn();vi.stubGlobal('URL',Object.assign(URL,{createObjectURL:create}));
 try{await screen.findByText('line 1', {exact:false});await user.click(screen.getByRole('button',{name:'Download retained output'}));expect(await screen.findByRole('status')).toHaveTextContent('Download failed; no file was saved.');expect(create).not.toHaveBeenCalled();expect(screen.queryByText('Download complete.')).not.toBeInTheDocument();}finally{view.dispose();vi.unstubAllGlobals();}
});
test('metadata refresh after finalizing preserves the current page and scroll position',async()=>{
 let state='finalizing';const requests=handlers({status:()=>state});const view=setup();const user=userEvent.setup();
 try{const output=await screen.findByLabelText('Terminal transcript');await waitFor(()=>expect(output).toHaveTextContent('éhel'));await user.click(screen.getByRole('button',{name:'Next output page'}));await waitFor(()=>expect(output).toHaveTextContent('line 40'));output.scrollTop=73;state='complete';
 await view.client.invalidateQueries({queryKey:['history-transcript']});await waitFor(()=>expect(screen.getByText('Saved transcript')).toBeVisible());expect(output).toHaveTextContent('line 40');expect(output).not.toHaveTextContent('line 1');expect(output.scrollTop).toBe(73);expect(requests).toContain('?after=32&through=40');
 }finally{view.dispose();}
});
test('loading earlier chunks preserves the reader position while retaining a bounded window',async()=>{
 const requests=handlers();const view=setup();const user=userEvent.setup();
 try{const output=await screen.findByLabelText('Terminal transcript');await waitFor(()=>expect(output).toHaveTextContent('éhel'));await user.click(screen.getByRole('button',{name:'Next output page'}));await waitFor(()=>expect(output).toHaveTextContent('line 40'));output.scrollTop=25;
 Object.defineProperty(output,'scrollHeight',{configurable:true,get:()=>output.textContent?.includes('éhel')?200:100});
 await user.click(screen.getByRole('button',{name:'Earlier output'}));await waitFor(()=>expect(output).toHaveTextContent('éhello🐈'));await waitFor(()=>expect(output.scrollTop).toBe(125));expect(output).toHaveTextContent('line 40');expect(requests).toContain('?after=0&through=40&limit=32');
 }finally{view.dispose();}
});
