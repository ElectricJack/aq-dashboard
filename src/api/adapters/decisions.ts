import { canonicalUuid, positiveInteger, timestampMs, boundedList, ContractError, isRecord } from "./contract";
export type DecisionSummary = { decisionId: string; revision: number; state: string; expires: number; projectId: string; taskId: string; reportId: string; current: boolean; eligible: boolean };
export type DecisionPage = { items: DecisionSummary[]; cursor: string | null; serverTime: number };
export type DecisionDetail = DecisionSummary & { criteria: string[]; taskVersion: number; source: { base: string; result: string; repository: string }; evidence: { label: string; id: string; digest: string }[]; finality: string | null; conclusion: string | null; processOutcome: string | null };
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid decision response"); }
function text(v: unknown, limit = 512): v is string { return typeof v === "string" && v.length > 0 && v.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v); }
const states = ["pending", "answered", "cancelled", "expired"];
function summary(v: unknown): DecisionSummary {
  ensure(isRecord(v));
  ensure(canonicalUuid(v.decision_id));
  ensure(positiveInteger(v.decision_revision));
  ensure(states.includes(String(v.state)) && timestampMs(v.expires_at_ms));
  ensure(canonicalUuid(v.project_id));
  ensure(canonicalUuid(v.task_id));
  ensure(canonicalUuid(v.report_id));
  ensure(typeof v.current_report_head === "boolean");
  ensure(typeof v.eligible_owner === "boolean");
  ensure((v.state === "pending") === (v.decision_revision === 1) && v.decision_revision <= 2);
  return { decisionId: v.decision_id, revision: v.decision_revision, state: String(v.state), expires: v.expires_at_ms, projectId: v.project_id, taskId: v.task_id, reportId: v.report_id, current: v.current_report_head, eligible: v.eligible_owner };
}
function validCursor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= 4096 && /^[0-9a-f]+$/.test(value));
}

export function adaptDecisions(raw: unknown, project?: string): DecisionPage {
  ensure(isRecord(raw));
  ensure(raw.api_version === "review-inbox-1" && raw.sampled === true);
  ensure(positiveInteger(raw.server_time_ms));
  ensure(Array.isArray(raw.items) && raw.items.length <= 50);
  ensure(validCursor(raw.next_cursor));
  const items = raw.items.map(summary);
  ensure(new Set(items.map(i => i.decisionId)).size === items.length);
  ensure(!project || items.every(i => i.projectId === project));
  return { items, cursor: raw.next_cursor, serverTime: raw.server_time_ms };
}

function digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function gitObject(value: unknown): string {
  ensure(isRecord(value) && typeof value.hex === "string");
  if (value.format === "sha1") ensure(/^[0-9a-f]{40}$/.test(value.hex));
  else ensure(value.format === "sha256" && digest(value.hex));
  return value.hex;
}

function decisionSource(value: unknown): DecisionDetail["source"] {
  ensure(isRecord(value) && canonicalUuid(value.repository_id));
  return { repository: value.repository_id, base: gitObject(value.base), result: gitObject(value.resulting_object) };
}

function evidenceRef(label: string, value: unknown) {
  ensure(isRecord(value));
  ensure(text(value.id) && text(value.version) && digest(value.digest));
  return { label, id: value.id, digest: value.digest };
}

function sameRef(a: unknown, b: unknown) {
  if (!isRecord(a) || !isRecord(b)) return false;
  return ["id", "version", "digest"].every(key => a[key] === b[key]);
}

function receiptFinality(value: unknown, request: Record<string, unknown>, base: DecisionSummary): string | null {
  ensure((base.state === "pending") === (value === null));
  if (value === null) return null;
  ensure(isRecord(value) && value.schema_version === 1);
  ensure(value.decision_id === base.decisionId && value.decision_revision === base.revision && base.revision === 2);
  ensure(positiveInteger(value.recorded_at_ms));
  ensure(isRecord(value.finality));
  ensure(sameRef(value.subject, request.subject));
  ensure(sameRef(value.review_policy, request.review_policy));
  ensure(value.eligibility_project_revision === request.eligibility_project_revision && digest(value.request_digest));
  const finality = value.finality;
  ensure(["human_answer", "expired", "cancelled"].includes(String(finality.kind)));
  if (finality.kind !== "human_answer") return String(finality.kind);
  ensure(["approve", "reject"].includes(String(finality.choice)));
  return String(finality.choice);
}

function decisionCriteria(criteria: unknown, labels: unknown): string[] {
  ensure(boundedList(criteria, 32, value => text(value)) && criteria.length > 0);
  if (labels === undefined) return criteria as string[];
  ensure(Array.isArray(labels) && labels.length === criteria.length);
  return labels.map((label, i) => {
    ensure(isRecord(label) && label.id === criteria[i] && text(label.text, 8192));
    return label.text;
  });
}

function recordedResult(value: unknown, reportId: string) {
  if (value === undefined) return { conclusion: null, processOutcome: null };
  ensure(isRecord(value) && value.report_id === reportId);
  ensure(text(value.conclusion));
  ensure(positiveInteger(value.recorded_at_ms));
  const processOutcome = String(value.process_outcome);
  ensure(["success", "failed", "cancelled", "expired", "unknown"].includes(processOutcome));
  return { conclusion: value.conclusion, processOutcome };
}

export function adaptDecision(raw: unknown, expected: string, actor: string): DecisionDetail {
  ensure(isRecord(raw));
  ensure(isRecord(raw.request));
  ensure(isRecord(raw.subject));
  const r = raw.request, s = raw.subject;
  ensure(r.schema_version === 1 && s.schema_version === 1 && r.decision_id === expected);
  ensure(boundedList(r.eligible_owners, 16, canonicalUuid));
  ensure(isRecord(s.task));
  ensure(positiveInteger(s.task.version));
  ensure(isRecord(s.result));
  const base = summary({
    ...raw, decision_id: r.decision_id, expires_at_ms: r.expires_at_ms, project_id: s.project_id,
    task_id: s.task.task_id, report_id: s.result.report_id, eligible_owner: r.eligible_owners.includes(actor),
  });
  return {
    ...base, criteria: decisionCriteria(s.criteria, raw.acceptance_criteria),
    ...recordedResult(raw.recorded_result, base.reportId), taskVersion: s.task.version,
    source: decisionSource(s.source), finality: receiptFinality(raw.receipt, r, base),
    evidence: [
      evidenceRef("Review subject", r.subject), evidenceRef("Result record", s.result.record_receipt),
      evidenceRef("Stopped receipt", s.result.stopped_receipt), evidenceRef("Task context", s.task_context),
      evidenceRef("Validation policy", s.validation_policy),
    ],
  };
}

export function validateAnswerReceipt(raw: unknown, decision: DecisionDetail, operation: string, choice: "approve" | "reject", actor: string) {
  ensure(isRecord(raw) && raw.schema_version === 1 && raw.decision_id === decision.decisionId && raw.decision_revision === 2 && positiveInteger(raw.recorded_at_ms));
  ensure(isRecord(raw.subject) && raw.subject.id === decision.evidence[0]?.id && raw.subject.digest === decision.evidence[0]?.digest);
  ensure(digest(raw.request_digest));
  ensure(isRecord(raw.finality) && raw.finality.kind === "human_answer" && raw.finality.operation_id === operation && raw.finality.choice === choice && raw.finality.owner_user_id === actor);
}
