import {describe,it,expect,vi} from 'vitest';
import {apiGet,apiSend} from './client';
import {connectManualTerminal} from './manualTerminalClient';
import type {TerminalState} from './interactiveTerminalClient';
vi.mock('./client',()=>({apiGet:vi.fn(),apiSend:vi.fn()}));
const id='10000000-0000-4000-8000-000000000001';
function setup({lostInput=false,lostRead=false,unknown=false,controlLost=false}={}){
 const posts:{path:string;body:unknown}[]=[];let failed=false;
 vi.mocked(apiSend).mockImplementation(async(_method,path,body)=>{posts.push({path,body});if(path.endsWith('/connect'))return {generation:1} as never;if(lostInput)throw Error('response lost');return {disposition:'queued'} as never;});
 vi.mocked(apiGet).mockImplementation(async path=>{if(path.includes('/receipts/'))return {disposition:unknown?'unknown':'applied'} as never;if(lostRead&&!failed){failed=true;throw Error('transient disconnect');}return {session:{status:'running',worker_seen_at_ms:Date.now()},server_time_ms:Date.now(),sequence:1,generation:controlLost?2:1,snapshot:'real\nscreen',controlling:!controlLost} as never;});
 const states:TerminalState[]=[],write=vi.fn(async(_bytes:Uint8Array)=>{});const c=connectManualTerminal({terminalId:id,allowControl:true,read:vi.fn(),write,reset:vi.fn(),state:s=>states.push(s)});return {c,posts,states,write};
}
describe('persistent manual terminal',()=>{
 it('automatically connects for typing and reconnects to the same session',async()=>{
  const m=setup({lostRead:true});try{await vi.waitFor(()=>expect(m.states.at(-1)?.controlling).toBe(true));const connects=m.posts.filter(p=>p.path.endsWith('/connect'));expect(connects).toHaveLength(2);expect(connects[1]?.body).toEqual({...connects[0]?.body as object,expected_generation:1});expect(m.write).toHaveBeenCalled();expect(m.posts.some(p=>p.path.endsWith('/stop'))).toBe(false);}finally{m.c.close();}
 });
 it('batches pending keys in order and renders tmux lines from column one',async()=>{
  const m=setup();try{await vi.waitFor(()=>expect(m.states.at(-1)?.controlling).toBe(true));expect(new TextDecoder().decode(m.write.mock.calls[0]?.[0])).toContain('real\r\nscreen');m.c.sendInput(new Uint8Array([65]));m.c.sendInput(new Uint8Array([66]));m.c.sendInput(new Uint8Array([67]));m.c.sendInput(new Uint8Array([68]));m.c.sendInput(new Uint8Array([13]));await vi.waitFor(()=>expect(m.posts.filter(p=>p.path.endsWith('/input'))).toHaveLength(3));expect(m.posts.filter(p=>p.path.endsWith('/input')).map(p=>(p.body as {bytes:number[]}).bytes)).toEqual([[65],[66,67,68],[13]]);}finally{m.c.close();}
 });
 it('pauses after another client takes control instead of automatically taking it back',async()=>{
  const m=setup({controlLost:true});try{await vi.waitFor(()=>expect(m.states.at(-1)?.paused).toBe(true));m.c.sendInput(new Uint8Array([65]));expect(m.posts.filter(p=>p.path.endsWith('/input'))).toHaveLength(0);}finally{m.c.close();}
 });
 it('looks up a receipt after a lost input response without replaying keyboard bytes',async()=>{
  const m=setup({lostInput:true});try{await vi.waitFor(()=>expect(m.states.at(-1)?.controlling).toBe(true));m.c.sendInput(new Uint8Array([65,13]));await vi.waitFor(()=>expect(m.posts.filter(p=>p.path.endsWith('/input'))).toHaveLength(1));await new Promise(r=>setTimeout(r,50));expect(m.states.at(-1)?.paused).toBe(false);expect(m.posts.filter(p=>p.path.endsWith('/input'))).toHaveLength(1);}finally{m.c.close();}
 });
 it('freezes uncertain input instead of replaying it',async()=>{
  const m=setup({unknown:true});try{await vi.waitFor(()=>expect(m.states.at(-1)?.controlling).toBe(true));m.c.sendInput(new Uint8Array([65]));await vi.waitFor(()=>expect(m.states.at(-1)?.paused).toBe(true));m.c.sendInput(new Uint8Array([66]));expect(m.posts.filter(p=>p.path.endsWith('/input'))).toHaveLength(1);}finally{m.c.close();}
 });
});
