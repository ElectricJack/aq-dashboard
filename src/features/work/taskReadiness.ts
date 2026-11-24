import { useTaskPanel } from "./taskGraphPanels";
import { isRecord } from "../../api/adapters/contract";
import { adaptGraphEnvelope, adaptGraphParent, validGraphId, type GraphParent } from "../../api/adapters/humanGraph";
import { boundedList, boundedString, check, openEnumValue, taskRecord, text } from "./taskWorkFields";
import { taskExecution, type TaskExecution } from "./taskExecution";
import { adaptTaskRouting, type TaskRouting } from "./taskRouting";

/** The role a task runs as (spec 0014 §5.5): the one the task names, or the project's default when it names none. */
export type TaskRole = { id: string; source: "task" | "project_default" };
/** Absent from a server that predates roles. */
export function adaptTaskRole(v: unknown): TaskRole | undefined {
  if (v === undefined) return undefined;
  check(isRecord(v));
  check(text(v.id, 128));
  check(v.source === "task" || v.source === "project_default");
  return { id: v.id, source: v.source };
}
/** The readiness states this bundle knows (human-graph-1 X8; `held` since aq-server #99, QA P1-01). */
export const READINESS_STATES = ["draft", "completed", "canceled", "running", "held", "waiting", "unknown", "ready"] as const;
/** A known readiness state, or `unrecognized` for a value a newer server sends that this bundle doesn't know (W77). */
export type WorkReadiness = (typeof READINESS_STATES)[number] | "unrecognized";
/** A stopped attempt's recorded result and its delivery or Graph settlement: they name the attempt and its result, no status. */
const RESULT_CODES = ["result_ready_no_delivery_policy", "result_ready", "delivery_settlement_pending", "delivery_settlement_grant_required", "replacement_facts_pending", "replacement_facts_ready", "graph_completion_identity_required", "graph_completion_permission_required", "graph_version_conflict", "graph_completion_receipt_conflict", "graph_completion_receipt_pending"];
/** The recovery a stopped or closed attempt waits for, or the backoff after repeated launch failures (aq-server #271): they name the attempt, no status. */
const RECOVERY_CODES = ["closure_does_not_prove_nonstart", "closed_launch_settlement_pending", "stopped_result_recovery_pending", "launch_retry_backoff"] as const;
/** Codes AQ gives for a hold; a newer code is kept as reported and its message still shown. */
export const HOLD_REASON_CODES = ["cancelled_attempt_holds_task", "attempt_stopped_not_released", "attempt_finished_stop_unconfirmed", "task_held", "role_disabled", "role_missing", "level_missing", "startup_over_limit", "platform_text_missing", "owner_retry_pending", ...RECOVERY_CODES] as const;
/**
 * The startup text of a refused offer (`startup_over_limit`, aq-server spec 0014 §6.1): it is `bytes` long, over `limit`,
 * the smaller of the execution profile's `startup_context_bytes` and the project's `context_bytes` ceiling; `limiting`
 * says which of the two.
 */
export type StartupOverLimit = { bytes: number; limit: number; execution_profile: string; limiting: "startup_context_bytes" | "project_context_bytes" };
/**
 * Why AQ is not running the task (`readiness.reasons`, at most 8). A stopped or finished attempt that still holds it
 * names that attempt (`attempt_id`, `status`). A role hold (`role_disabled`, `role_missing`) names the `role` and a
 * level hold (`level_missing`) the `level`; those have no attempt. Nor has a refused offer: `startup_over_limit` carries
 * its two numbers (`startup`), `platform_text_missing` the `environment`.
 */
export type HoldReason = { code: string; message: string; attempt_id?: string; status?: string; result_id?: string; hold_reason?: string; role?: string; level?: string; startup?: StartupOverLimit; environment?: string };
const bytes = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
/** The numbers of a `startup_over_limit` reason; a reason without them all still shows its message. */
function startupOverLimit(r: Record<string, unknown>): StartupOverLimit | undefined {
  if (r.code !== "startup_over_limit") return undefined;
  if (!bytes(r.bytes) || !bytes(r.limit)) return undefined;
  if (!text(r.execution_profile, 128)) return undefined;
  return { bytes: r.bytes, limit: r.limit, execution_profile: r.execution_profile, limiting: r.limiting === "project_context_bytes" ? "project_context_bytes" : "startup_context_bytes" };
}
/** `satisfied` is true only for a completed blocker, null when the blocker isn't in the read Context. */
export type TaskBlocker = { edge_id: string; id: string; title: string | null; task_state: string | null; satisfied: boolean | null };
/** `reported` is the server's readiness value as sent: for `unrecognized`, the value to show. */
export type TaskWork = { state: WorkReadiness; reported: string; role?: TaskRole; reasons: HoldReason[]; execution: TaskExecution | null; blockers: TaskBlocker[]; complete: boolean; parent: GraphParent | null; routing?: TaskRouting;
  /** AQ's default policy completed the task and found no file change (`completed_without_changes`, owner ruling 4b). */
  noChanges?: true };

