import schema from "../../../contracts/pinned/results-feedback/v1/schema.json";
import actions from "../../../contracts/pinned/dashboard-actions/v1/schema.json";
import { ContractError, isRecord } from "./contract";
import type { Anchor, Detail, ResultsPage, CommentsPage, Scope } from "../wire/resultsFeedback";
import type { MediaBinding } from "./resultMedia";
export type { Detail as ResultDetail, CommentProjection as ResultComment, Anchor as ResultAnchor } from "../wire/resultsFeedback";
type Rule = { $ref?: string; oneOf?: Rule[]; anyOf?: Rule[]; const?: unknown; enum?: unknown[]; type?: string|string[]; properties?: Record<string,Rule>; required?: string[]; additionalProperties?: boolean; items?: Rule; minItems?: number; maxItems?: number; minLength?: number; maxLength?: number; pattern?: string; format?: string; minimum?: number; maximum?: number };
const fail = (): never => { throw new ContractError("Invalid Results feedback contract"); };
const check = (ok: unknown): void => { if (!ok) fail(); };
// Only the published closed schema's validation vocabulary is interpreted here.
// No defaults, coercion, remote references or executable data are admitted.
function matches(v: unknown, rule: Rule, defs: Record<string,Rule>): boolean {
  if (rule.$ref) return matches(v,defs[rule.$ref.split("/").at(-1)!]!,defs);
  if (rule.oneOf && rule.oneOf.filter(r=>matches(v,r,defs)).length!==1) return false;
  if (rule.anyOf && !rule.anyOf.some(r=>matches(v,r,defs))) return false;
  if ("const" in rule && v!==rule.const || rule.enum && !rule.enum.includes(v)) return false;
  if (Array.isArray(rule.type)) return rule.type.some(type=>matches(v,{...rule,type},defs));
  if (rule.type==="null") return v===null;
  if (rule.type==="object") {
    if (!isRecord(v) || rule.required?.some(k=>!Object.hasOwn(v,k))) return false;
    return Object.entries(v).every(([k,value])=>rule.properties?.[k] ? matches(value,rule.properties[k]!,defs) : rule.additionalProperties!==false);
  }
  if (rule.type==="array") return Array.isArray(v) && v.length<=(rule.maxItems??1000) && v.length>=(rule.minItems??0) && v.every(x=>!rule.items||matches(x,rule.items,defs));
  if (rule.type==="string") return typeof v==="string" && [...v].length>=(rule.minLength??0) && [...v].length<=(rule.maxLength??65536) && (!rule.pattern||new RegExp(rule.pattern).test(v)) && (rule.format!=="uuid"||/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v));
  if (rule.type==="integer"||rule.type==="number") return typeof v==="number" && Number.isFinite(v) && (rule.type!=="integer"||Number.isSafeInteger(v)) && v>=(rule.minimum??-Infinity) && v<=(rule.maximum??Infinity);
  if (rule.type==="boolean") return typeof v==="boolean";
  return true;
}
export function validateResultPayload(kind: string, value: unknown): void {
  const defs = schema.$defs as unknown as Record<string,Rule>;
  check(!!defs[kind] && matches(value,defs[kind]!,defs));
  if (!isRecord(value)) return;
  if ("operation_id" in value) check(value.operation_id!=="00000000-0000-0000-0000-000000000000" && typeof value.expected_version==="string" && BigInt(value.expected_version)<=9223372036854775807n);
  if (kind==="Comment"||kind==="Correction") check(typeof value.body==="string" && !!value.body.trim() && new TextEncoder().encode(value.body).length<=16384 && !/[\uD800-\uDFFF]/u.test(value.body));
  if (kind==="Comment") validateAnchor(value.anchor as Anchor);
  if (kind==="FeedbackDraft") {
    check(typeof value.title==="string" && !!value.title.trim() && !/\p{Cc}|[\uD800-\uDFFF]/u.test(value.title));
    for (const [field,max] of [["description",32768],["acceptance_criteria",8192]] as const) check(typeof value[field]==="string" && !!value[field].trim() && new TextEncoder().encode(value[field]).length<=max);
  }
  check(new TextEncoder().encode(JSON.stringify(value)).length<=65536 || !["Comment","FeedbackDraft","FeedbackLink","Follow"].includes(kind));
}
export function validateAnchor(anchor: Anchor): void {
  check(anchor.kind!=="video_range");
  if (anchor.kind==="image_region") check(anchor.width>0 && anchor.height>0 && anchor.x+anchor.width<=1 && anchor.y+anchor.height<=1);
}
function scopeEqual(a: unknown,b: Scope) { return isRecord(a) && a.kind===b.kind && (b.kind!=="project"||a.project_id===b.project_id); }
function envelope(raw: unknown,kind: string,scope?: Scope): Record<string,unknown> {
  validateResultPayload(kind,raw); check(isRecord(raw));
  const env=raw as Record<string,unknown>;
  check(!scope||scopeEqual(env.scope,scope));
  return env;
}
function detailSemantics(item: Detail) {
  check(item.revision.revision===item.assessment.result_revision);
  check(item.revision.submitted_at_ms<=8640000000000000);
  check(/^[1-9][0-9]*$/.test(item.result.version));
  check(new RegExp(`^[0-9a-f]{${item.revision.source.base.format==="sha1"?40:64}}$`).test(item.revision.source.base.hex));
}
export function adaptResultsFeed(raw: unknown,scope: Scope): ResultsPage {
  const data=envelope(raw,"Envelope2",scope).data as ResultsPage;
  check(data.items.length<=10 && new Set(data.items.map(x=>x.result.id)).size===data.items.length);
  for (const item of data.items) { detailSemantics(item); check(scope.kind!=="project"||scope.project_id===item.result.project_id); }
  for (let i=1;i<data.items.length;i++) { const a=data.items[i-1]!.revision,b=data.items[i]!.revision; check(a.submitted_at_ms>b.submitted_at_ms || a.submitted_at_ms===b.submitted_at_ms && a.report_id>b.report_id); }
  return data;
}
export function adaptResultDetail(raw: unknown,exact: {id:string;revision:string},project?: string): Detail {
  const data=envelope(raw,"Envelope4",project?{kind:"project",project_id:project}:undefined).data as Detail;
  detailSemantics(data);check(!project||data.result.project_id===project); check((data.result.id===exact.id||data.revision.report_id===exact.id)&&data.revision.revision===exact.revision);
  return data;
}
export function adaptResultComments(raw: unknown,project: string): CommentsPage {
  const data=envelope(raw,"Envelope3",{kind:"project",project_id:project}).data as CommentsPage;
  check(data.items.length<=20 && new Set(data.items.map(x=>x.id)).size===data.items.length);
  for (const c of data.items) { validateAnchor(c.anchor); check(c.created_at_ms<=8640000000000000 && c.history.length<=16); }
  return data;
}
export type ResultOperation = { operation_id:string;disposition:"pending"|"confirmed"|"unknown"|"conflict"|"rejected";request_digest:string;recovery:string;affected_entities:{type:string;id:string;revision?:string}[];receipt_refs:{type:string;id:string;revision?:string}[] };
export function adaptResultOperation(raw: unknown,id: string,project?:string): ResultOperation {
  const defs=actions.$defs as unknown as Record<string,Rule>;
  check(matches(raw,defs.Envelope!,defs));
  check(isRecord(raw)&&isRecord(raw.data)&&raw.data.operation_id===id);
  if(project){const env=raw as {scope:unknown;data:{scope:unknown}};check(scopeEqual(env.scope,{kind:"project",project_id:project})&&scopeEqual(env.data.scope,{kind:"project",project_id:project}));}
  return (raw as {data:ResultOperation}).data;
}
export function mediaBinding(detail: Detail): MediaBinding {
  return {coverage:"recorded_legacy_native_only",report_id:detail.revision.report_id,report_revision:detail.revision.revision,project_id:detail.result.project_id,task_id:detail.result.task_id,attempt_id:detail.revision.attempt_id,source:detail.revision.source};
}
