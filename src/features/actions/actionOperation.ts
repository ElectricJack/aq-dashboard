import { boundedList, ContractError, isRecord, nullable, optional } from "../../api/adapters/contract";
import { validGraphId } from "../../api/adapters/humanGraph";

/** `kind` is a union kind name; feature modules (for example playbooks) freeze their own kinds through the same transport. */
/** `project` is the expected operation scope when the kind's payload carries no `project_id` (for example `question.answer`). */
export type FrozenAction = Readonly<{ id: string; bytes: string; kind: string; subject: {type:string;id:string;revision?:string}; project?: string }>;
export type EntityRef = {type:string;id:string;revision?:string|null};
export type ActionOperation = {
  operation_id:string; disposition:"pending"|"confirmed"|"conflict"|"rejected"|"unknown";
  request_digest:string; subject_refs:EntityRef[]; receipt_refs:EntityRef[]; affected_entities:EntityRef[];
  current_versions?:Record<string,string>; recovery:string;
  /** A `rejected` operation's reason code, when its domain owner names one (`busy`: nothing changed, a new submission may succeed). */
  reason?:string;
  activation?: { activated: number; skipped: number };
};

const revision = (value: unknown) => typeof value === "string" && /^[1-9][0-9]{0,39}$/.test(value);
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const shortString = (value: unknown, max: number) => typeof value === "string" && value.length <= max;

function entityRef(value: unknown) {
  if (!isRecord(value)) return false;
  const hasIdentity = shortString(value.type, 64) && shortString(value.id, 128);
  return hasIdentity && optional(value.revision, item => nullable(item, revision));
}

function validScope(scope: unknown, intent: FrozenAction) {
  if (!isRecord(scope)) return false;
  if (scope.kind === "all_authorized") return true;
  if (scope.kind !== "project") return false;
  return scope.project_id === (intent.project ?? JSON.parse(intent.bytes).payload.project_id);
}

function versionMap(value: unknown) {
  if (!isRecord(value)) return false;
  return Object.keys(value).length <= 32 && Object.values(value).every(revision);
}

function validReason(value: unknown, disposition: unknown) {
  if (value == null) return true;
  if (disposition !== "rejected") return false;
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

function validOperationIdentity(raw: Record<string, unknown>, intent: FrozenAction) {
  if (raw.operation_id !== intent.id || !validGraphId(raw.operation_id)) return false;
  return typeof raw.request_digest === "string" && /^sha256:[a-f0-9]{64}$/.test(raw.request_digest);
}

function validLifecycle(raw: Record<string, unknown>) {
  const disposition = ["pending", "confirmed", "conflict", "rejected", "unknown"].includes(String(raw.disposition));
  const recovery = ["none", "lookup_original", "refresh_and_review"].includes(String(raw.recovery));
  return disposition && recovery;
}

function referenceLists(raw: Record<string, unknown>): raw is Record<string, unknown> & Pick<ActionOperation, "subject_refs" | "receipt_refs" | "affected_entities"> {
  return boundedList(raw.subject_refs, 1, entityRef) && boundedList(raw.receipt_refs, 100, entityRef) && boundedList(raw.affected_entities, 100, entityRef);
}

function activationCounts(raw: unknown, count: number) {
  if (!isRecord(raw) || raw.activated !== count) return false;
  const skipped = raw.skipped;
  return typeof skipped === "number" && Number.isSafeInteger(skipped) && skipped >= 0;
}

function requireField(valid: boolean): void {
  if (!valid) throw new ContractError("Invalid action operation");
}

function requireActivation(action: ActionOperation, kind: string) {
  if (action.activation === undefined) return;
  const confirmedSubtree = kind === "task.activate.subtree" && action.disposition === "confirmed";
  if (!confirmedSubtree || !activationCounts(action.activation, action.affected_entities.length)) {
    throw new ContractError("Invalid activation counts");
  }
}

function verifyBinding(action: ActionOperation, intent: FrozenAction) {
  const changed = action.subject_refs.some(ref => ref.type !== intent.subject.type || ref.id !== intent.subject.id);
  if (changed) throw new ContractError("Action subject changed");
  requireActivation(action, intent.kind);
  if (action.disposition === "confirmed" && !action.receipt_refs.length) throw new ContractError("Confirmation has no receipt");
}

function unwrap(raw: unknown) {
  if (isRecord(raw) && raw.api_version === "dashboard-actions-1") {
    if (isRecord(raw.data)) return raw.data;
  }
  throw new ContractError("Unsupported action response");
}

export function adaptActionOperation(raw: unknown, intent: FrozenAction): ActionOperation {
  const action = unwrap(raw);
  requireField(validOperationIdentity(action, intent));
  requireField(validLifecycle(action));
  requireField(referenceLists(action));
  requireField(date(action.created_at) && date(action.updated_at));
  requireField(validScope(action.scope, intent));
  requireField(optional(action.current_versions, versionMap));
  requireField(validReason(action.reason, action.disposition));
  const operation = action as unknown as ActionOperation;
  verifyBinding(operation, intent);
  return operation;
}
