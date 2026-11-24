import {apiGet,apiSend} from './client';
import {ContractError, boundedList, isRecord, nullable, optional} from './adapters/contract';
import {supervisorId} from './adapters/supervisor';
import {selectionOf,validLaunchProfile,type IntelligenceSelection,type LaunchProfile} from '../features/agents/swarm/manualAgents';
/** A stored choice: a level and candidate, with what the candidate said when it was saved. A choice carried from before levels may lack fields. */
export type StoredProfile=Partial<LaunchProfile>;
/** `unavailable_reason` (aq-supervisor-control `list`): why an enabled supervisor is not running on its stored choice, e.g. "its level `standard-medium` no longer lists gpt-6.1-sol on codex; choose a level". Absent when the choice resolves. */
export type SupervisorControl={id:string;actor_id:string;project_id:string|null;label:string;enabled:boolean;revision:number;profile:StoredProfile|null;unavailable_reason?:string;phase:'idle'|'working'|'waiting'|'stopped'|'stopping'|'failed'|'uncertain'|'unavailable';stage:string;observed_at_ms:number|null;generation:number|null;session_id:string|null;last_error:string|null};
export type SupervisorFleet={supervisors:SupervisorControl[];profiles:LaunchProfile[];server_time_ms:number};
export type SupervisorIntent={operation_id:string;expected_revision:number;enabled:boolean;intelligence_profile?:IntelligenceSelection};
const phases = new Set(['idle', 'working', 'waiting', 'stopped', 'stopping', 'failed', 'uncertain', 'unavailable']);
const boundedText = (value: unknown, limit: number) => typeof value === 'string' && value.length <= limit;

function validControl(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { id, actor_id, project_id } = value;
  return supervisorId(id) && supervisorId(actor_id) && nullable(project_id, supervisorId)
    && validSettings(value) && validObservation(value);
}

function validSettings(value: Record<string, unknown>): boolean {
  return boundedText(value.label, 256) && typeof value.enabled === 'boolean'
    && Number.isSafeInteger(value.revision) && Number(value.revision) >= 0
    && nullable(value.profile, isRecord);
}

function validObservation(value: Record<string, unknown>): boolean {
  return phases.has(String(value.phase)) && boundedText(value.stage, 256)
    && nullable(value.observed_at_ms, Number.isSafeInteger)
    && nullable(value.last_error, error => typeof error === 'string')
    && optional(value.unavailable_reason, reason => boundedText(reason, 1024));
}

export function adaptSupervisors(value: unknown): SupervisorFleet {
  if (isRecord(value) && Number.isSafeInteger(value.server_time_ms)) {
    const controls = boundedList(value.supervisors, 257, validControl);
    const profiles = boundedList(value.profiles, 2048, p => validLaunchProfile(p) && (p.harness === 'codex' || p.harness === 'claude'));
    if (controls && profiles) return value as SupervisorFleet;
  }
  throw new ContractError('Invalid supervisor controls');
}
export async function readSupervisors(signal?:AbortSignal){return adaptSupervisors(await apiGet('/api/supervisors',signal));}
function receipt(value: unknown, id: string, intent: SupervisorIntent) {
  if (isRecord(value)) {
    const matchesOperation = value.operation_id === intent.operation_id && value.conversation_id === id;
    const matchesChange = value.revision === intent.expected_revision + 1 && value.enabled === intent.enabled;
    if (matchesOperation && matchesChange) return value;
  }
  throw new ContractError('Invalid supervisor control receipt');
}
/** The control body the server accepts and nothing else (it refuses unknown fields, such as the `profile_version` of a draft kept from before levels). */
export const controlBody=(i:SupervisorIntent):SupervisorIntent=>({operation_id:i.operation_id,expected_revision:i.expected_revision,enabled:i.enabled,...(i.intelligence_profile?{intelligence_profile:selectionOf(i.intelligence_profile)}:{})});
export async function setSupervisor(id:string,intent:SupervisorIntent){return receipt(await apiSend('POST',`/api/supervisors/${id}/control`,controlBody(intent),AbortSignal.timeout(8000)),id,intent);}
export async function inspectSupervisorControl(id:string,intent:SupervisorIntent){return receipt(await apiGet(`/api/supervisors/${id}/operations/${intent.operation_id}`,AbortSignal.timeout(8000)),id,intent);}
