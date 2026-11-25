import { isRecord } from "../../api/adapters/contract";
import { validGraphId } from "../../api/adapters/humanGraph";
import { boundedString, check, text } from "./taskWorkFields";

/** The attempt holding a task, from `GET …/tasks/{t}/work` (`execution`, null when none holds it). */
export type TaskExecution = { attempt_id: string; session_id: string; status: string; ran_with?: RanWith };
/**
 * What an attempt ran with (aq-server spec 0014 §7.1): its role, the level (intelligence profile) it was given, and the
 * candidate AQ selected. Absent for an attempt from before roles.
 */
export type RanWith = { role: string; level: string; provider: string; model: string; reasoning: string; harness: string; execution_profile: string; /** Null for an attempt recorded before roles: its summary was filled from its launch record. */ snapshot_digest: string | null };
export function adaptRanWith(value: unknown): RanWith | undefined {
  if (value == null) return undefined;
  check(isRecord(value));
  // Old launch records may supply an empty field. Preserve it so the UI can show "unknown".
  const record = value;
  function field(name: keyof RanWith) {
    const reported = record[name];
    check(boundedString(reported, 256));
    return reported;
  }
  const digest = record.snapshot_digest;
  check(digest === null || boundedString(digest, 256));
  return {
    role: field("role"), level: field("level"), provider: field("provider"), model: field("model"),
    reasoning: field("reasoning"), harness: field("harness"), execution_profile: field("execution_profile"),
    snapshot_digest: digest || null,
  };
}

export function taskExecution(value: unknown): TaskExecution | null {
  if (value === null) return null;
  check(isRecord(value));
  check(validGraphId(value.attempt_id));
  check(validGraphId(value.session_id));
  check(text(value.status, 64));
  const execution: TaskExecution = { attempt_id: value.attempt_id, session_id: value.session_id, status: value.status };
  const ranWith = adaptRanWith(value.ran_with);
  if (ranWith) execution.ran_with = ranWith;
  return execution;
}
