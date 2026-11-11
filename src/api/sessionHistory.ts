import { apiGet } from './client';
import { ContractError, isRecord } from './adapters/contract';
import { validGraphId } from './adapters/humanGraph';
import type { ManualAgent } from '../features/agents/swarm/manualAgents';

export type Archive = { state: 'not_recorded'|'recording'|'finalizing'|'complete'; coverage: 'unknown'|'complete'|'partial'; reason: string|null; first_sequence: number|null; last_sequence: number|null; bytes: number; updated_at_ms: number|null };
export type HistorySession = Omit<ManualAgent, 'spec'> & { spec: Omit<ManualAgent['spec'], 'project_name' | 'repository_id'> & { project_name?: string; repository_id?: string }; archive: Archive };
export type Chunk = { sequence: number; text: string };
export type Match = { offset: number; length: number; sequence: number; excerpt: string };
export type Transcript = { session: HistorySession; chunks: Chunk[]; next_after: number; has_more: boolean; through_sequence: number; server_time_ms: number };
export type SearchPage = { matches: Match[]; next_after: number|null; has_more: boolean; through_sequence: number; server_time_ms: number };
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableInteger = (v: unknown) => v === null || integer(v);
function session(v: unknown): v is HistorySession {
 if (!isRecord(v) || !isRecord(v.archive) || !isRecord(v.spec) || !validGraphId(v.id) || !validGraphId(v.node_id) || !validGraphId(v.project_id) || typeof v.spec.provider !== 'string' || typeof v.spec.model !== 'string' || !(v.spec.project_name === undefined || typeof v.spec.project_name === 'string') || !['pending','preparing','running','stopping','stopped','failed'].includes(String(v.status)) || typeof v.stage !== 'string' || typeof v.desired_running !== 'boolean' || !integer(v.created_at_ms) || !integer(v.updated_at_ms) || !nullableInteger(v.worker_seen_at_ms)) return false;
 const a = v.archive;
 return ['not_recorded','recording','finalizing','complete'].includes(String(a.state)) && ['unknown','complete','partial'].includes(String(a.coverage)) && (a.reason === null || typeof a.reason === 'string') && nullableInteger(a.first_sequence) && nullableInteger(a.last_sequence) && integer(a.bytes) && nullableInteger(a.updated_at_ms);
}
function url(path: string, params: Record<string,string|number|undefined>) { const q = new URLSearchParams(); for (const [k,v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k,String(v)); return `${path}${q.size ? `?${q}` : ''}`; }
export async function history(params: Record<string,string|number|undefined>, signal?: AbortSignal) {
 const v = await apiGet<unknown>(url('/api/manual-agents/history',params),signal);
 if (!isRecord(v) || !Array.isArray(v.sessions) || v.sessions.length > 100 || !v.sessions.every(session) || !(v.next_cursor === null || typeof v.next_cursor === 'string') || !integer(v.server_time_ms)) throw new ContractError('Invalid history page');
 return v as {sessions: HistorySession[]; next_cursor: string|null; server_time_ms: number};
}
export async function transcript(id: string, params: {after?: number; through?: number; limit?: number} = {}, signal?: AbortSignal, expectedProject?: string): Promise<Transcript> {
 const v = await apiGet<unknown>(url(`/api/manual-agents/${encodeURIComponent(id)}/transcript`,params),signal);
 if (!isRecord(v) || !session(v.session) || !Array.isArray(v.chunks) || v.chunks.length > 64 || !v.chunks.every(c => isRecord(c) && integer(c.sequence) && typeof c.text === 'string') || !integer(v.next_after) || typeof v.has_more !== 'boolean' || !integer(v.through_sequence) || !integer(v.server_time_ms)) throw new ContractError('Invalid transcript page');
 const page = v as Transcript;
 if (page.session.id !== id) throw new ContractError('Transcript session does not match request');
 if (expectedProject && page.session.project_id !== expectedProject) throw new ContractError('Transcript project does not match scope');
 if ((params.through !== undefined && page.through_sequence !== params.through) || page.chunks.some((c,i) => c.sequence <= (i ? page.chunks[i-1]!.sequence : (params.after ?? 0)) || c.sequence > page.through_sequence) || page.next_after !== (page.chunks.at(-1)?.sequence ?? (params.after ?? 0)) || (page.has_more && page.next_after <= (params.after ?? 0))) throw new ContractError('Transcript cursor did not advance');
 return page;
}
export async function searchTranscript(id: string, params: {q: string; after?: number; through?: number; limit?: number}, signal?: AbortSignal): Promise<SearchPage> {
 const v = await apiGet<unknown>(url(`/api/manual-agents/${encodeURIComponent(id)}/transcript/search`,params),signal);
 if (!isRecord(v) || !Array.isArray(v.matches) || v.matches.length > 100 || !v.matches.every(m => isRecord(m) && integer(m.offset) && integer(m.length) && integer(m.sequence) && typeof m.excerpt === 'string') || !(v.next_after === null || integer(v.next_after)) || typeof v.has_more !== 'boolean' || !integer(v.through_sequence) || !integer(v.server_time_ms)) throw new ContractError('Invalid search page');
 const page = v as SearchPage;
 if ((params.through !== undefined && page.through_sequence !== params.through) || page.matches.some((m,i) => i ? m.offset <= page.matches[i-1]!.offset : params.after !== undefined && m.offset <= params.after) || (page.has_more && (page.next_after === null || (params.after !== undefined && page.next_after <= params.after)))) throw new ContractError('Search cursor did not advance');
 return page;
}
/** Byte positions are measured in UTF-8, not JavaScript UTF-16 code units. */
export function byteIndex(text: string, offset: number): number { return new TextDecoder().decode(new TextEncoder().encode(text).slice(0,offset)).length; }
/** Download a frozen snapshot; reject incomplete or non-progressing pagination. */
export async function downloadTranscript(id: string, signal: AbortSignal, progress: (bytes: number) => void, expectedProject?: string): Promise<string> {
 let after = 0, through: number|undefined, bytes = 0; const parts: string[] = [];
 do { const p = await transcript(id,{after,through,limit:64},signal,expectedProject); through ??= p.through_sequence; if (p.through_sequence !== through) throw new ContractError('Transcript snapshot changed'); for (const c of p.chunks) { parts.push(c.text); bytes += new TextEncoder().encode(c.text).length; } progress(bytes); if (!p.has_more) { if (p.next_after !== through) throw new ContractError('Transcript ended before its snapshot'); break; } after = p.next_after; } while (true);
 return parts.join('');
}