function reasonAttempt(raw: Record<string, unknown>, reason: HoldReason) {
  const result = RESULT_CODES.includes(reason.code);
  if (result || (RECOVERY_CODES as readonly string[]).includes(reason.code)) {
    check(validGraphId(raw.attempt_id));
    check(raw.status === undefined);
    reason.attempt_id = raw.attempt_id;
    if (result) {
      check(validGraphId(raw.result_id));
      reason.result_id = raw.result_id;
    }
  } else if (reason.code === "owner_retry_pending") {
    // The owner's retry may name the attempt it retries, or null.
    check(raw.status === undefined);
    if (raw.attempt_id !== null && raw.attempt_id !== undefined) {
      check(validGraphId(raw.attempt_id));
      reason.attempt_id = raw.attempt_id;
    }
  } else if (raw.attempt_id === undefined) {
    check(raw.status === undefined);
  } else {
    check(validGraphId(raw.attempt_id));
    check(text(raw.status, 64));
    reason.attempt_id = raw.attempt_id;
    reason.status = raw.status;
  }
}

const REASON_TEXT_LIMITS = { hold_reason: 96, role: 128, level: 128 } as const;

function reasonDetails(raw: Record<string, unknown>, reason: HoldReason) {
  for (const key of Object.keys(REASON_TEXT_LIMITS) as (keyof typeof REASON_TEXT_LIMITS)[]) {
    const value = raw[key];
    if (value === undefined || (value === null && raw.code === "owner_retry_pending")) continue;
    check(text(value, REASON_TEXT_LIMITS[key]));
    reason[key] = value;
  }
  const startup = startupOverLimit(raw);
  if (startup) reason.startup = startup;
  if (raw.code === "platform_text_missing" && text(raw.environment, 512)) reason.environment = raw.environment;
}

function holdReason(raw: unknown): HoldReason {
  check(isRecord(raw));
  check(openEnumValue(raw.code));
  check(text(raw.message, 512));
  const reason: HoldReason = { code: raw.code, message: raw.message };
  reasonAttempt(raw, reason);
  reasonDetails(raw, reason);
  return reason;
}

function taskBlocker(value: unknown): TaskBlocker {
  check(isRecord(value));
  check(validGraphId(value.edge_id));
  check(validGraphId(value.id));
  check(value.satisfied === null || typeof value.satisfied === "boolean");
  const title = value.title ?? null, taskState = value.task_state ?? null;
  check(title === null || boundedString(title, 1024));
  check(taskState === null || ["draft", "active", "completed", "canceled"].includes(taskState as string));
  return { edge_id: value.edge_id, id: value.id, title, task_state: taskState as string | null, satisfied: value.satisfied };
}

function knownReadiness(reported: string): WorkReadiness {
  return (READINESS_STATES as readonly string[]).includes(reported) ? reported as WorkReadiness : "unrecognized";
}

function readiness(raw: unknown) {
  check(isRecord(raw));
  check(boundedList(raw.blockers, 64));
  check(typeof raw.complete === "boolean");
  // An older server omits state and reasons.
  const { state: reported = "unknown", reasons = [] } = raw;
  check(openEnumValue(reported));
  check(boundedList(reasons, 8));
  return { state: knownReadiness(reported), reported, reasons: reasons.map(holdReason), blockers: raw.blockers.map(taskBlocker), complete: raw.complete };
}

export function adaptTaskWork(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (data): TaskWork => {
    const value = taskRecord(data, id);
    const ready = readiness(value.readiness);
    const route = adaptTaskRouting(value.routing), role = adaptTaskRole(value.role);
    check(value.completed_without_changes === undefined || value.completed_without_changes === true);
    const work: TaskWork = { ...ready, execution: taskExecution(value.execution), parent: adaptGraphParent(value.parent) };
    if (route) work.routing = route;
    if (role) work.role = role;
    if (value.completed_without_changes && work.state === "completed") work.noChanges = true;
    return work;
  });
}

/** Readiness, blockers, parent and the holding attempt; `undefined` while unknown (pending, failed or not served). */
export function useTaskWork(project: string, id: string, refetchInterval?: number) {
  return useTaskPanel({ project, id }, { key: "human-graph-task-work", section: "work", adapt: adaptTaskWork, enabled: true, refetchInterval });
}
