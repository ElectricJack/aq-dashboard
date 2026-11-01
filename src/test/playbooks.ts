export const PLAYBOOK_NAMESPACE = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", generation: "1", name: "Project coding policy", project_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
export const PLAYBOOK_TIME = 1793448000000;
export function runRecord(id = "run-0000000000000001", status = "waiting") { return { id, artifact: `sha256:${"a".repeat(64)}`, entry: "main", step: "request-review", status, outcome: null, reason: null, root: id, parent: null, children: [] as string[], dependencies: { checks: `sha256:${"b".repeat(64)}` }, pending_kind: "effect", admitted_at_ms: PLAYBOOK_TIME - 5000 }; }
export function playbookPage<T>(items: T[], next_cursor: string | null = null) { return { api_version: "playbooks-inspection-1", namespace: PLAYBOOK_NAMESPACE, server_time_ms: PLAYBOOK_TIME, revision: "9007199254740993", items, next_cursor }; }
export function runDetail(id = "run-0000000000000001") { return { api_version: "playbooks-inspection-1", namespace: PLAYBOOK_NAMESPACE, server_time_ms: PLAYBOOK_TIME, observation_is_atomic: false,
  run: runRecord(id), effects: playbookPage([{ id: "op-1", step: "request-review", command: "decision.request", status: "accepted", deadline_at_ms: PLAYBOOK_TIME + 5000, cancel_requested: false }]), receipts: playbookPage([
    { sequence: "9007199254740992", step: "inspect", at_ms: PLAYBOOK_TIME - 4000, kind: "command_result", operation: "op-0", outcome: "ok", child: null },
    { sequence: "9007199254740993", step: "request-review", at_ms: PLAYBOOK_TIME - 1000, kind: "operation_accepted", operation: "op-1", outcome: null, child: null },
  ]) }; }
