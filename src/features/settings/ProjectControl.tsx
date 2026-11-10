import {useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useSession} from "../../app/session";
import {useDraft} from "../../app/useDraft";
import {apiGet, apiSend, ApiError} from "../../api/client";
import {isRecord} from "../../api/adapters/contract";
import type {ProjectBindingView} from "../../api/adapters/projectBindings";
import {ActionButton} from "../../components/layout/Workspace";
import styles from "./ProjectBindings.module.css";

type Intent={operation:string;revision:number;enabled:boolean;body:Record<string,unknown>};
function intent(v:unknown):v is Intent|null{return v===null||(isRecord(v)&&typeof v.operation==="string"&&typeof v.revision==="number"&&typeof v.enabled==="boolean"&&isRecord(v.body));}
export function ProjectControl({project:p,onChanged}:{project:ProjectBindingView;onChanged:()=>Promise<unknown>}){
  const {queryContext}=useSession();const client=useQueryClient();
  const [pending,setPending]=useDraft<Intent|null>(`project-control:${p.id}`,null,intent);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState<string|null>(null);
  const lock=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  const setup=p.workerPolicy==="missing"?"Worker setup is incomplete for this project.":p.workerPolicy==="disabled"?"Worker execution is disabled in the server setup.":p.workerPolicy==="unknown"?"Worker setup could not be confirmed. Refresh or update the server.":null;
  async function submit(saved:Intent){
    if(lock.current)return;lock.current=true;setBusy(true);setMessage(null);
    try{
      const path=`/api/projects/${p.id}${saved.enabled?"":"/disable"}`;
      const raw=await apiSend<unknown>("POST",path,saved.body,AbortSignal.timeout(8000));
      if(!isRecord(raw)||raw.operation_id!==saved.operation||!isRecord(raw.record)||!isRecord(raw.record.binding)||raw.record.binding.project_id!==p.id||raw.record.binding.enabled!==saved.enabled||raw.record.revision!==saved.revision+1)throw Error("Unconfirmed project operation");
      if(!alive.current)return;
      setPending(null);setMessage(saved.enabled?"Start request confirmed.":"Stop request confirmed.");
      await onChanged();
      await client.invalidateQueries({predicate:q=>q.queryKey.includes(queryContext.principalId)&&q.queryKey.some(k=>["worker-launch-projects","projects","overview","human-graph-list"].includes(String(k)))});
    }catch(e){if(alive.current){
      if(e instanceof ApiError&&[400,401,403,404,409,413,422].includes(e.status??0)){
        setPending(null);setMessage(e.serverMessage??"AQ refused the change. Refresh the project and try again.");
        if(e.status===409)await onChanged();
      }else setMessage("The outcome is uncertain. Retry the same change or check the current state before making another change.");
    }}finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  function change(enabled:boolean){
    if(pending||lock.current||enabled&&setup)return;
    const operation=crypto.randomUUID();
    const body={operation_id:operation,expected_revision:p.revision,...(enabled?{binding:{...p.binding,enabled:true}}:{})};
    const saved={operation,revision:p.revision,enabled,body};setPending(saved);void submit(saved);
  }
  async function check(){
    if(lock.current)return;lock.current=true;setBusy(true);
    try{const raw=await apiGet<unknown>(`/api/projects/${p.id}`,AbortSignal.timeout(8000));
      if(!isRecord(raw)||!isRecord(raw.binding)||raw.binding.project_id!==p.id||typeof raw.binding.enabled!=="boolean"||typeof raw.revision!=="number")throw Error("Invalid project state");
      if(alive.current){setMessage(`Current saved state: ${raw.binding.enabled?"started":"stopped"}. Retry the same change to confirm its receipt.`);await onChanged();}
    }catch{if(alive.current)setMessage("Could not check the project. Keep this operation and retry when connected.");}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <div className={styles.control}>
    <div className={styles.controls}>
      {pending?<><ActionButton disabled={busy} onClick={()=>void submit(pending)}>Retry same {pending.enabled?"start":"stop"}</ActionButton><ActionButton disabled={busy} onClick={()=>void check()}>Check current state</ActionButton></>:p.enabled?<ActionButton disabled={busy} onClick={()=>change(false)}>Stop project</ActionButton>:<ActionButton className={styles.start} disabled={busy||!!setup} title={setup??undefined} onClick={()=>change(true)}>Start project</ActionButton>}
      <a className={styles.openWork} href={`/work?scope=project%3A${p.id}`}>Open work</a>
    </div>
    {setup&&<p className={styles.meta}>{setup}</p>}
    {message&&<p role="status">{message}</p>}
    {busy&&<p role="status">Saving project state…</p>}
  </div>;
}
