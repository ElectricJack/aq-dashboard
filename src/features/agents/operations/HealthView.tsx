import type { SessionDetailView } from "../../../api/adapters/inspection";
import { formatAge } from "../../../components/time/relative";
import { OBSERVATION_LABEL, observationReasonText } from "../labels";
import { freezeNudge, NUDGE_MAX_BYTES, nudgeState, nudgeUnsupported } from "./nudge";
import { MailAction } from "./MailAction";
import styles from "./Operations.module.css";

const NOT_REPORTED = "Not reported by this AQ server";
const time = (serverTime: string, at: string) => <time dateTime={at} title={at}>{formatAge(serverTime, at)}</time>;

/** U12/S4: heartbeat, provider output, semantic progress and wait observations are separate facts with their own times. */
export function HealthView({ session: s, serverTime }: { session: SessionDetailView; serverTime: string }) {
  return <section aria-label="Health" className={styles.view}>
    <h3>Health</h3>
    <ul aria-label="Health observations" className={styles.facts}>
      <li><strong>Heartbeat</strong><span>{OBSERVATION_LABEL[s.observation.state]} · {s.observation.state === "unknown" ? (observationReasonText(s.observation) ?? "not reported") : <>observed {time(serverTime, s.observation.observedAt)}{s.observation.freshness === "stale" && " · stale"}</>}</span></li>
      <li><strong>Provider output</strong><span>{s.lastOutputAt ? <>Last output {time(serverTime, s.lastOutputAt)}</> : NOT_REPORTED}</span></li>
      <li><strong>Semantic progress</strong><span>{NOT_REPORTED}</span></li>
      <li><strong>Wait observation</strong><span>{s.wait ? <>{s.wait.explanation} · wait {s.wait.id.slice(0, 8)} · observation time not reported</> : "No wait observed"}</span></li>
    </ul>
    <h4>Stall</h4>
    <p>Stall state unavailable on this AQ server.</p>
    <p className={styles.muted}>The stall rung, its evidence and any quarantine scope are not reported, so none is shown.</p>
    <MailAction kind="nudge" maxBytes={NUDGE_MAX_BYTES} unsupported={nudgeUnsupported(s)}
      freeze={body => freezeNudge(s, body)} describe={(op, unknown) => nudgeState(op, unknown, s.controller)} />
  </section>;
}
