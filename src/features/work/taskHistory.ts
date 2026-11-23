import { useTaskPages } from "./taskGraphPanels";
import { isRecord } from "../../api/adapters/contract";
import { adaptGraphEnvelope, validGraphId } from "../../api/adapters/humanGraph";
import { boundedList, boundedString, check, cursor, openEnumValue, sequence, taskRecord, text, time } from "./taskWorkFields";
import { taskExecution, type RanWith } from "./taskExecution";

/**
 * What one history entry changed (aq-server #99), or null when AQ can't describe it. `from`/`to` are given only
 * for task state, priority, content type, retired and deleted; `complete` is false when AQ couldn't compare a
 * revision with the previous one (then `fields` is empty).
 */
export type HistoryChange = { summary: string; fields: { field: string; from: string | null; to: string | null }[]; edge: { edge_type: string; direction: "incoming" | "outgoing"; node_id: string } | null; complete: boolean };
export type HistoryEntry = { sequence: string; entry_id: string; category: "revision" | "lifecycle" | "edge"; operation: string; actor_id: string; reason: string | null; created_at: string; change: HistoryChange | null };
export type TaskAttempt = { attempt_id: string; session_id: string; holds_task: boolean; status: string; ran_with?: RanWith };
export type TaskHistoryPage = { items: HistoryEntry[]; next_cursor: string | null; attempts: TaskAttempt[]; attempts_truncated: boolean };

function changeField(value: unknown): HistoryChange["fields"][number] {
  check(isRecord(value));
  check(openEnumValue(value.field));
  check(value.from === null || boundedString(value.from, 64));
  check(value.to === null || boundedString(value.to, 64));
  return { field: value.field, from: value.from, to: value.to };
}

function changeEdge(value: unknown): HistoryChange["edge"] {
  if (value === null) return null;
  check(isRecord(value));
  check(text(value.edge_type, 64));
  check(value.direction === "incoming" || value.direction === "outgoing");
  check(validGraphId(value.node_id));
  return { edge_type: value.edge_type, direction: value.direction, node_id: value.node_id };
}

/** Missing change details in records from older servers read as null. */
export function adaptHistoryChange(value: unknown): HistoryChange | null {
  if (value == null) return null;
  check(isRecord(value));
  check(boundedString(value.summary, 512));
  check(boundedList(value.fields, 16));
  check(typeof value.complete === "boolean");
  return { summary: value.summary, fields: value.fields.map(changeField), edge: changeEdge(value.edge), complete: value.complete };
}

function historyEntry(value: unknown): HistoryEntry {
  check(isRecord(value));
  check(sequence(value.sequence));
  check(validGraphId(value.entry_id));
  check(["revision", "lifecycle", "edge"].includes(value.category as string));
  check(text(value.operation, 128));
  check(text(value.actor_id, 512));
  check(value.reason === null || boundedString(value.reason, 4096));
  check(time(value.created_at));
  return {
    sequence: value.sequence, entry_id: value.entry_id, category: value.category as HistoryEntry["category"],
    operation: value.operation, actor_id: value.actor_id, reason: value.reason, created_at: value.created_at, change: adaptHistoryChange(value.change),
  };
}

function taskAttempt(raw: unknown): TaskAttempt {
  const value = taskExecution(raw);
  check(value !== null && isRecord(raw));
  check(typeof raw.holds_task === "boolean");
  return { ...value, holds_task: raw.holds_task };
}

export function adaptTaskHistory(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (data): TaskHistoryPage => {
    const value = taskRecord(data, id);
    check(boundedList(value.items, 25));
    check(boundedList(value.attempts, 16));
    check(typeof value.attempts_truncated === "boolean");
    const attempts = value.attempts.map(taskAttempt);
    check(new Set(attempts.map(attempt => attempt.attempt_id)).size === attempts.length);
    return { items: value.items.map(historyEntry), next_cursor: cursor(value.next_cursor), attempts, attempts_truncated: value.attempts_truncated };
  });
}

/** Graph history is oldest first, 25 per page; reading to the newest entry is bounded to this many pages. */
export const HISTORY_MAX_PAGES = 12;

/**
 * `GET …/tasks/{t}/history`, one page at a time. The first page also carries the task's attempts (up to 16,
 * the holding attempt first), so the Attempts section, the History section and Retry attempt's precondition
 * share one read. Further pages are read only when History is open.
 */
export function useTaskHistory(project: string, id: string, enabled = true) {
  return useTaskPages({ project, id }, {
    key: "human-graph-task-history", section: "history", adapt: adaptTaskHistory, maxPages: HISTORY_MAX_PAGES, enabled,
  });
}
