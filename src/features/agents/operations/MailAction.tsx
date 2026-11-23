import { useId, useState } from "react";
import { ApiError } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { ActionButton } from "../../../components/layout/Workspace";
import { actionRequest, type ActionOperation, type FrozenAction } from "../../actions/actionClient";
import type { MessageState } from "./message";
import type { NudgeState } from "./nudge";
import styles from "./Operations.module.css";

type Status = MessageState | NudgeState;
type Outcome = { op: ActionOperation | null; unknown: boolean } | { state: Status };
type Kind = "message" | "nudge";
const labels = {
  message: { input: "Message to the agent", explanation: "Queued in the session's mailbox, not typed into the terminal.", refused: "AQ refused the message.", failed: "Message not sent" },
  nudge: { input: "Nudge message", explanation: "Sent to the session mailbox, not typed into the terminal.", refused: "AQ rejected the nudge.", failed: "Nudge not sent" },
};
type Props = {
  kind: Kind;
  maxBytes: number;
  freeze(body: string): FrozenAction;
  describe(op: ActionOperation | null, unknown: boolean): Status;
  unsupported?: Status | null;
};

function refusedReason(kind: Kind, error: ApiError): string {
  if (error.status === 409) return `The session changed generation. Refresh and ${kind} the current session.`;
  if ([400, 404, 413, 422].includes(error.status ?? 0)) return error.envelope?.message ?? labels[kind].refused;
  if ([401, 403].includes(error.status ?? 0)) return "Access to this session changed.";
  return error.message;
}

function failure(kind: Kind, error: unknown): Outcome {
  const unknownEffect = error instanceof ApiError && error.effectUnknown;
  if (error instanceof ContractError || unknownEffect) return { op: null, unknown: true };
  const detail = error instanceof ApiError ? refusedReason(kind, error) : error instanceof Error ? error.message : `AQ did not accept the ${kind}.`;
  return { state: { kind: "not_sent", label: labels[kind].failed, detail } };
}

function draftState(body: string, maxBytes: number, locked: boolean) {
  const bytes = new TextEncoder().encode(body).length;
  const valid = body.trim().length > 0 && bytes <= maxBytes;
  return { bytes, canSubmit: valid && !locked };
}

function currentState(outcome: Outcome | null, describe: Props["describe"]) {
  if (!outcome) return null;
  return "state" in outcome ? outcome.state : describe(outcome.op, outcome.unknown);
}

function awaitingReceipt(op: ActionOperation) {
  return op.disposition === "unknown" || op.disposition === "pending";
}

function useMailAction(props: Props) {
  const [body, setBody] = useState("");
  const [frozen, setFrozen] = useState<FrozenAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const state = currentState(outcome, props.describe);
  const unresolved = state?.kind === "unknown" && frozen;

  async function send(intent: FrozenAction, lookup = false) {
    setBusy(true);
    try {
      const op = await actionRequest(intent, lookup);
      setOutcome({ op, unknown: false });
      if (awaitingReceipt(op)) return;
      setFrozen(null);
      if (op.disposition === "confirmed") setBody("");
    } catch (error) {
      const next = failure(props.kind, error);
      setOutcome(next);
      if ("state" in next) setFrozen(null);
    } finally { setBusy(false); }
  }
  const { bytes, canSubmit } = draftState(body, props.maxBytes, busy || !!unresolved);
  function submit() {
    if (!canSubmit) return;
    const intent = props.freeze(body);
    setFrozen(intent);
    void send(intent);
  }
  return { body, setBody, bytes, busy, canSubmit, state, unresolved, send, submit };
}

/** Both mailbox operations retain the frozen request on an unknown outcome, including across retries and lookups. */
export function MailAction(props: Props) {
  const { body, setBody, bytes, busy, canSubmit, state, unresolved, send, submit } = useMailAction(props);
  const { unsupported, kind, maxBytes } = props;
  const hint = useId();
  if (unsupported) return <div className={styles.status} data-kind="unsupported"><h4>Nudge</h4><strong>{unsupported.label}</strong><span className={styles.muted}>{unsupported.detail}</span></div>;
  return <form className={styles.nudge} onSubmit={e => { e.preventDefault(); submit(); }}>
    {kind === "nudge" && <h4>Nudge</h4>}
    <label htmlFor={`${hint}-body`}>{labels[kind].input}</label>
    <textarea id={`${hint}-body`} value={body} disabled={busy || !!unresolved} aria-describedby={hint} onChange={e => setBody(e.target.value)} />
    <span id={hint} className={styles.muted}>{labels[kind].explanation} {bytes > maxBytes ? `Too long (${bytes} of ${maxBytes} bytes).` : ""}</span>
    {!unresolved && <ActionButton type="submit" disabled={!canSubmit}>Send {kind}</ActionButton>}
    {state && <div className={styles.status} data-kind={state.kind} role="status"><strong>{state.label}</strong><span className={styles.muted}>{state.detail}</span>
      {unresolved && <div className={styles.row}>
        <ActionButton disabled={busy} onClick={() => void send(unresolved)}>Re-send same {kind}</ActionButton>
        <ActionButton disabled={busy} onClick={() => void send(unresolved, true)}>Check outcome</ActionButton>
      </div>}
    </div>}
  </form>;
}
