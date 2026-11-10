/** A disposable raw tmux attachment. Input is never queued or replayed across connections. */
import {apiSend} from './client';
import {isRecord} from './adapters/contract';
import type {connectInteractiveTerminal,TerminalState} from './interactiveTerminalClient';
type Options=Parameters<typeof connectInteractiveTerminal>[0];
const OUTPUT_BOUND=1024*1024,INPUT_BOUND=65536;
export function connectManualTerminal(options:Options){
 const abort=new AbortController(),client=crypto.randomUUID(),path=`/api/manual-agents/${options.terminalId}/terminal`;
 let socket:WebSocket|null=null,closed=false,connected=false,paused=options.initiallyPaused??false,generation=0,columns=80,rows=24,pending=0,observed:number|null=null,clock:{serverMs:number;at:number}|undefined;
 let writing=Promise.resolve(),failure:string|null=null,didConnect=false,tries=0,retry:ReturnType<typeof setTimeout>|undefined;
 const emit=(message:string)=>{const state:TerminalState={message,connected,controlling:connected&&!paused,canControl:connected,paused,outputObservedAtMs:observed,clock};options.state(state);};
 const freeze=(message:string)=>{if(closed)return;failure??=message;paused=true;connected=false;socket?.close();emit(failure);};
 async function connect(){
  if(paused){emit('Reconnect to inspect the same agent before typing');return;}
  try{
   const v=await apiSend<unknown>('POST',`${path}/connect`,{client_id:client},AbortSignal.any([abort.signal,AbortSignal.timeout(5000)]));
   if(closed)return;if(!isRecord(v)||!Number.isSafeInteger(v.generation))throw Error('Invalid terminal connection');generation=Number(v.generation);
   openSocket();
  }catch{if(!closed)freeze('Live terminal is connecting — reconnect to the same agent');}
 }
 function openSocket(){
   if(closed||paused)return;
   const url=new URL(`${path}/live`,window.location.href);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.search=new URLSearchParams({client_id:client,generation:String(generation),columns:String(columns),rows:String(rows)}).toString();
   const ws=new WebSocket(url);socket=ws;ws.binaryType='arraybuffer';
   ws.onmessage=event=>{
    if(closed||socket!==ws)return;
    if(typeof event.data==='string'){
     let value:unknown;try{value=JSON.parse(event.data);}catch{freeze('Invalid terminal response — reconnect');return;}
     if(!isRecord(value)||value.kind!=='ready'||!Number.isSafeInteger(value.server_time_ms)){freeze('Invalid terminal response — reconnect');return;}
     clock={serverMs:Number(value.server_time_ms),at:performance.now()};options.reset();didConnect=true;connected=true;paused=false;emit('Connected — ready for typing');
     ws.send(JSON.stringify({kind:'resize',columns,rows}));return;
    }
    if(!(event.data instanceof ArrayBuffer)||event.data.byteLength>16384){freeze('Terminal output exceeded its bound — reconnect');return;}
    const bytes=new Uint8Array(event.data);pending+=bytes.length;if(pending>OUTPUT_BOUND){freeze('Terminal display fell behind — reconnect');return;}
    writing=writing.then(async()=>{try{if(!closed&&!paused){await options.write(bytes);observed=clock?clock.serverMs+performance.now()-clock.at:Date.now();emit('Connected — ready for typing');}}finally{pending-=bytes.length;}}).catch(()=>freeze('Terminal display interrupted — reconnect'));
   };
   ws.onerror=()=>{if(didConnect)freeze('Terminal connection interrupted — reconnect to the same agent');};
   ws.onclose=()=>{if(closed||socket!==ws)return;if(!didConnect&&!paused&&tries<5){emit('Connecting…');retry=setTimeout(openSocket,Math.min(2000,200*2**tries++));return;}freeze('Disconnected — reconnect to the same agent');};
 }
 void connect();
 return {
  async takeControl(){/* A fresh explicit reconnect constructs a new fenced attachment. */},
  async release(){paused=true;connected=false;socket?.close();},
  sendInput(bytes:Uint8Array){if(!connected||paused||closed||!bytes.length||socket?.readyState!==WebSocket.OPEN)return;if(socket.bufferedAmount+bytes.length>INPUT_BOUND){freeze('Terminal input connection fell behind — reconnect');return;}for(let n=0;n<bytes.length;n+=4096)socket.send(bytes.slice(n,n+4096));},
  resize(c:number,r:number){columns=Math.max(2,Math.min(500,c));rows=Math.max(1,Math.min(300,r));if(connected&&!paused&&socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({kind:'resize',columns,rows}));},
  close(){closed=true;if(retry)clearTimeout(retry);abort.abort();socket?.close();socket=null;connected=false;}
 };
}
