export const decisionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const reviewRef = (id: string) => ({ id, version: "1", digest: "a".repeat(64) });
export function decisionDetail() {
  return { request: { schema_version: 1, decision_id: decisionId(1), operation_id: decisionId(2), subject: reviewRef("review-subject"), eligible_owners: [decisionId(9)], expires_at_ms: 100000, eligibility_project_revision: 1, review_policy: reviewRef("policy") },
    subject: { schema_version: 1, project_id: decisionId(3), task: { workspace_id: decisionId(8), task_id: decisionId(4), version: 3, content_revision: 2 }, result: { report_id: decisionId(5), record_receipt: reviewRef("result-record"), stopped_receipt: reviewRef("stopped-record") }, source: { repository_id: decisionId(6), base: { format: "sha1", hex: "a".repeat(40) }, resulting_object: { format: "sha1", hex: "b".repeat(40) } }, task_context: reviewRef("task-context"), validation_policy: reviewRef("policy"), criteria: ["Recovery tests retained", "Source evidence reviewed"] },
    decision_revision: 1, state: "pending", current_report_head: true, receipt: null };
}
export function decisionPage() { return { api_version: "review-inbox-1", server_time_ms: 10000, sampled: true, next_cursor: null, items: [{ decision_id: decisionId(1), decision_revision: 1, state: "pending", expires_at_ms: 100000, project_id: decisionId(3), task_id: decisionId(4), report_id: decisionId(5), current_report_head: true, eligible_owner: true }] }; }
