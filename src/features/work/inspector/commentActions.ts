import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { useSession } from "../../../app/session";
import { actionRequest, type ActionOperation, type FrozenAction } from "../../actions/actionClient";

/**
 * Task comment writes (dashboard-actions-1 `task.comment.add|edit|delete`, spec 0004 §4.1). Each submission is
 * frozen once: a retry after an unknown outcome resends the identical bytes, so AQ's operation journal can
 * answer it instead of adding a second comment.
 */
export type CommentWrite =
  | { kind: "task.comment.add"; project: string; task: string; body: string }
  | { kind: "task.comment.edit"; project: string; comment: string; revision: string; body: string }
  | { kind: "task.comment.delete"; project: string; comment: string; revision: string };

export function freezeComment(write: CommentWrite): FrozenAction {
  const id = crypto.randomUUID();
  const subject = write.kind === "task.comment.add" ? { type: "task", id: write.task } : { type: "task_comment", id: write.comment, revision: write.revision };
  const payload = { operation_id: id, project_id: write.project,
    ...(write.kind !== "task.comment.add" ? { expected_revision: write.revision } : {}),
    ...(write.kind !== "task.comment.delete" ? { body: write.body } : {}) };
  const body = { operation_id: id, kind: write.kind, subject, expected_versions: write.kind === "task.comment.add" ? {} : { task_comment: write.revision }, payload };
  return Object.freeze({ id, bytes: JSON.stringify(body), kind: write.kind, subject, project: write.project });
}

export type CommentStatus = { state: "idle" } | { state: "busy" } | { state: "done" } | { state: "unknown" } | { state: "failed"; message: string; conflict?: boolean };

/** Runs one comment write to a settled outcome, reconciling an unknown one by operation lookup. */
export function useCommentWrite(onConfirmed?: () => void) {
  const cache = useQueryClient(), { queryContext, reportAccessDenied } = useSession();
  const [status, setStatus] = useState<CommentStatus>({ state: "idle" });
  const frozen = useRef<FrozenAction | null>(null), alive = useRef(true), lookups = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refresh = () => cache.invalidateQueries({ predicate: q => q.queryKey[0] === "aq" && q.queryKey[1] === queryContext.principalId && q.queryKey[4] === "task-comments" });
  async function run(lookup: boolean) {
    const intent = frozen.current; if (!intent) return;
    setStatus({ state: "busy" });
    let next: ActionOperation;
    try { next = await actionRequest(intent, lookup); }
    catch (error) {
      if (!alive.current) return;
      if (error instanceof ApiError && !error.effectUnknown && error.status && error.status < 500 && !(lookup && error.status === 404)) {
        if (error.status === 401 || error.status === 403) reportAccessDenied(error);
        // AQ's message is specific here: comment_not_author, comment_deleted, body limits.
        frozen.current = null;
        setStatus({ state: "failed", message: error.envelope?.message ? `${error.envelope.message}.`.replace(/\.\.$/, ".") : "AQ refused this comment change.", conflict: error.status === 409 });
        if (error.status === 409) void refresh();
        return;
      }
      if (error instanceof ContractError) { frozen.current = null; setStatus({ state: "failed", message: "This dashboard can't read AQ's answer. Reload the thread to see whether the change was saved." }); return; }
      setStatus({ state: "unknown" });
      return;
    }
    if (!alive.current) return;
    if (next.disposition === "confirmed") { frozen.current = null; lookups.current = 0; setStatus({ state: "done" }); await refresh(); onConfirmed?.(); return; }
    if (next.disposition === "conflict") { frozen.current = null; setStatus({ state: "failed", message: "This comment changed since you read it. The thread was reloaded; check it and try again.", conflict: true }); void refresh(); return; }
    if (next.disposition === "rejected") { frozen.current = null; setStatus({ state: "failed", message: "AQ refused this comment change." }); return; }
    setStatus({ state: "unknown" });
  }
  // Pending or unknown: look the operation up a few times, then leave it to the person (Check again).
  useEffect(() => {
    if (status.state !== "unknown" || !frozen.current || lookups.current >= 3) return;
    const t = setTimeout(() => { lookups.current++; void run(true); }, 1500 * (lookups.current + 1));
    return () => clearTimeout(t);
  });
  return {
    status,
    submit(write: CommentWrite) { if (status.state === "busy") return; lookups.current = 0; frozen.current = freezeComment(write); void run(false); },
    /** Resend the identical frozen request (never a new operation). */
    retry() { if (frozen.current && status.state !== "busy") { lookups.current = 0; void run(false); } },
    check() { if (frozen.current && status.state !== "busy") void run(true); },
    reset() { frozen.current = null; lookups.current = 0; setStatus({ state: "idle" }); },
    pending: () => !!frozen.current,
  };
}
