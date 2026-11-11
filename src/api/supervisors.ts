import {apiGet,apiSend} from './client';
import {ContractError,isRecord} from './adapters/contract';
import {supervisorId} from './adapters/supervisor';
import type {IntelligenceSelection,LaunchProfile} from '../features/agents/swarm/manualAgents';
export type SupervisorControl={id:string;actor_id:string;project_id:string|null;label:string;enabled:boolean;revision:number;profile:LaunchProfile|null;phase:'idle'|'working'|'waiting'|'stopped'|'stopping'|'failed'|'uncertain'|'unavailable';stage:string;observed_at_ms:number|null;generation:number|null;session_id:string|null;last_error:string|null};
export type SupervisorFleet={supervisors:SupervisorControl[];profiles:LaunchProfile[];server_time_ms:number};
export type SupervisorIntent={operation_id:string;expected_revision:number;enabled:boolean;intelligence_profile?:IntelligenceSelection};
export function adaptSupervisors(v:unknown):SupervisorFleet{
 const fail=()=>{throw new ContractError('Invalid supervisor controls');};
 if(!isRecord(v)||!Array.isArray(v.supervisors)||v.supervisors.length>257||!Array.isArray(v.profiles)||v.profiles.length>2048||!Number.isSafeInteger(v.server_time_ms))return fail();
 if(!v.supervisors.every(s=>isRecord(s)&&supervisorId(s.id)&&supervisorId(s.actor_id)&&(s.project_id===null||supervisorId(s.project_id))&&typeof s.label==='string'&&s.label.length<=256&&typeof s.enabled==='boolean'&&Number.isSafeInteger(s.revision)&&Number(s.revision)>=0&&(s.profile===null||isRecord(s.profile))&&['idle','working','waiting','stopped','stopping','failed','uncertain','unavailable'].includes(String(s.phase))&&typeof s.stage==='string'&&s.stage.length<=256&&(s.observed_at_ms===null||Number.isSafeInteger(s.observed_at_ms))&&(s.last_error===null||typeof s.last_error==='string')))return fail();
 if(!v.profiles.every(p=>isRecord(p)&&typeof p.profile_id==='string'&&Number.isSafeInteger(p.profile_version)&&Number(p.profile_version)>0&&typeof p.candidate_id==='string'&&typeof p.name==='string'&&p.provider==='openai'&&p.harness==='codex'&&typeof p.model==='string'&&typeof p.reasoning==='string'))return fail();
 return v as SupervisorFleet;
}
export async function readSupervisors(signal?:AbortSignal){return adaptSupervisors(await apiGet('/api/supervisors',signal));}
function receipt(v:unknown,id:string,intent:SupervisorIntent){if(!isRecord(v)||v.operation_id!==intent.operation_id||v.conversation_id!==id||v.revision!==intent.expected_revision+1||v.enabled!==intent.enabled)throw new ContractError('Invalid supervisor control receipt');return v;}
export async function setSupervisor(id:string,intent:SupervisorIntent){return receipt(await apiSend('POST',`/api/supervisors/${id}/control`,intent,AbortSignal.timeout(8000)),id,intent);}
export async function inspectSupervisorControl(id:string,intent:SupervisorIntent){return receipt(await apiGet(`/api/supervisors/${id}/operations/${intent.operation_id}`,AbortSignal.timeout(8000)),id,intent);}
