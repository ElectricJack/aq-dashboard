import { apiGet } from './client';
import { ContractError, isRecord, nullable, optional } from './adapters/contract';
import { validGraphId } from './adapters/humanGraph';
import type { ManualAgent } from '../features/agents/swarm/manualAgents';

export type HistorySession = Omit<ManualAgent, 'spec'> & {
  spec: Omit<ManualAgent['spec'], 'project_name' | 'repository_id'> & { project_name?: string; repository_id?: string };
  conversation_available?: boolean;
};
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const STATUSES = new Set(['pending', 'preparing', 'running', 'stopping', 'stopped', 'failed']);

function validSpec(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { provider, model, project_name } = value;
  return typeof provider === 'string' && typeof model === 'string' && optional(project_name, name => typeof name === 'string');
}

function lifecycle(value: Record<string, unknown>): boolean {
  return STATUSES.has(String(value.status)) && typeof value.stage === 'string' && typeof value.desired_running === 'boolean';
}

function historyTimes(value: Record<string, unknown>): boolean {
  return [value.created_at_ms, value.updated_at_ms].every(integer) && nullable(value.worker_seen_at_ms, integer);
}

function session(value: unknown): value is HistorySession {
  if (!isRecord(value)) return false;
  const available = optional(value.conversation_available, available => typeof available === 'boolean');
  const identity = [value.id, value.node_id, value.project_id].every(validGraphId);
  return identity && available && validSpec(value.spec) && lifecycle(value) && historyTimes(value);
}

function sessionPage(value: unknown): value is { sessions: HistorySession[]; next_cursor: string|null; server_time_ms: number } {
  if (!isRecord(value)) return false;
  const { sessions, next_cursor } = value;
  if (!Array.isArray(sessions) || sessions.length > 100) return false;
  const cursorValid = nullable(next_cursor, cursor => typeof cursor === 'string');
  return cursorValid && integer(value.server_time_ms) && sessions.every(session);
}

function url(path: string, params: Record<string,string|number|undefined>) { const q = new URLSearchParams(); for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k,String(v)); return `${path}${q.size ? `?${q}` : ''}`; }
export async function history(params: Record<string,string|number|undefined>, signal?: AbortSignal) {
 const v = await apiGet<unknown>(url('/api/manual-agents/history',params),signal);
 if (!sessionPage(v)) throw new ContractError('Invalid history page');
 return v;
}

export async function manualSession(id: string, signal: AbortSignal): Promise<HistorySession> {
  const value = await apiGet<unknown>(`/api/manual-agents/${encodeURIComponent(id)}`, signal);
  if (!session(value) || value.id !== id) throw new ContractError('Invalid manual session');
  return value;
}
