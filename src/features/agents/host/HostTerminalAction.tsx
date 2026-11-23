import {useRef,useState} from 'react';
import {useNavigate} from 'react-router';
import {apiSend,ApiError} from '../../../api/client';
import {useSession} from '../../../app/session';
import {ActionButton} from '../../../components/layout/Workspace';
export function HostTerminalAction({nodeId,onOpened}:{nodeId:string;onOpened?:()=>void}) {
 const {bootstrap}=useSession();const navigate=useNavigate();
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 const operation=useRef<string|null>(null),locked=useRef(false);
 async function open(){
  if(locked.current)return;locked.current=true;setBusy(true);setError(null);operation.current??=crypto.randomUUID();
  try{await apiSend('POST',`/api/worker-terminals/${encodeURIComponent(nodeId)}`,{operation_id:operation.current});operation.current=null;if(onOpened)onOpened();else void navigate(`/agents/worker/${encodeURIComponent(nodeId)}`);}
  catch (error) {
   const fallback = 'Host terminal is unavailable. Update this worker’s controls.';
   if (error instanceof ApiError) {
    const status = error.status ?? 0;
    if (status >= 400 && status < 500) operation.current = null;
    setError(error.serverMessage ?? fallback);
   } else {
    setError('Confirmation is pending. Retry to open the same shell.');
   }
  }
  finally{locked.current=false;setBusy(false);}
 }
 return <><ActionButton disabled={busy||!bootstrap.capability('swarm.worker.control').enabled} onClick={()=>void open()}>{busy?'Opening…':'Open terminal'}</ActionButton>{error&&<p role="status">{error}</p>}</>;
}
