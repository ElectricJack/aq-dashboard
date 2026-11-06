import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../../api/client";
import { ContractError, isRecord } from "../../api/adapters/contract";
import { adaptGraphEnvelope, validGraphId } from "../../api/adapters/humanGraph";
import { graphPath } from "../../api/humanGraphReads";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";

/** The attempt holding a task, from `GET …/tasks/{t}/work` (`execution`, null when none holds it). */
export type TaskExecution = { attempt_id: string; session_id: string; status: string };
export type TaskWork = { execution: TaskExecution | null; blockers: { edge_id: string; id: string; satisfied: boolean | null }[]; complete: boolean };

function check(value: unknown): asserts value { if (!value) throw new ContractError("Invalid task work read"); }
function text(value: unknown, max: number): value is string { return typeof value === "string" && value.length > 0 && value.length <= max; }

export function adaptTaskWork(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (value): TaskWork => {
    check(isRecord(value) && value.task_id === id && isRecord(value.readiness) && Array.isArray(value.readiness.blockers) && value.readiness.blockers.length <= 64 && typeof value.readiness.complete === "boolean");
    const e = value.execution;
    check(e === null || (isRecord(e) && validGraphId(e.attempt_id) && validGraphId(e.session_id) && text(e.status, 64)));
    const blockers = value.readiness.blockers.map(b => {
      check(isRecord(b) && validGraphId(b.edge_id) && validGraphId(b.id) && (b.satisfied === null || typeof b.satisfied === "boolean"));
      return { edge_id: b.edge_id, id: b.id, satisfied: b.satisfied as boolean | null };
    });
    return { execution: e === null ? null : { attempt_id: e.attempt_id as string, session_id: e.session_id as string, status: e.status as string }, blockers, complete: value.readiness.complete };
  });
}

/** Whether an attempt holds this task; `undefined` while unknown (pending, failed or not served). */
export function useTaskWork(project: string, id: string) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "human-graph-task-work", { project, id }), enabled: validGraphId(project) && validGraphId(id), retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptTaskWork(await apiGet<unknown>(`${graphPath(project, "task", id)}/work`, signal), project, id),
  });
}

/**
 * How many agent attempts AQ has recorded for the task, from `GET …/tasks/{t}/history` (`attempts`, bounded to 16
 * with `attempts_truncated`). Only read when it decides something: an active task no attempt holds, where Retry
 * attempt is refused unless a previous attempt exists (WD-11). A shape this bundle doesn't know reads as unknown
 * (`null`), never as zero, so it can only leave Retry enabled.
 */
export function useTaskAttempts(project: string, id: string, enabled: boolean) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "human-graph-task-attempts", { project, id }), enabled: enabled && validGraphId(project) && validGraphId(id), retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }): Promise<number | null> => {
      const raw = await apiGet<unknown>(`${graphPath(project, "task", id)}/history`, signal);
      try {
        return adaptGraphEnvelope(raw, project, (value): number => {
          check(isRecord(value) && value.task_id === id && Array.isArray(value.attempts) && value.attempts.length <= 16 && typeof value.attempts_truncated === "boolean");
          check(value.attempts.every(a => isRecord(a) && validGraphId(a.attempt_id)));
          return value.attempts.length;
        }).data;
      } catch (error) { if (error instanceof ContractError) return null; throw error; }
    },
  });
}
