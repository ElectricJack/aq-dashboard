import { apiGet } from './client';
import { ContractError, isRecord } from './adapters/contract';
import { validGraphId } from './adapters/humanGraph';
import type { ManualAgent } from '../features/agents/swarm/manualAgents';

export type HistorySession = Omit<ManualAgent, 'spec'> & {
  spec: Omit<ManualAgent['spec'], 'project_name' | 'repository_id'> & { project_name?: string; repository_id?: string };
  conversation_available?: boolean;
};
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableInteger = (v: unknown) => v === null || integer(v);
function session(v: unknown): v is HistorySession {
 if (!isRecord(v) || !isRecord(v.spec) || !validGraphId(v.id) || !validGraphId(v.node_id) || !validGraphId(v.project_id) || typeof v.spec.provider !== 'string' || typeof v.spec.model !== 'string' || !(v.spec.project_name === undefined || typeof v.spec.project_name === 'string') || !['pending','preparing','running','stopping','stopped','failed'].includes(String(v.status)) || typeof v.stage !== 'string' || typeof v.desired_running !== 'boolean' || !integer(v.created_at_ms) || !integer(v.updated_at_ms) || !nullableInteger(v.worker_seen_at_ms)) return false;
 return v.conversation_available === undefined || typeof v.conversation_available === 'boolean';
}
function url(path: string, params: Record<string,string|number|undefined>) { const q = new URLSearchParams(); for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k,String(v)); return `${path}${q.size ? `?${q}` : ''}`; }
export async function history(params: Record<string,string|number|undefined>, signal?: AbortSignal) {
 const v = await apiGet<unknown>(url('/api/manual-agents/history',params),signal);
 if (!isRecord(v) || !Array.isArray(v.sessions) || v.sessions.length > 100 || !v.sessions.every(session) || !(v.next_cursor === null || typeof v.next_cursor === 'string') || !integer(v.server_time_ms)) throw new ContractError('Invalid history page');
 return v as {sessions: HistorySession[]; next_cursor: string|null; server_time_ms: number};
}

export async function manualSession(id: string, signal: AbortSignal): Promise<HistorySession> {
  const value = await apiGet<unknown>(`/api/manual-agents/${encodeURIComponent(id)}`, signal);
  if (!session(value) || value.id !== id) throw new ContractError('Invalid manual session');
  return value;
}
