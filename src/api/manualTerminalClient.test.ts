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
async function setup(ready=true, fixed=false){vi.mocked(apiSend).mockClear();vi.stubGlobal('WebSocket',Socket);vi.mocked(apiSend).mockResolvedValue({generation:7});const states:TerminalState[]=[],write=vi.fn(async(_bytes:Uint8Array)=>{}),reset=vi.fn();const c=connectManualTerminal({terminalId:'10000000-0000-4000-8000-000000000001',allowControl:true,read:vi.fn(),write,reset,state:s=>states.push(s)}, fixed ? '/api/attempt-terminals/attempt/terminal' : undefined, fixed ? 'attempt' : 'manual');await vi.waitFor(()=>expect(Socket.instances).toHaveLength(1));const socket=Socket.instances[0]!;if(ready){socket.frame(JSON.stringify({kind:'ready',server_time_ms:Date.now(),columns:120,rows:40}));await vi.waitFor(()=>expect(states.at(-1)?.connected).toBe(true));}return{c,socket,states,write,reset};}
describe('raw manual terminal stream',()=>{
 it('waits for a newly starting worker relay without retaking control or buffering keys',async()=>{const m=await setup(false);try{m.c.sendInput(new Uint8Array([65]));m.socket.close();await vi.waitFor(()=>expect(Socket.instances).toHaveLength(2));const retry=Socket.instances[1]!;expect(new URL(retry.url).searchParams.get('generation')).toBe('7');expect(vi.mocked(apiSend)).toHaveBeenCalledTimes(1);retry.frame(JSON.stringify({kind:'ready',server_time_ms:Date.now()}));expect(m.states.at(-1)?.controlling).toBe(true);expect(retry.sent.filter(v=>v instanceof Uint8Array)).toHaveLength(0);}finally{m.c.close();}});

 it('sends consecutive keystrokes immediately without a worker receipt round trip',async()=>{const m=await setup();try{m.c.sendInput(new Uint8Array([65]));m.c.sendInput(new Uint8Array([66]));m.c.sendInput(new Uint8Array([13]));expect(m.socket.sent.filter(v=>v instanceof Uint8Array).map(v=>[...v as Uint8Array])).toEqual([[65],[66],[13]]);expect(vi.mocked(apiSend).mock.calls.every(c=>c[1].endsWith('/connect'))).toBe(true);}finally{m.c.close();}});
 it('preserves raw cursor positioning and resets only once per attach',async()=>{const m=await setup();try{m.socket.frame(new Uint8Array([27,91,51,59,54,72,65]).buffer);m.socket.frame(new Uint8Array([66]).buffer);await vi.waitFor(()=>expect(m.write).toHaveBeenCalledTimes(2));expect([...m.write.mock.calls[0]![0]]).toEqual([27,91,51,59,54,72,65]);expect(m.reset).toHaveBeenCalledTimes(1);}finally{m.c.close();}});
 it('uses the same session and confirmed generation for the stream and resize',async()=>{const m=await setup();try{const u=new URL(m.socket.url);expect(u.pathname).toContain('/manual-agents/10000000-0000-4000-8000-000000000001/terminal/live');expect(u.searchParams.get('generation')).toBe('7');m.c.resize(101,37);expect(JSON.parse(m.socket.sent.at(-1) as string)).toEqual({kind:'resize',columns:101,rows:37});expect(m.states.at(-1)?.controlling).toBe(true);}finally{m.c.close();}});
 it('pauses on connection loss and never replays buffered keyboard input',async()=>{const m=await setup();try{m.c.sendInput(new Uint8Array([65]));m.socket.close();m.c.sendInput(new Uint8Array([66]));expect(m.states.at(-1)?.paused).toBe(true);expect(m.states.at(-1)?.controlling).toBe(false);expect(Socket.instances).toHaveLength(1);expect(m.socket.sent.filter(v=>v instanceof Uint8Array)).toHaveLength(1);}finally{m.c.close();}});
 it('bounds a burst of output before the renderer can consume it',async()=>{const m=await setup();try{for(let n=0;n<65;n++)m.socket.frame(new Uint8Array(16384).buffer);expect(m.states.at(-1)?.paused).toBe(true);expect(m.socket.readyState).toBe(3);}finally{m.c.close();}});
 it('bounds input backlog and stops typing when the connection falls behind',async()=>{const m=await setup();try{m.socket.bufferedAmount=65536;m.c.sendInput(new Uint8Array([65]));expect(m.socket.readyState).toBe(3);expect(m.states.at(-1)?.paused).toBe(true);expect(m.socket.sent.filter(v=>v instanceof Uint8Array)).toHaveLength(0);}finally{m.c.close();}});
});

