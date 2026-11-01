import { ContractError, isRecord } from "./contract";
export type DecisionSummary = { decisionId: string; revision: number; state: string; expires: number; projectId: string; taskId: string; reportId: string; current: boolean; eligible: boolean };
export type DecisionPage = { items: DecisionSummary[]; cursor: string | null; serverTime: number };
export type DecisionDetail = DecisionSummary & { criteria: string[]; taskVersion: number; source: { base: string; result: string; repository: string }; evidence: { label: string; id: string; digest: string }[]; finality: string | null; conclusion: string | null; processOutcome: string | null };
function ensure(v: unknown): asserts v { if (!v) throw new ContractError("Invalid decision response"); }
function uuid(v: unknown): v is string { return typeof v === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(v) && !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(v); }
function positive(v: unknown): v is number { return typeof v === "number" && Number.isSafeInteger(v) && v > 0; }
function text(v: unknown, limit = 512): v is string { return typeof v === "string" && v.length > 0 && v.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v); }
const states = ["pending", "answered", "cancelled", "expired"];
function summary(v: unknown): DecisionSummary {
  ensure(isRecord(v) && uuid(v.decision_id) && positive(v.decision_revision) && states.includes(String(v.state)) && positive(v.expires_at_ms) && v.expires_at_ms <= 8640000000000000);
  ensure(uuid(v.project_id) && uuid(v.task_id) && uuid(v.report_id) && typeof v.current_report_head === "boolean" && typeof v.eligible_owner === "boolean");
  ensure((v.state === "pending") === (v.decision_revision === 1) && v.decision_revision <= 2);
  return { decisionId: v.decision_id, revision: v.decision_revision, state: String(v.state), expires: v.expires_at_ms, projectId: v.project_id, taskId: v.task_id, reportId: v.report_id, current: v.current_report_head, eligible: v.eligible_owner };
}
export function adaptDecisions(raw: unknown): DecisionPage {
  ensure(isRecord(raw) && raw.api_version === "review-inbox-1" && raw.sampled === true && positive(raw.server_time_ms) && Array.isArray(raw.items) && raw.items.length <= 50);
  ensure(raw.next_cursor === null || (typeof raw.next_cursor === "string" && raw.next_cursor.length <= 4096 && /^[0-9a-f]+$/.test(raw.next_cursor)));
  const items = raw.items.map(summary); ensure(new Set(items.map(i => i.decisionId)).size === items.length);
  return { items, cursor: raw.next_cursor, serverTime: raw.server_time_ms };
}
export function adaptDecision(raw: unknown, expected: string, actor: string): DecisionDetail {
  ensure(isRecord(raw) && isRecord(raw.request) && isRecord(raw.subject));
  const r = raw.request, s = raw.subject; ensure(r.schema_version === 1 && s.schema_version === 1 && r.decision_id === expected && Array.isArray(r.eligible_owners) && r.eligible_owners.length <= 16 && r.eligible_owners.every(uuid));
  ensure(isRecord(s.task) && isRecord(s.result) && isRecord(s.source));
  const base = summary({ ...raw, decision_id: r.decision_id, expires_at_ms: r.expires_at_ms, project_id: s.project_id, task_id: s.task.task_id, report_id: s.result.report_id, eligible_owner: r.eligible_owners.includes(actor) });
  ensure(positive(s.task.version) && Array.isArray(s.criteria) && s.criteria.length > 0 && s.criteria.length <= 32 && s.criteria.every(v => text(v)));
  ensure(isRecord(s.source.base) && isRecord(s.source.resulting_object));
  const object = (v: Record<string, unknown>) => { ensure((v.format === "sha1" && typeof v.hex === "string" && /^[0-9a-f]{40}$/.test(v.hex)) || (v.format === "sha256" && typeof v.hex === "string" && /^[0-9a-f]{64}$/.test(v.hex))); return String(v.hex); };
  ensure(uuid(s.source.repository_id));
  const evidence = [ ["Review subject", r.subject], ["Result record", s.result.record_receipt], ["Stopped receipt", s.result.stopped_receipt], ["Task context", s.task_context], ["Validation policy", s.validation_policy] ].map(([label, ref]) => {
    ensure(isRecord(ref) && text(ref.id) && text(ref.version) && typeof ref.digest === "string" && /^[0-9a-f]{64}$/.test(ref.digest));
    return { label: String(label), id: ref.id, digest: ref.digest };
  });
  let finality: string | null = null;
  if (raw.receipt !== null) {
    ensure(isRecord(raw.receipt) && raw.receipt.schema_version === 1 && raw.receipt.decision_id === expected && raw.receipt.decision_revision === 2 && positive(raw.receipt.recorded_at_ms) && isRecord(raw.receipt.finality));
    const sameRef = (a: unknown, b: unknown) => isRecord(a) && isRecord(b) && a.id === b.id && a.version === b.version && a.digest === b.digest;
    ensure(sameRef(raw.receipt.subject, r.subject) && sameRef(raw.receipt.review_policy, r.review_policy));
    ensure(raw.receipt.eligibility_project_revision === r.eligibility_project_revision && typeof raw.receipt.request_digest === "string" && /^[0-9a-f]{64}$/.test(raw.receipt.request_digest));
    const f = raw.receipt.finality; ensure(["human_answer", "expired", "cancelled"].includes(String(f.kind)));
    if (f.kind === "human_answer") ensure(["approve", "reject"].includes(String(f.choice)));
    finality = f.kind === "human_answer" ? String(f.choice) : String(f.kind);
  }
  let criteria = s.criteria as string[];
  if (raw.acceptance_criteria !== undefined) {
    ensure(Array.isArray(raw.acceptance_criteria) && raw.acceptance_criteria.length === criteria.length);
    criteria = raw.acceptance_criteria.map((c: unknown, i: number) => { ensure(isRecord(c) && c.id === (s.criteria as unknown[])[i] && text(c.text, 8192)); return c.text; });
  }
  let conclusion: string | null = null, processOutcome: string | null = null;
  if (raw.recorded_result !== undefined) {
    const r = raw.recorded_result; ensure(isRecord(r) && r.report_id === base.reportId && text(r.conclusion) && ["success", "failed", "cancelled", "expired", "unknown"].includes(String(r.process_outcome)) && positive(r.recorded_at_ms));
    conclusion = r.conclusion; processOutcome = String(r.process_outcome);
  }
  return { ...base, criteria, conclusion, processOutcome, taskVersion: s.task.version, source: { base: object(s.source.base), result: object(s.source.resulting_object), repository: s.source.repository_id }, evidence, finality };
}

export function validateAnswerReceipt(raw: unknown, decision: DecisionDetail, operation: string, choice: "approve" | "reject", actor: string) {
  ensure(isRecord(raw) && raw.schema_version === 1 && raw.decision_id === decision.decisionId && raw.decision_revision === 2 && positive(raw.recorded_at_ms));
  ensure(isRecord(raw.subject) && raw.subject.id === decision.evidence[0]?.id && raw.subject.digest === decision.evidence[0]?.digest);
  ensure(typeof raw.request_digest === "string" && /^[0-9a-f]{64}$/.test(raw.request_digest));
  ensure(isRecord(raw.finality) && raw.finality.kind === "human_answer" && raw.finality.operation_id === operation && raw.finality.choice === choice && raw.finality.owner_user_id === actor);
}
