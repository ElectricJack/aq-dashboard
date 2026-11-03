import { ContractError, isRecord } from "./contract";
import { adaptNodeStorage, type NodeStorage } from "./nodeStorage";
export type WorkerSnapshot = {id:string;name:string;status:string;last_seen_at:string|null;storage:NodeStorage};
export function adaptOverviewWorkers(raw:unknown): WorkerSnapshot[] {
 if(!Array.isArray(raw)||raw.length>1024)throw new ContractError("Invalid worker snapshot");
 const ids=new Set<string>();
 return raw.map(row=>{
  if(!isRecord(row)||typeof row.id!=="string"||row.id.length>128||typeof row.name!=="string"||!row.name.trim()||row.name.length>512||typeof row.status!=="string"||row.status.length>64||!(row.last_seen_at===null||(typeof row.last_seen_at==="string"&&Number.isFinite(Date.parse(row.last_seen_at))))||ids.has(row.id))throw new ContractError("Invalid worker snapshot");
  ids.add(row.id);return {id:row.id,name:row.name,status:row.status,last_seen_at:row.last_seen_at,storage:adaptNodeStorage(row)};
 });
}
