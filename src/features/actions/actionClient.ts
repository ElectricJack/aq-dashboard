import { ApiError } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { validGraphId, type GraphEnvelope, type GraphNode } from "../../api/adapters/humanGraph";

export const actionLabels = {
  // Cancel and retry act on the agent attempt, never on the task lifecycle (WD-11).
  "task.edit": "Edit task", "task.cancel": "Cancel attempt", "task.retry": "Retry attempt",
  "task.dependency.add": "Add dependency", "task.dependency.remove": "Remove dependency",
  "knowledge.author": "Add record", "knowledge.correct": "Correct record",
  "knowledge.verify": "Verify record", "knowledge.retire": "Retire record",
  "knowledge.restore": "Restore record",
} as const;
export const actionCapability = (kind: ActionKind): string => ({"task.edit":"tasks.edit","task.cancel":"tasks.cancel","task.retry":"tasks.retry","task.dependency.add":"tasks.dependencies.add","task.dependency.remove":"tasks.dependencies.remove"} as Partial<Record<ActionKind,string>>)[kind] ?? kind;
export type ActionKind = keyof typeof actionLabels;
/** Document actions for a knowledge record's lifecycle: a retired (or deleted) record is only restored, never edited or retired again. */
export const knowledgeActionKinds = (node: Pick<GraphNode, "retired" | "deleted"> | undefined): ActionKind[] =>
  node?.retired || node?.deleted ? ["knowledge.restore"] : ["knowledge.correct", "knowledge.verify", "knowledge.retire"];
/** Human label for a knowledge content type ("standard_operating" → "Standard operating"). */
export const knowledgeCategoryLabel = (value: string | null | undefined) => value ? value.replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()) : "Uncategorized";
export type ActionContext = { project: GraphEnvelope<unknown>["project"]; data?: GraphNode };
/** `kind` is a union kind name; feature modules (for example playbooks) freeze their own kinds through the same transport. */
/** `project` is the expected operation scope when the kind's payload carries no `project_id` (for example `question.answer`). */
export type FrozenAction = Readonly<{ id: string; bytes: string; kind: string; subject: {type:string;id:string;revision?:string}; project?: string }>;
export type EntityRef = {type:string;id:string;revision?:string|null};
export type ActionOperation = {
  operation_id:string; disposition:"pending"|"confirmed"|"conflict"|"rejected"|"unknown";
  request_digest:string; subject_refs:EntityRef[]; receipt_refs:EntityRef[]; affected_entities:EntityRef[];
  current_versions?:Record<string,string>; recovery:string;
};
export function freezeAction(kind:ActionKind, context:ActionContext, fields:Record<string,unknown>, reason?:string):FrozenAction {
  const id=crypto.randomUUID(), author=kind==="knowledge.author";
  const revision=author?context.project.revision:context.data!.version;
  const subject={type:author?"project":kind.startsWith("task.")?"task":"knowledge",id:author?context.project.id:context.data!.id,revision};
  const body={operation_id:id,kind,subject,expected_versions:{[subject.type]:revision},
    ...(reason?{reason}:{}),payload:{...fields,operation_id:id,project_id:context.project.id,[author?"expected_project_revision":"expected_version"]:revision}};
  const bytes=JSON.stringify(body);
  if(new TextEncoder().encode(bytes).length>65536)throw new Error("This request is too large. Shorten the document or labels.");
  return Object.freeze({id,bytes,kind,subject});
}
const revision=(v:unknown)=>typeof v==="string"&&/^[1-9][0-9]{0,39}$/.test(v);
function refs(v:unknown):v is EntityRef[]{return Array.isArray(v)&&v.length<=100&&v.every(r=>isRecord(r)&&typeof r.type==="string"&&r.type.length<=64&&typeof r.id==="string"&&r.id.length<=128&&(r.revision===undefined||r.revision===null||revision(r.revision)));}
export function adaptActionOperation(raw:unknown, frozen:FrozenAction):ActionOperation {
  if(!isRecord(raw)||raw.api_version!=="dashboard-actions-1"||!isRecord(raw.data))throw new ContractError("Unsupported action response");
  const n=raw.data;
  if(n.operation_id!==frozen.id||!validGraphId(n.operation_id)||!["pending","confirmed","conflict","rejected","unknown"].includes(String(n.disposition))||
    typeof n.request_digest!=="string"||!/^sha256:[a-f0-9]{64}$/.test(n.request_digest)||
    !refs(n.subject_refs)||n.subject_refs.length>1||!refs(n.receipt_refs)||!refs(n.affected_entities)||
    !["none","lookup_original","refresh_and_review"].includes(String(n.recovery))||
    typeof n.created_at!=="string"||!Number.isFinite(Date.parse(n.created_at))||typeof n.updated_at!=="string"||!Number.isFinite(Date.parse(n.updated_at))||
    !isRecord(n.scope)||!(n.scope.kind==="all_authorized"||(n.scope.kind==="project"&&n.scope.project_id===(frozen.project??JSON.parse(frozen.bytes).payload.project_id)))||
    (n.current_versions!==undefined&&(!isRecord(n.current_versions)||Object.keys(n.current_versions).length>32||!Object.values(n.current_versions).every(revision))))throw new ContractError("Invalid action operation");
  if(n.subject_refs.some(s=>s.type!==frozen.subject.type||s.id!==frozen.subject.id))throw new ContractError("Action subject changed");
  if(n.disposition==="confirmed"&&!n.receipt_refs.length)throw new ContractError("Confirmation has no receipt");
  return n as unknown as ActionOperation;
}
/** Frozen bytes cross the fetch boundary unchanged, including deliberate retries. */
export async function actionRequest(intent:FrozenAction, lookup=false, signal?:AbortSignal):Promise<ActionOperation> {
  const method=lookup?"GET":"POST";
  try {
    const response=await fetch(lookup?`/api/v1/operations/${encodeURIComponent(intent.id)}`:"/api/v1/actions",{
      method,credentials:"same-origin",signal:AbortSignal.any([AbortSignal.timeout(6000),...(signal?[signal]:[])]),
      headers:{Accept:"application/json",...(!lookup?{"Content-Type":"application/json","X-AQ-Request":"1"}:{})},...(!lookup?{body:intent.bytes}:{})});
    const raw:unknown=await response.json().catch(()=>undefined);
    if(isRecord(raw)&&raw.api_version==="dashboard-actions-1")return adaptActionOperation(raw,intent);
    throw new ApiError("http","Action response unavailable",{status:response.status,effectUnknown:!lookup&&(!response.ok?response.status>=500: true),
      ...(isRecord(raw)&&typeof raw.message==="string"&&typeof raw.code==="string"&&typeof raw.request_id==="string"&&typeof raw.retryable==="boolean"?{envelope:raw as unknown as NonNullable<ApiError["envelope"]>}:{})});
  }catch(error){if(error instanceof ApiError||error instanceof ContractError)throw error;throw new ApiError("transport","Action outcome is not known",{effectUnknown:!lookup});}
}
