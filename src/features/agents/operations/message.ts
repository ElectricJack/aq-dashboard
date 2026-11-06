import type { ActionKind, ActionOperation, FrozenAction } from "../../actions/actionClient";
import type { SessionDetailView } from "../../../api/adapters/inspection";

/** Bootstrap capability and per-session permission for the durable Message slot (`session.message.send`). */
export const MESSAGE_CAPABILITY = "session.message.enqueue";
export const MESSAGE_PERMISSION = "session.message.send";
export const MESSAGE_MAX_BYTES = 16384;

/** Why Message can't be used for this session, or null when it can. The server decides delivery. */
export function messageUnavailable(session: Pick<SessionDetailView, "permissions" | "generation">, capability: { enabled: boolean; reason?: string }): string | null {
  if (!capability.enabled) return capability.reason ?? "Session messages aren't offered by this AQ server";
  if (!session.permissions.includes(MESSAGE_PERMISSION)) return "This session doesn't accept messages";
  if (!session.generation) return "This session has no assignment generation to address a message to";
  return null;
}

/** One durable mailbox message (G1a action `session.message.send`). Frozen once, so a re-send after an
 * unknown outcome repeats the same operation and message id; it is never typed into the terminal. */
export function freezeMessage(session: Pick<SessionDetailView, "id" | "project" | "generation">, body: string): FrozenAction {
  if (!session.generation) throw new Error("This session has no assignment generation.");
  const id = crypto.randomUUID(), message = crypto.randomUUID(), generation = session.generation;
  const subject = { type: "session", id: session.id, revision: generation };
  const bytes = JSON.stringify({ operation_id: id, kind: "session.message.send", subject, expected_versions: { session: generation },
    payload: { operation_id: id, project_id: session.project.id, message_id: message, expected_generation: generation, body } });
  return Object.freeze({ id, bytes, kind: "session.message.send" as ActionKind, subject });
}

export type MessageState = { kind: "queued" | "unknown" | "not_sent"; label: string; detail: string };
/** Confirmation means queued in the session's mailbox, nothing more; delivery isn't reported. */
export function messageState(op: ActionOperation | null, unknown: boolean): MessageState {
  if (unknown || !op || op.disposition === "unknown") return { kind: "unknown", label: "Message outcome unknown", detail: "AQ may or may not have queued it. Check the outcome or re-send the same message; it is never queued twice." };
  if (op.disposition === "pending") return { kind: "queued", label: "Message pending", detail: "AQ is recording the message." };
  if (op.disposition === "conflict") return { kind: "not_sent", label: "Message not sent", detail: "The session changed generation. Refresh and message the current session." };
  if (op.disposition === "rejected") return { kind: "not_sent", label: "Message not sent", detail: "AQ refused the message. The session may no longer have a mailbox to receive it." };
  return { kind: "queued", label: "Message queued", detail: "Queued in the session's mailbox. The agent reads it at its next mailbox check; delivery isn't reported here." };
}
