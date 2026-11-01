import {ApiError} from "./client";
import {ContractError,isRecord} from "./adapters/contract";
/** Specialized owner status replies retain typed409/422 bodies and exact POST bytes. */
export async function taskOperationRequest(method:"GET"|"POST",path:string,bytes?:string,signal?:AbortSignal):Promise<unknown>{
 const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener("abort",abort,{once:true});if(signal?.aborted)controller.abort();
 const timer=setTimeout(abort,6000);
 try{
  const response=await fetch(path,{method,credentials:"same-origin",signal:controller.signal,headers:{Accept:"application/json",...(method==="POST"?{"Content-Type":"application/json","X-AQ-Request":"1"}:{})},...(bytes!==undefined?{body:bytes}:{})});
  if([401,403].includes(response.status))throw new ApiError("http",`AQ responded ${response.status}`,{status:response.status,effectUnknown:method==="POST"});
  if(!response.headers.get("content-type")?.includes("application/json")||!response.body)throw new ContractError("Task operation response is not JSON");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>65536){await reader.cancel();throw new ContractError("Task operation response exceeds its bound");}chunks.push(value);}}finally{reader.releaseLock();}
  const data=new Uint8Array(length);let offset=0;for(const part of chunks){data.set(part,offset);offset+=part.byteLength;}
  let raw:unknown;try{raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));}catch{throw new ContractError("Task operation response is malformed");}
  if([200,202,409,422].includes(response.status)&&isRecord(raw)&&raw.contract==="human-task-create-1")return raw;
  throw new ApiError("http",`AQ responded ${response.status}`,{status:response.status,effectUnknown:method==="POST"});
 }catch(error){if(error instanceof ApiError||error instanceof ContractError)throw error;throw new ApiError("transport","Task operation response was not received",{effectUnknown:method==="POST"});}
 finally{clearTimeout(timer);signal?.removeEventListener("abort",abort);}
}
