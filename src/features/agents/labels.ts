import type { SessionView } from "../../api/adapters/inspection";

type ObservationView = SessionView["observation"];
type ObservationState = ObservationView["state"];

/** Short plain label for the server-observed process state. `reported_*` are what older servers sent. */
export const OBSERVATION_LABEL: Record<ObservationState, string> = {
  working: "Working",
  quiet: "No progress lately",
  stale: "No recent activity",
  awaiting: "Starting",
  unknown: "Not observed",
  ended: "Ended",
  reported_running: "Running (reported)",
  reported_stopped: "Stopped (reported)",
  unsupported: "Unsupported state",
};

/** One sentence for assistive technology: what the state means, not only its name. */
export const OBSERVATION_DESCRIPTION: Record<ObservationState, string> = {
  working: "The session is being observed and is making progress.",
  quiet: "The session is being observed but has shown no progress lately.",
  stale: "No recent activity has been observed from the session.",
  awaiting: "The session is starting and has not been observed yet.",
  unknown: "The session is not being observed, so its process state is not known.",
  ended: "The session's process has ended.",
  reported_running: "The session's process was reported as running.",
  reported_stopped: "The session's process was reported as stopped.",
  unsupported: "This dashboard does not recognise the reported process state.",
};

const REASON_TEXT: Record<string, string> = {
  no_observation_source: "No observation source is reporting for this session",
  no_observation_within_grace: "Nothing was observed within the start-up grace period",
  no_progress_within_evidence_window: "No progress was seen within the evidence window",
};

/** The reason explains only these states; elsewhere it is not shown. */
const REASON_STATES: readonly ObservationState[] = ["unknown", "quiet", "stale"];

/** Reason text for unknown/quiet/stale; unrecognised codes are shown humanised, never dropped. */
export function observationReasonText(o: Pick<ObservationView, "state" | "reason">): string | null {
  if (!o.reason || !REASON_STATES.includes(o.state)) return null;
  const known = REASON_TEXT[o.reason];
  if (known) return known;
  const words = o.reason.replaceAll("_", " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : null;
}

/** Full description: what the state means, then the reason when the server gave one. */
export function observationDescription(o: Pick<ObservationView, "state" | "reason">): string {
  const reason = observationReasonText(o);
  return reason ? `${OBSERVATION_DESCRIPTION[o.state]} ${reason}.` : OBSERVATION_DESCRIPTION[o.state];
}

/** Observed as running / as ended, across the current and older server vocabularies. */
export const observedRunning = (state: ObservationState) =>
  state === "working" || state === "quiet" || state === "reported_running";
export const observedEnded = (state: ObservationState) => state === "ended" || state === "reported_stopped";

export const AUTHORITY_LABEL: Record<SessionView["authority"], string> = {
  central: "Central",
  remote: "Remote",
  unknown: "Authority unknown",
  unsupported: "Unsupported authority",
};

export function controllerText(c: SessionView["controller"]): string {
  switch (c.state) {
    case "none":
      return "No controller";
    case "held":
      return c.label ? `Controlled by ${c.label}` : "Controlled";
    case "unknown":
      return "Controller unknown";
    case "unsupported":
      return "Unsupported controller state";
  }
}

export function profileText(p: SessionView["profile"]): string {
  return [p.model ?? "model unknown", p.harness ?? "harness unknown"].join(" · ");
}

export function executionAuthorityText(state: SessionView["executionAuthority"]): string {
  switch (state) {
    case "offered": return "Offered";
    case "preparing": return "Preparing";
    case "granted": return "Grant issued";
    case "cancelling": return "Cancelling";
    case "never_granted": return "Never granted";
    case "declined": return "Declined";
    case "finished": return "Finished";
    case "unsupported": return "Unsupported authority state";
    default: return "Unknown";
  }
}
