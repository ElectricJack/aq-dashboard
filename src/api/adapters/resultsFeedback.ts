import { matches, type Rule } from "./resultsFeedbackSchema";
import schema from "../../../contracts/pinned/results-feedback/v1/schema.json";
import actions from "../../../contracts/pinned/dashboard-actions/v1/schema.json";
import { ContractError, isRecord } from "./contract";
/**
 * A Results read that fails validation degrades the Results view only. It is a
 * plain Error on purpose: ContractError is a protected-read failure and would
 * mark the whole dashboard session incompatible.
 */
export class ResultsViewError extends Error {
  override name = "ResultsViewError";
  constructor(message: string) { super(message); }
}
export function viewScoped<T>(read: () => T): T {
  try { return read(); } catch (error) {
    if (error instanceof ContractError) throw new ResultsViewError("Results response could not be read by this dashboard");
    throw error;
  }
}
import type { Anchor, Detail, ResultsPage, CommentsPage, Scope } from "../wire/resultsFeedback";
import type { MediaBinding } from "./resultMedia";
export type { Detail as ResultDetail, CommentProjection as ResultComment, Anchor as ResultAnchor } from "../wire/resultsFeedback";
const fail = (): never => { throw new ContractError("Invalid Results feedback contract"); };
function check(ok: unknown): asserts ok { if (!ok) fail(); }
/** The process outcomes this bundle knows (results-feedback-1.1 `ProcessOutcome`). */
export const PROCESS_OUTCOMES = (schema.$defs as unknown as Record<string,Rule>).ProcessOutcome?.enum as readonly string[] ?? [];
/**
 * Open enums (lesson W77): a value a newer server adds must not fail the whole Results read. These enums are read
 * as bounded identifiers instead, and the view shows an unknown one as "Unknown (value)". Every other enum stays closed.
 */
const OPEN_ENUMS: Record<string,Rule> = { ProcessOutcome: { type: "string", pattern: "^[A-Za-z][A-Za-z0-9_.:-]{0,63}$" } };
const RESULT_DEFS: Record<string,Rule> = { ...(schema.$defs as unknown as Record<string,Rule>), ...OPEN_ENUMS };
/** The worker-reported process outcome: null when the server doesn't report one (older servers omit it). */
export function processOutcome(revision: { process_outcome?: string | null }): { value: string; known: boolean } | null {
  const v = revision.process_outcome;
  return typeof v === "string" ? { value: v, known: PROCESS_OUTCOMES.includes(v) } : null;
}
function checkNonblankText(value: unknown, maxBytes: number): asserts value is string {
  check(typeof value === "string");
  check(value.trim());
  check(new TextEncoder().encode(value).length <= maxBytes);
}

export function validateResultPayload(kind: string, value: unknown): void {
  const defs = RESULT_DEFS;
  check(!!defs[kind] && matches(value,defs[kind]!,defs));
  if (!isRecord(value)) return;
  if ("operation_id" in value) {
    check(value.operation_id !== "00000000-0000-0000-0000-000000000000");
    check(typeof value.expected_version === "string");
    check(BigInt(value.expected_version) <= 9223372036854775807n);
  }
  if (["Comment", "Correction"].includes(kind)) {
    checkNonblankText(value.body, 16384);
    check(!/\p{Cs}/u.test(value.body));
  }
  if (kind==="Comment") validateAnchor(value.anchor as Anchor);
  if (kind==="FeedbackDraft") {
    check(typeof value.title === "string");
    check(value.title.trim());
    check(!/[\p{Cc}\p{Cs}]/u.test(value.title));
    checkNonblankText(value.description, 32768);
    checkNonblankText(value.acceptance_criteria, 8192);
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
