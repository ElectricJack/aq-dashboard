import type { ActionKind, ActionOperation, FrozenAction } from "../../actions/actionClient";
import type { SessionDetailView } from "../../../api/adapters/inspection";

export const NUDGE_PERMISSION = "session.nudge";
export const NUDGE_MAX_BYTES = 16384;

/** H3 owner nudge (`session.nudge` via the G1a action API). The bytes are frozen once so a
 * re-send after an unknown outcome is the same operation; AQ, not the dashboard, decides
 * whether it is injected at a safe boundary or held in the inbox. It never types into the pane. */
export function freezeNudge(session: Pick<SessionDetailView, "id" | "project" | "generation">, body: string): FrozenAction {
  if (!session.generation) throw new Error("This session has no assignment generation to nudge.");
  const id = crypto.randomUUID(), generation = session.generation;
  const subject = { type: "session", id: session.id, revision: generation };
  const bytes = JSON.stringify({ operation_id: id, kind: "session.nudge", subject, expected_versions: { session: generation },
    payload: { operation_id: id, project_id: session.project.id, expected_generation: generation, body } });
  return Object.freeze({ id, bytes, kind: "session.nudge" as ActionKind, subject });
}

export type NudgeState = { kind: "queued" | "deferred" | "delivered" | "unknown" | "unsupported" | "not_sent"; label: string; detail: string };

export function nudgeUnsupported(session: Pick<SessionDetailView, "permissions" | "generation">): NudgeState | null {
  if (!session.permissions.includes(NUDGE_PERMISSION)) return { kind: "unsupported", label: "Nudge unsupported", detail: "This session has no bound mailbox for nudges on this AQ server." };
  if (!session.generation) return { kind: "unsupported", label: "Nudge unsupported", detail: "The session identity has no assignment generation." };
  return null;
}

/** The action receipt reports acceptance, not harness delivery; delivery is never claimed here. */
export function nudgeState(op: ActionOperation | null, unknown: boolean, controller: SessionDetailView["controller"]): NudgeState {
  if (unknown || !op || op.disposition === "unknown") return { kind: "unknown", label: "Nudge outcome unknown", detail: "AQ may or may not have recorded it. Check the outcome or re-send the same nudge; it is never sent twice." };
  if (op.disposition === "pending") return { kind: "queued", label: "Nudge queued", detail: "AQ is recording the nudge." };
  if (op.disposition === "conflict") return { kind: "not_sent", label: "Nudge not sent", detail: "The session changed generation. Refresh and nudge the current session." };
  if (op.disposition === "rejected") return { kind: "not_sent", label: "Nudge not sent", detail: "AQ rejected the nudge for this session." };
  if (controller.state === "held") return { kind: "deferred", label: "Nudge deferred", detail: "A human controls the pane, so AQ holds the nudge in the session inbox and does not inject it." };
  return { kind: "queued", label: "Nudge queued", detail: "AQ delivers it at the next safe boundary, or holds it in the inbox if terminal input is unknown. Delivery is not reported by this AQ server." };
}
