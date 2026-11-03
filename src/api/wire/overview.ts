/** G4 dashboard-read-1 projection. Source and hashes: contracts/pinned/dashboard-read/source.json. */
import type { Coverage, Envelope, Observation, ProjectRef, Total, ReferenceRevision } from './proposed';
export type { ReferenceRevision } from './proposed';
export type EntityRef = { type: string; id: string; revision?: ReferenceRevision | null };
export type SourceObservation = { source: string; project?: ProjectRef | null; observation?: Observation | null; coverage: Coverage; total: Total };
export type AttentionItem = {
 id: string; kind: 'decision'|'question'|'blocked'|'failed'|'uncertain_operation'|'worker_offline';
 title: string; project?: ProjectRef|null; reason: string; impact: string; since?: string|null;
 subject: EntityRef; action?: {kind:string;label:string;subject:EntityRef}|null;
};
export type Overview = {
 counts: {running:Total;ready:Total;needs_you:Total;recovering:Total}; attention:AttentionItem[];
 in_motion:{project:ProjectRef;running:Total;next_constraint?:{kind:string;explanation:string}|null;last_progress_at?:string|null}[];
 recent_outcomes:{subject:EntityRef&{title:string};project:ProjectRef;outcome:string;at:string}[];
 sources?:SourceObservation[];
};
export type QuotaWindow = {
 id:string;label:string;starts_at?:string|null;resets_at?:string|null;used_percent?:number|null;
 used?:number|null;limit?:number|null;unit:string|null;state:'known'|'unknown'|'unavailable';observation:Observation;
};
export type ProviderUsage = {
 provider_id:string;account_ref:string;account_label:string;scope:'provider_account';windows:QuotaWindow[];
 preferred_window_id?:string|null;availability_ref?:EntityRef|null;
};
export type ProviderUsageEnvelope = Envelope<ProviderUsage[]>;
export type Search = {groups:{type:'task'|'session'|'result'|'playbook'|'knowledge';hits:{ref:{kind:string;id:string;revision:ReferenceRevision};title:string;excerpt:string;project:ProjectRef}[];has_more:boolean;next_cursor?:string|null}[];sources:SourceObservation[];snapshot_id:string};
