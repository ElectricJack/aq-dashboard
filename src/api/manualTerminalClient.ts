/** Same-session tmux connection. Keyboard bytes are sent once, then only receipts are read. */
import {apiGet,apiSend} from './client';
import {isRecord} from './adapters/contract';
import type {connectInteractiveTerminal,TerminalState} from './interactiveTerminalClient';
type Options=Parameters<typeof connectInteractiveTerminal>[0];
export function connectManualTerminal(options:Options){
 const abort=new AbortController(),client=crypto.randomUUID(),path=`/api/manual-agents/${options.terminalId}/terminal`;
 let connected=false,controlling=false,paused=options.initiallyPaused??false,generation=0,sequence=0,renewAt=0,busy=false;
 const queue:({bytes:number[]}|{columns:number;rows:number})[]=[];
 const emit=(message:string)=>{const state:TerminalState={message,connected,controlling:controlling&&!paused,canControl:connected,paused};options.state(state);};
 const sleep=(ms:number)=>new Promise<void>(resolve=>{const end=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',end);resolve();};const timer=setTimeout(end,ms);abort.signal.addEventListener('abort',end,{once:true});});
 const signal=()=>AbortSignal.any([abort.signal,AbortSignal.timeout(5000)]);
 async function control(){const v=await apiSend<unknown>('POST',`${path}/connect`,{client_id:client},signal());if(!isRecord(v)||!Number.isSafeInteger(v.generation))throw Error('Invalid terminal connection');generation=Number(v.generation);renewAt=performance.now()+5000;}
 async function run(){let failures=0;while(!abort.signal.aborted){try{
  if(performance.now()>=renewAt)await control();
  const v=await apiGet<unknown>(`${path}?client_id=${client}&after=${sequence}`,signal());
  if(!isRecord(v)||!Number.isSafeInteger(v.sequence)||!isRecord(v.session))throw Error('Invalid terminal snapshot');
  if(typeof v.snapshot==='string'&&v.snapshot.length<=131072){sequence=Number(v.sequence);options.reset();await options.write(new TextEncoder().encode('\x1b[H\x1b[2J'+v.snapshot));}
  connected=v.session.status==='running'&&Number(v.server_time_ms)-Number(v.session.worker_seen_at_ms)<15000;
  controlling=connected&&v.controlling===true;failures=0;emit(paused?'Input delivery uncertain — reconnect to inspect the current screen':controlling?'Connected — ready for typing':connected?'Connecting for input…':String(v.session.stage??'Agent stopped'));
  if(['stopped','failed'].includes(String(v.session.status)))return;
  if(controlling&&!paused)void flush();await sleep(300);
 }catch{if(abort.signal.aborted)return;connected=false;controlling=false;queue.length=0;renewAt=0;emit('Reconnecting to the same agent…');await sleep(Math.min(5000,300*2**Math.min(failures++,4)));}}
 }
 async function flush(){if(busy||!controlling||paused||abort.signal.aborted)return;busy=true;
  try{while(queue.length&&controlling&&!paused&&!abort.signal.aborted){const payload=queue.shift()!,operation=crypto.randomUUID();
   try{await apiSend('POST',`${path}/input`,{operation_id:operation,client_id:client,generation,...payload},signal());}catch{/* Receipt lookup, never keyboard replay. */}
   let applied=false;
   for(let n=0;n<30&&!abort.signal.aborted;n++){
    const r=await apiGet<unknown>(`${path}/receipts/${operation}`,signal());
    if(!isRecord(r))throw Error('Invalid input receipt');if(r.disposition==='applied'){applied=true;break;}if(['unknown','rejected'].includes(String(r.disposition)))break;await sleep(100);
   }
   if(!applied)throw Error('Input outcome is uncertain');
  }}catch{if(!abort.signal.aborted){paused=true;controlling=false;queue.length=0;emit('Input delivery uncertain — reconnect to inspect the current screen');}}
  finally{busy=false;}
 }
 void run();
 return {takeControl:control,async release(){controlling=false;queue.length=0;},sendInput(bytes:Uint8Array){if(!controlling||paused||!bytes.length)return;if(queue.reduce((n,v)=>n+('bytes'in v?v.bytes.length:0),0)+bytes.length>16384){paused=true;queue.length=0;emit('Input queue full — reconnect');return;}for(let at=0;at<bytes.length;at+=4096)queue.push({bytes:[...bytes.slice(at,at+4096)]});void flush();},resize(columns:number,rows:number){if(!controlling||paused)return;queue.push({columns:Math.max(2,Math.min(500,columns)),rows:Math.max(1,Math.min(300,rows))});void flush();},close(){abort.abort();queue.length=0;connected=false;controlling=false;}};
}
