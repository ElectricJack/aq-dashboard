import { useId, useState } from "react";
import type { SessionDetailView } from "../../../api/adapters/inspection";
import { ApiError } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { ActionButton } from "../../../components/layout/Workspace";
import { formatAge } from "../../../components/time/relative";
import { actionRequest, type ActionOperation, type FrozenAction } from "../../actions/actionClient";
import { OBSERVATION_LABEL } from "../labels";
import { freezeNudge, NUDGE_MAX_BYTES, nudgeState, nudgeUnsupported, type NudgeState } from "./nudge";
import styles from "./Operations.module.css";

const NOT_REPORTED = "Not reported by this AQ server";
const time = (serverTime: string, at: string) => <time dateTime={at} title={at}>{formatAge(serverTime, at)}</time>;

/** U12/S4: heartbeat, provider output, semantic progress and wait observations are separate facts with their own times. */
export function HealthView({ session: s, serverTime }: { session: SessionDetailView; serverTime: string }) {
  return <section aria-label="Health" className={styles.view}>
    <h3>Health</h3>
    <ul aria-label="Health observations" className={styles.facts}>
      <li><strong>Heartbeat</strong><span>{OBSERVATION_LABEL[s.observation.state]} · observed {time(serverTime, s.observation.observedAt)}{s.observation.freshness === "stale" && " · stale"}</span></li>
      <li><strong>Provider output</strong><span>{s.lastOutputAt ? <>Last output {time(serverTime, s.lastOutputAt)}</> : NOT_REPORTED}</span></li>
      <li><strong>Semantic progress</strong><span>{NOT_REPORTED}</span></li>
      <li><strong>Wait observation</strong><span>{s.wait ? <>{s.wait.explanation} · wait {s.wait.id.slice(0, 8)} · observation time not reported</> : "No wait observed"}</span></li>
    </ul>
    <h4>Stall</h4>
    <p>Stall state unavailable on this AQ server.</p>
    <p className={styles.muted}>The stall rung, its evidence and any quarantine scope are not reported, so none is shown.</p>
    <Nudge session={s} />
  </section>;
}

type Outcome = { op: ActionOperation | null; unknown: boolean } | { state: NudgeState };
function failure(error: unknown): Outcome {
  if (error instanceof ApiError && error.effectUnknown) return { op: null, unknown: true };
  if (error instanceof ApiError && error.status === 409) return { state: { kind: "not_sent", label: "Nudge not sent", detail: "The session changed generation. Refresh and nudge the current session." } };
  if (error instanceof ApiError && [400, 404, 413, 422].includes(error.status ?? 0)) return { state: { kind: "not_sent", label: "Nudge not sent", detail: error.envelope?.message ?? "AQ rejected the nudge." } };
  if (error instanceof ApiError && [401, 403].includes(error.status ?? 0)) return { state: { kind: "not_sent", label: "Nudge not sent", detail: "Access to this session changed." } };
  if (error instanceof ContractError) return { op: null, unknown: true };
  return { state: { kind: "not_sent", label: "Nudge not sent", detail: error instanceof Error ? error.message : "AQ did not accept the nudge." } };
}

/** H3 nudge through the action API with a stable operation id. Never writes to the terminal. */
function Nudge({ session: s }: { session: SessionDetailView }) {
  const unsupported = nudgeUnsupported(s);
  const [body, setBody] = useState("");
  const [frozen, setFrozen] = useState<FrozenAction | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const hint = useId();
  if (unsupported) return <div className={styles.status} data-kind="unsupported"><h4>Nudge</h4><strong>{unsupported.label}</strong><span className={styles.muted}>{unsupported.detail}</span></div>;
  const bytes = new TextEncoder().encode(body).length;
  const valid = body.trim().length > 0 && bytes <= NUDGE_MAX_BYTES;
  const state = outcome ? ("state" in outcome ? outcome.state : nudgeState(outcome.op, outcome.unknown, s.controller)) : null;
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
  return <form className={styles.nudge} onSubmit={e => { e.preventDefault(); if (!valid || busy || unresolved) return; const intent = freezeNudge(s, body); setFrozen(intent); void send(intent); }}>
    <h4>Nudge</h4>
    <label htmlFor={`${hint}-body`}>Nudge message</label>
    <textarea id={`${hint}-body`} value={body} disabled={busy || !!unresolved} aria-describedby={hint} onChange={e => setBody(e.target.value)} />
    <span id={hint} className={styles.muted}>Sent to the session mailbox, not typed into the terminal. {bytes > NUDGE_MAX_BYTES ? `Too long (${bytes} of ${NUDGE_MAX_BYTES} bytes).` : ""}</span>
    {!unresolved && <ActionButton type="submit" disabled={!valid || busy}>Send nudge</ActionButton>}
    {state && <div className={styles.status} data-kind={state.kind} role="status"><strong>{state.label}</strong><span className={styles.muted}>{state.detail}</span>
      {unresolved && <div className={styles.row}>
        <ActionButton disabled={busy} onClick={() => void send(frozen)}>Re-send same nudge</ActionButton>
        <ActionButton disabled={busy} onClick={() => void send(frozen, true)}>Check outcome</ActionButton>
      </div>}
    </div>}
  </form>;
}
