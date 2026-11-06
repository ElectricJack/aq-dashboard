import { useId, useState } from "react";
import type { SessionDetailView } from "../../../api/adapters/inspection";
import { ApiError } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { ActionButton } from "../../../components/layout/Workspace";
import { actionRequest, type ActionOperation, type FrozenAction } from "../../actions/actionClient";
import { freezeMessage, MESSAGE_MAX_BYTES, messageState, type MessageState } from "./message";
import styles from "./Operations.module.css";

type Outcome = { op: ActionOperation | null; unknown: boolean } | { state: MessageState };
function failure(error: unknown): Outcome {
  if (error instanceof ApiError && error.effectUnknown) return { op: null, unknown: true };
  if (error instanceof ApiError && error.status === 409) return { state: { kind: "not_sent", label: "Message not sent", detail: "The session changed generation. Refresh and message the current session." } };
  if (error instanceof ApiError && [400, 404, 413, 422].includes(error.status ?? 0)) return { state: { kind: "not_sent", label: "Message not sent", detail: error.envelope?.message ?? "AQ refused the message." } };
  if (error instanceof ApiError && [401, 403].includes(error.status ?? 0)) return { state: { kind: "not_sent", label: "Message not sent", detail: "Access to this session changed." } };
  if (error instanceof ContractError) return { op: null, unknown: true };
  return { state: { kind: "not_sent", label: "Message not sent", detail: error instanceof Error ? error.message : "AQ did not accept the message." } };
}

/** The session's durable Message slot (RA-14): a mailbox message through the action API, never terminal input. */
export function MessageComposer({ session: s }: { session: SessionDetailView }) {
  const [body, setBody] = useState("");
  const [frozen, setFrozen] = useState<FrozenAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = useId();
  const bytes = new TextEncoder().encode(body).length;
  const valid = body.trim().length > 0 && bytes <= MESSAGE_MAX_BYTES;
  const state = outcome ? ("state" in outcome ? outcome.state : messageState(outcome.op, outcome.unknown)) : null;
  const unresolved = state?.kind === "unknown" && frozen;
  async function send(intent: FrozenAction, lookup = false) {
    setBusy(true);
    try {
      const op = await actionRequest(intent, lookup);
      setOutcome({ op, unknown: false });
      if (op.disposition !== "unknown" && op.disposition !== "pending") { setFrozen(null); if (op.disposition === "confirmed") setBody(""); }
    } catch (error) {
      const next = failure(error);
      setOutcome(next);
      if ("state" in next) setFrozen(null);
    } finally { setBusy(false); }
  }
  return <form className={styles.nudge} onSubmit={e => { e.preventDefault(); if (!valid || busy || unresolved) return; const intent = freezeMessage(s, body); setFrozen(intent); void send(intent); }}>
    <label htmlFor={`${hint}-body`}>Message to the agent</label>
    <textarea id={`${hint}-body`} value={body} disabled={busy || !!unresolved} aria-describedby={hint} onChange={e => setBody(e.target.value)} />
    <span id={hint} className={styles.muted}>Queued in the session's mailbox, not typed into the terminal. {bytes > MESSAGE_MAX_BYTES ? `Too long (${bytes} of ${MESSAGE_MAX_BYTES} bytes).` : ""}</span>
    {!unresolved && <ActionButton type="submit" disabled={!valid || busy}>Send message</ActionButton>}
    {state && <div className={styles.status} data-kind={state.kind} role="status"><strong>{state.label}</strong><span className={styles.muted}>{state.detail}</span>
      {unresolved && <div className={styles.row}>
        <ActionButton disabled={busy} onClick={() => void send(frozen)}>Re-send same message</ActionButton>
        <ActionButton disabled={busy} onClick={() => void send(frozen, true)}>Check outcome</ActionButton>
      </div>}
    </div>}
  </form>;
}
