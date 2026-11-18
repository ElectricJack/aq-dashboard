import { useId } from "react";
import type { SessionView } from "../../api/adapters/inspection";
import { FreshnessLabel } from "../../components/QueryStatus/FreshnessLabel";
import { formatAge } from "../../components/time/relative";
import { observationDescription, observationReasonText, OBSERVATION_LABEL } from "./labels";
import styles from "./Agents.module.css";

type Props = { session: Pick<SessionView, "observation">; serverTime: string };

/** The state label with its meaning (and reason) as an accessible description. */
export function ObservationLabel({ session: { observation: o } }: Pick<Props, "session">) {
  const id = useId();
  return <>
    <span aria-describedby={id} title={observationDescription(o)}>{OBSERVATION_LABEL[o.state]}</span>
    <span id={id} className={styles.srOnly}>{observationDescription(o)}</span>
  </>;
}

/**
 * State label plus its age. An unobserved state has no age and is not "stale" (server #97: quality unknown =
 * not reported); its reason is in {@link ObservationTimes}.
 */
export function ObservationSummary({ session: s, serverTime }: Props) {
  const o = s.observation;
  return <><ObservationLabel session={s} />{o.state !== "unknown" && <> · <FreshnessLabel serverTime={serverTime} observedAt={o.observedAt} stale={o.freshness === "stale"} /></>}</>;
}

function RelativeTime({ at, serverTime }: { at: string; serverTime: string }) {
  return <time dateTime={at} title={at}>{formatAge(serverTime, at)}</time>;
}

/** Reason (unknown/quiet/stale) and the last activity / last progress times, each only when present. */
export function ObservationTimes({ session: s, serverTime }: Props) {
  const o = s.observation;
  const parts = [
    observationReasonText(o),
    o.lastObservationAt && <>Last activity <RelativeTime at={o.lastObservationAt} serverTime={serverTime} /></>,
    o.lastProgressAt && <>Last progress <RelativeTime at={o.lastProgressAt} serverTime={serverTime} /></>,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <span className={styles.meta}>{parts.map((p, i) => <span key={i}>{i > 0 && " · "}{p}</span>)}</span>;
}
