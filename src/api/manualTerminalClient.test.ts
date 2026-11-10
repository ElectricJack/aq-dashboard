import {describe,it,expect,vi,afterEach} from 'vitest';
import {apiSend} from './client';
import {connectManualTerminal} from './manualTerminalClient';
import type {TerminalState} from './interactiveTerminalClient';
vi.mock('./client',()=>({apiSend:vi.fn()}));
class Socket {
 static OPEN=1;static instances:Socket[]=[];
 readyState=1;bufferedAmount=0;binaryType='';sent:(string|Uint8Array)[]=[];
 onmessage:((e:{data:unknown})=>void)|null=null;onclose:(()=>void)|null=null;onerror:(()=>void)|null=null;
 constructor(readonly url:string){Socket.instances.push(this);}
 send(value:string|Uint8Array){this.sent.push(value);}
 close(){if(this.readyState===3)return;this.readyState=3;this.onclose?.();}
 frame(data:unknown){this.onmessage?.({data});}
}
afterEach(()=>{vi.unstubAllGlobals();Socket.instances=[];});
async function setup(){vi.stubGlobal('WebSocket',Socket);vi.mocked(apiSend).mockResolvedValue({generation:7});const states:TerminalState[]=[],write=vi.fn(async(_bytes:Uint8Array)=>{}),reset=vi.fn();const c=connectManualTerminal({terminalId:'10000000-0000-4000-8000-000000000001',allowControl:true,read:vi.fn(),write,reset,state:s=>states.push(s)});await vi.waitFor(()=>expect(Socket.instances).toHaveLength(1));const socket=Socket.instances[0]!;socket.frame(JSON.stringify({kind:'ready',server_time_ms:Date.now()}));return{c,socket,states,write,reset};}
describe('raw manual terminal stream',()=>{
 it('sends consecutive keystrokes immediately without a worker receipt round trip',async()=>{const m=await setup();try{m.c.sendInput(new Uint8Array([65]));m.c.sendInput(new Uint8Array([66]));m.c.sendInput(new Uint8Array([13]));expect(m.socket.sent.filter(v=>v instanceof Uint8Array).map(v=>[...v as Uint8Array])).toEqual([[65],[66],[13]]);expect(vi.mocked(apiSend).mock.calls.every(c=>c[1].endsWith('/connect'))).toBe(true);}finally{m.c.close();}});
 it('preserves raw cursor positioning and resets only once per attach',async()=>{const m=await setup();try{m.socket.frame(new Uint8Array([27,91,51,59,54,72,65]).buffer);m.socket.frame(new Uint8Array([66]).buffer);await vi.waitFor(()=>expect(m.write).toHaveBeenCalledTimes(2));expect([...m.write.mock.calls[0]![0]]).toEqual([27,91,51,59,54,72,65]);expect(m.reset).toHaveBeenCalledTimes(1);}finally{m.c.close();}});
 it('uses the same session and confirmed generation for the stream and resize',async()=>{const m=await setup();try{const u=new URL(m.socket.url);expect(u.pathname).toContain('/manual-agents/10000000-0000-4000-8000-000000000001/terminal/live');expect(u.searchParams.get('generation')).toBe('7');m.c.resize(101,37);expect(JSON.parse(m.socket.sent.at(-1) as string)).toEqual({kind:'resize',columns:101,rows:37});expect(m.states.at(-1)?.controlling).toBe(true);}finally{m.c.close();}});
 it('pauses on connection loss and never replays buffered keyboard input',async()=>{const m=await setup();try{m.c.sendInput(new Uint8Array([65]));m.socket.close();m.c.sendInput(new Uint8Array([66]));expect(m.states.at(-1)?.paused).toBe(true);expect(m.states.at(-1)?.controlling).toBe(false);expect(Socket.instances).toHaveLength(1);expect(m.socket.sent.filter(v=>v instanceof Uint8Array)).toHaveLength(1);}finally{m.c.close();}});
 it('bounds a burst of output before the renderer can consume it',async()=>{const m=await setup();try{for(let n=0;n<65;n++)m.socket.frame(new Uint8Array(16384).buffer);expect(m.states.at(-1)?.paused).toBe(true);expect(m.socket.readyState).toBe(3);}finally{m.c.close();}});
 it('bounds input backlog and stops typing when the connection falls behind',async()=>{const m=await setup();try{m.socket.bufferedAmount=65536;m.c.sendInput(new Uint8Array([65]));expect(m.socket.readyState).toBe(3);expect(m.states.at(-1)?.paused).toBe(true);expect(m.socket.sent.filter(v=>v instanceof Uint8Array)).toHaveLength(0);}finally{m.c.close();}});
});