describe('queued attempt stream', () => {
  it('uses only the pane size and orders repaint after already received bytes', async () => {
    const m = await setup(true, true);
    try {
      expect(new URL(m.socket.url).searchParams.has('columns')).toBe(false);
      expect(m.states.at(-1)?.grid).toEqual({ columns: 120, rows: 40 });
      // The current controller may resize the pane; bounds follow the server's (columns 2..500, rows 1..300).
      m.c.resize(80, 8);
      m.c.resize(9999, 0);
      expect(m.socket.sent.map(v => JSON.parse(v as string))).toEqual([{ kind: 'resize', columns: 80, rows: 8 }, { kind: 'resize', columns: 500, rows: 1 }]);
      m.socket.sent.length = 0;
      m.socket.frame(Uint8Array.of(65).buffer);
      m.c.repaint(); m.c.repaint(); m.c.sendInput(Uint8Array.of(90));
      expect(m.socket.sent).toEqual([JSON.stringify({ kind: 'repaint' })]);
      m.socket.frame(JSON.stringify({ kind: 'ready', server_time_ms: Date.now(), columns: 120, rows: 40 }));
      m.socket.frame(Uint8Array.of(66).buffer);
      await vi.waitFor(() => expect(m.write).toHaveBeenCalledTimes(2));
      expect(m.write.mock.invocationCallOrder[0]!).toBeLessThan(m.reset.mock.invocationCallOrder[1]!);
      expect(m.reset.mock.invocationCallOrder[1]!).toBeLessThan(m.write.mock.invocationCallOrder[1]!);
    } finally { m.c.close(); }
  });

  it('uses a distinct Escape command and stops on a split sequence', async () => {
    const m = await setup(true, true);
    try {
      m.c.sendEscape();
      m.c.sendInput(Uint8Array.of(27, 91, 60, 52, 51));
      m.c.sendInput(Uint8Array.of(59, 51, 55, 77));
      expect(m.socket.sent).toEqual([JSON.stringify({ kind: 'escape' })]);
      expect(m.states.at(-1)?.paused).toBe(true);
    } finally { m.c.close(); }
  });
});

describe('attempt resize authority', () => {
  async function watcher() {
    vi.mocked(apiSend).mockClear(); vi.stubGlobal('WebSocket', Socket); vi.mocked(apiSend).mockResolvedValue({ generation: 7 });
    const states: TerminalState[] = [];
    const c = connectManualTerminal({ terminalId: '10000000-0000-4000-8000-000000000001', allowControl: true, read: vi.fn(), write: vi.fn(async () => {}), reset: vi.fn(), state: s => states.push(s) }, '/api/attempt-terminals/attempt/terminal', 'attempt-watch');
    await vi.waitFor(() => expect(Socket.instances).toHaveLength(1));
    const socket = Socket.instances[0]!; socket.frame(JSON.stringify({ kind: 'ready', server_time_ms: Date.now(), columns: 120, rows: 40 }));
    await vi.waitFor(() => expect(states.at(-1)?.connected).toBe(true));
    return { c, socket };
  }
  it('never sends a resize from a read-only watcher, which also never types', async () => {
    const m = await watcher();
    try { m.c.resize(100, 30); m.c.sendInput(Uint8Array.of(65)); expect(m.socket.sent).toEqual([]); expect(new URL(m.socket.url).searchParams.get('read_only')).toBe('true'); } finally { m.c.close(); }
  });
  it('sends nothing before ready, while repainting, or after a disconnect', async () => {
    const m = await setup(false, true);
    try {
      m.c.resize(100, 30); expect(m.socket.sent).toEqual([]);
      m.socket.frame(JSON.stringify({ kind: 'ready', server_time_ms: Date.now(), columns: 120, rows: 40 }));
      await vi.waitFor(() => expect(m.states.at(-1)?.connected).toBe(true));
      m.c.repaint(); m.socket.sent.length = 0; m.c.resize(100, 30); expect(m.socket.sent).toEqual([]);
      m.socket.close(); m.c.resize(90, 20); expect(m.socket.sent).toEqual([]);
    } finally { m.c.close(); }
  });
});
