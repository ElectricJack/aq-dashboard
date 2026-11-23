import type { Overview, SourceObservation } from '../wire/overview';
import type { EntityRef, Total } from '../wire/proposed';
import { ContractError, isRecord, nullable, optional } from './contract';
import { reference, timestamp } from './reference';
import { adaptTotal, type TotalView } from './inspection';
const KINDS = ['decision','question','blocked','failed','uncertain_operation','worker_offline','internal_work'] as const;
/** Where an attention item comes from, for kinds whose title does not say. Internal work items open the affected item. */
export const ATTENTION_SOURCE_LABEL: Partial<Record<AttentionView['kind'],string>> = {internal_work:'Internal work'};
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
function expect(value: unknown, issue: string): asserts value { if (!value) throw new ContractError(issue); }
function total(v: unknown): TotalView {
 const issue = 'Invalid overview total';
 expect(isRecord(v), issue);
 expect(typeof v.accuracy === 'string', issue);
 expect(nullable(v.value, value => typeof value === 'number' && Number.isFinite(value) && value >= 0), issue);
 return adaptTotal(v as Total);
}
function project(v:unknown) {if(!isRecord(v))throw new ContractError('Invalid overview project');return {id:text(v.id),label:text(v.label)};}
function checkObservation(value: unknown) {
 const issue = 'Invalid source observation';
 expect(isRecord(value), issue);
 expect(timestamp(value.observed_at), issue);
 expect(timestamp(value.fresh_until), issue);
 expect(typeof value.source === 'string', issue);
 expect(['reported', 'estimated', 'unknown'].includes(text(value.quality)), issue);
 expect(['complete', 'partial', 'unknown'].includes(text(value.coverage)), issue);
}
/** Validate source observations before a partial result reaches a rendered view. */
export function adaptSources(input:unknown):SourceObservation[] {
 if(input===undefined)return [];
 if(!Array.isArray(input))throw new ContractError('Invalid source observations');
 return input.map(s=>{
  const issue = 'Invalid overview source';
  expect(isRecord(s), issue);
  expect(isRecord(s.coverage), issue);
  expect(['complete', 'partial', 'unknown'].includes(text(s.coverage.state)), issue);
  expect(isRecord(s.total), issue);
  const observation = s.observation;
  if (observation != null) checkObservation(observation);
  const result={...s,source:text(s.source),project:s.project==null?null:project(s.project),observation:observation??null,total:total(s.total)};
  return result as SourceObservation;
 });
}
/**
 * Open decisions (reviews and questions) from the overview's source totals (RR-02).
 * `counts.needs_you` counts every attention item, offline workers and failed results
 * included, so it is not a decision count. Null when no decision source reports a total.
 */
export function decisionTotal(sources:SourceObservation[]):TotalView|null {
 const relevant=sources.filter(s=>s.source==='reviews'||s.source==='questions');
 const known=relevant.filter(s=>s.total.value!==null);
 if(!known.length)return null;
 const exact=known.length===relevant.length&&relevant.every(s=>s.total.accuracy==='exact'&&s.coverage.state==='complete');
 return {value:known.reduce((n,s)=>n+(s.total.value??0),0),accuracy:exact?'exact':'estimated'};
}
function attention(item: Overview['attention'][number]): AttentionView {
 expect(isRecord(item), 'Invalid attention row');
 const kind = KINDS.includes(item.kind) ? item.kind : 'unsupported';
 const raw: unknown = item.action;
 let action: AttentionView['action'] = null;
 if (raw != null) {
  expect(isRecord(raw), 'Invalid attention action');
  const offered = typeof raw.label === 'string' || raw.allowed === true;
  action = { kind: text(raw.kind), subject: reference(raw.subject), allowed: kind !== 'unsupported' && offered,
   explanation: typeof raw.explanation === 'string' ? raw.explanation : null };
 }
 return { id: text(item.id), kind, title: text(item.title), project: item.project == null ? null : project(item.project),
  reason: text(item.reason), impact: text(item.impact), since: timestamp(item.since), subject: reference(item.subject), action };
}

function movement(row: Overview['in_motion'][number]) {
 const issue = 'Invalid project movement';
 expect(isRecord(row), issue);
 expect(isRecord(row.running), issue);
 if (row.next_constraint != null) expect(isRecord(row.next_constraint), issue);
 const constraint = row.next_constraint;
 return { project: project(row.project), running: total(row.running),
  nextConstraint: constraint ? { kind: text(constraint.kind), explanation: text(constraint.explanation) } : null,
  lastProgressAt: timestamp(row.last_progress_at) };
}

function outcome(row: Overview['recent_outcomes'][number]) {
 expect(isRecord(row), 'Invalid recent outcome');
 expect(isRecord(row.subject), 'Invalid recent outcome');
 const subject = { ...reference(row.subject), title: text(row.subject.title) };
 const owner = project(row.project), result = text(row.outcome), at = timestamp(row.at);
 expect(at !== null, 'Missing outcome time');
 return { subject, project: owner, outcome: result, at };
}

export function adaptOverview(input: unknown): OverviewView {
 const issue = 'Invalid overview collections';
 expect(isRecord(input), issue);
 expect(isRecord(input.counts), issue);
 expect(Array.isArray(input.attention), issue);
 expect(Array.isArray(input.in_motion), issue);
 expect(Array.isArray(input.recent_outcomes), issue);
 expect(optional(input.sources, Array.isArray), issue);
 const counts = {} as OverviewView['counts'];
 for (const key of ['running', 'ready', 'needs_you', 'recovering'] as const) {
  expect(isRecord(input.counts[key]), 'Missing overview count');
  counts[key] = total(input.counts[key]);
 }
 const sources = adaptSources(input.sources);
 return { counts, sources, attention: input.attention.map(attention), inMotion: input.in_motion.map(movement), recentOutcomes: input.recent_outcomes.map(outcome) };
}
