import type { Overview, SourceObservation } from '../wire/overview';
import type { EntityRef, Total } from '../wire/proposed';
import { ContractError, isRecord } from './contract';
import { reference, timestamp } from './reference';
import { adaptTotal, type TotalView } from './inspection';
const KINDS = ['decision','question','blocked','failed','uncertain_operation','worker_offline'] as const;
export type AttentionView = {
 id:string;kind:typeof KINDS[number]|'unsupported';title:string;project:{id:string;label:string}|null;reason:string;impact:string;since:string|null;subject:EntityRef;
 action:{kind:string;allowed:boolean;explanation:string|null;subject:EntityRef}|null;
};
export type OverviewView = {
 counts:Record<keyof Overview['counts'],TotalView>;attention:AttentionView[];
 inMotion:{project:Overview['in_motion'][number]['project'];running:TotalView;nextConstraint:{kind:string;explanation:string}|null;lastProgressAt:string|null}[];
 recentOutcomes:{subject:EntityRef&{title:string};project:{id:string;label:string};outcome:string;at:string}[];
 sources:SourceObservation[];
};
function text(v:unknown):string { if(typeof v!=='string')throw new ContractError('Invalid overview text');return v; }
function total(v:unknown):TotalView {if(!isRecord(v)||typeof v.accuracy!=='string'||!(v.value===null||typeof v.value==='number'&&Number.isFinite(v.value)&&v.value>=0))throw new ContractError('Invalid overview total');return adaptTotal(v as Total);}
function project(v:unknown) {if(!isRecord(v))throw new ContractError('Invalid overview project');return {id:text(v.id),label:text(v.label)};}
/** Validate source observations before a partial result reaches a rendered view. */
export function adaptSources(input:unknown):SourceObservation[] {
 if(input===undefined)return [];
 if(!Array.isArray(input))throw new ContractError('Invalid source observations');
 return input.map(s=>{
  if(!isRecord(s)||!isRecord(s.coverage)||!['complete','partial','unknown'].includes(text(s.coverage.state))||!isRecord(s.total))throw new ContractError('Invalid overview source');
  const observation=s.observation;
  if(observation!=null&&(!isRecord(observation)||!timestamp(observation.observed_at)||!timestamp(observation.fresh_until)||typeof observation.source!=='string'||!['reported','estimated','unknown'].includes(text(observation.quality))||!['complete','partial','unknown'].includes(text(observation.coverage))))throw new ContractError('Invalid source observation');
  const result={...s,source:text(s.source),project:s.project==null?null:project(s.project),observation:observation??null,total:total(s.total)};
  return result as SourceObservation;
 });
}
export function adaptOverview(input: unknown): OverviewView {
 if(!isRecord(input)||!isRecord(input.counts)||!Array.isArray(input.attention)||!Array.isArray(input.in_motion)||!Array.isArray(input.recent_outcomes)||input.sources!==undefined&&!Array.isArray(input.sources)) throw new ContractError('Invalid overview collections');
 const o=input as unknown as Overview;
 const counts={} as OverviewView['counts'];
 for(const key of ['running','ready','needs_you','recovering'] as const){if(!isRecord(o.counts[key]))throw new ContractError('Missing overview count');counts[key]=total(o.counts[key]);}
 const sources=adaptSources(o.sources);
 return { counts,sources,
  attention:o.attention.map(a=>{
   if(!isRecord(a))throw new ContractError('Invalid attention row');
   const kind=KINDS.includes(a.kind)?a.kind:'unsupported';
   const raw=a.action as unknown;
   let action:AttentionView['action']=null;
   if(raw!=null){if(!isRecord(raw))throw new ContractError('Invalid attention action'); action={kind:text(raw.kind),subject:reference(raw.subject),allowed:kind!=='unsupported'&&(typeof raw.label==='string'||raw.allowed===true),explanation:typeof raw.explanation==='string'?raw.explanation:null};}
   return {id:text(a.id),kind,title:text(a.title),project:a.project==null?null:project(a.project),reason:text(a.reason),impact:text(a.impact),since:timestamp(a.since),subject:reference(a.subject),action};
  }),
  inMotion:o.in_motion.map(m=>{if(!isRecord(m)||!isRecord(m.running)||m.next_constraint!=null&&!isRecord(m.next_constraint))throw new ContractError('Invalid project movement');return ({project:project(m.project),running:total(m.running),nextConstraint:m.next_constraint?{kind:text(m.next_constraint.kind),explanation:text(m.next_constraint.explanation)}:null,lastProgressAt:timestamp(m.last_progress_at)});}),
  recentOutcomes:o.recent_outcomes.map(r=>{if(!isRecord(r)||!isRecord(r.subject))throw new ContractError('Invalid recent outcome');return ({subject:{...reference(r.subject),title:text(r.subject.title)},project:project(r.project),outcome:text(r.outcome),at:timestamp(r.at)??(()=>{throw new ContractError('Missing outcome time');})()});}),
 };
}
