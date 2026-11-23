import { useLayoutEffect } from "react";
import styles from "./Shell.module.css";
import type { GateKind } from "./sessionAccess";

const copy: Record<GateKind, [string, string]> = {
  sign_in: ["Sign in required", "Sign in through AQ, then reload this page."],
  unconfirmed: [
    "Access not confirmed",
    "AQ refused a request and the dashboard could not re-check your access, because AQ did not respond. Your drafts are kept. Try again when AQ is reachable.",
  ],
  forbidden: [
    "Access denied",
    "Your account does not have access to this dashboard. Ask an AQ administrator for access, then try again.",
  ],
  incompatible: [
    "Dashboard update required",
    "This dashboard and AQ server do not support the same API. Install compatible versions, then reload.",
  ],
  unavailable: ["Can't reach AQ", "The dashboard could not load your identity and capabilities from AQ."],
};
function GateTitle({ title }: { title: string }) {
  useLayoutEffect(() => {
    document.title = `${title} — Agent Q`;
    return () => {
      document.title = "Agent Q";
    };
  }, [title]);
  return null;
}

export function SessionGate({ kind, retry }: { kind: GateKind; retry(): void }) {
  const [heading, message] = copy[kind];
  return (
    <main className={styles.gate}>
      <GateTitle title={heading} />
      <p className={styles.brand}>Agent Q</p>
      <h1>{heading}</h1>
      <p>{message}</p>
      {kind !== "sign_in" && (
        <button type="button" className={styles.button} onClick={retry}>
          Try again
        </button>
      )}
    </main>
  );
}

export function Connecting() {
  return (
    <main className={styles.gate} aria-busy="true">
      <p className={styles.brand}>Agent Q</p>
      <p>Connecting to AQ…</p>
    </main>
  );
}
