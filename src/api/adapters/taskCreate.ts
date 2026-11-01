import {ContractError,isRecord} from "./contract";
import {validGraphId} from "./humanGraph";
export type TaskDraft={title:string;body:string;acceptance_criteria:string;task_state:"draft"|"active"};
export type TaskCreateRequest=TaskDraft&{operation_id:string;expected_project_revision:string;labels:string[]};
export type FrozenTaskCreate=Readonly<{project:string;actor:string;operationId:string;bytes:string;digest:string}>;
export type TaskOperation={contract:"human-task-create-1";operation_id:string;project_id:string;actor_id:string;task_id:string;request_digest:string;state:"pending"|"unknown"|"confirmed"|"conflict"|"rejected";effect:"not_dispatched"|"possible"|"confirmed"|"not_applied";receipt:null|{workspace_id:string;change_set_id:string;task_id:string;version:string;content_revision:string};recovery:{allowed:boolean;reason:string|null};created_at_ms:number};
function check(v:unknown):asserts v{if(!v)throw new ContractError("Invalid task operation");}
function revision(v:unknown):v is string{return typeof v==="string"&&/^[1-9][0-9]{0,18}$/.test(v)&&BigInt(v)<=9223372036854775807n;}
export function validateTaskDraft(draft:TaskDraft):string|null{
 if(!draft.title.trim()||[...draft.title.trim()].length>512)return "Enter a title of at most 512 characters.";
 if(/\p{Cc}/u.test(draft.title.trim()))return "Title cannot contain control characters.";
 if(new TextEncoder().encode(draft.body).length>32768)return "Description exceeds 32 KiB.";
 if(new TextEncoder().encode(draft.acceptance_criteria).length>8192)return "Acceptance criteria exceed 8 KiB.";
 return null;
}
export async function freezeTaskCreate(project:string,actor:string,projectRevision:string,draft:TaskDraft):Promise<FrozenTaskCreate>{
 check(validGraphId(project)&&validGraphId(actor)&&revision(projectRevision)&&!validateTaskDraft(draft));
 const operationId=crypto.randomUUID();
 const request:TaskCreateRequest={operation_id:operationId,expected_project_revision:projectRevision,title:draft.title.trim(),body:draft.body,acceptance_criteria:draft.acceptance_criteria,labels:[],task_state:draft.task_state};
 const bytes=JSON.stringify(request),encoded=new TextEncoder().encode(bytes);check(encoded.length<=65536);
 const hash=await crypto.subtle.digest("SHA-256",encoded);
 const digest="sha256:"+Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,"0")).join("");
 return Object.freeze({project,actor,operationId,bytes,digest});
}
export function adaptTaskOperation(raw:unknown,expected:{operationId:string;project:string;actor:string;digest?:string}):TaskOperation{
 check(isRecord(raw)&&raw.contract==="human-task-create-1"&&raw.operation_id===expected.operationId&&raw.project_id===expected.project&&raw.actor_id===expected.actor&&raw.task_id===expected.operationId);
 check(validGraphId(raw.operation_id)&&validGraphId(raw.project_id)&&validGraphId(raw.actor_id)&&typeof raw.request_digest==="string"&&/^sha256:[0-9a-f]{64}$/.test(raw.request_digest)&&(!expected.digest||raw.request_digest===expected.digest));
 check(["pending","unknown","confirmed","conflict","rejected"].includes(String(raw.state))&&["not_dispatched","possible","confirmed","not_applied"].includes(String(raw.effect))&&isRecord(raw.recovery)&&typeof raw.recovery.allowed==="boolean"&&(raw.recovery.reason===null||(typeof raw.recovery.reason==="string"&&raw.recovery.reason.length<=1024)));
 check(typeof raw.created_at_ms==="number"&&Number.isSafeInteger(raw.created_at_ms)&&raw.created_at_ms>0&&raw.created_at_ms<=8640000000000000);
 if(raw.state==="confirmed"){
  check(raw.effect==="confirmed"&&isRecord(raw.receipt)&&validGraphId(raw.receipt.workspace_id)&&validGraphId(raw.receipt.change_set_id)&&raw.receipt.task_id===expected.operationId&&revision(raw.receipt.version)&&revision(raw.receipt.content_revision)&&raw.recovery.allowed===false);
 }else{
  check(raw.receipt===null&&raw.effect!=="confirmed");
  if(raw.state==="pending")check(raw.effect==="not_dispatched");
  if(raw.state==="unknown")check(raw.effect==="possible");
  if(raw.state==="conflict")check(["not_dispatched","not_applied"].includes(String(raw.effect))&&raw.recovery.allowed===false);
  if(raw.state==="rejected")check(raw.effect==="not_applied"&&raw.recovery.allowed===false);
 }
 return raw as unknown as TaskOperation;
}
