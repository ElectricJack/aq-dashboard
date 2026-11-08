import { useEffect, useRef, useState } from "react";
import { useSession } from "../../../app/session";
import { isRecord } from "../../../api/adapters/contract";
import { ActionButton } from "../../../components/layout/Workspace";
import { Timestamp } from "../../settings/Timestamp";
import styles from "./Swarm.module.css";

// Port 28081 is the worker listener of the aq-ms1 stack; the owner edits the URL for any other deployment.
const defaultWorkerUrl = () => `${window.location.protocol}//${window.location.hostname}:28081`;

type Enrollment = { code: string; expiresAt: string };

/**
 * Creates a single-use enrollment code. The code lives in this component's state only: it is never
 * logged, put in a URL or the command, or written to storage, and it is dropped when the panel closes.
 */
export function AddMachine() {
  const { bootstrap } = useSession();
  const capability = bootstrap.capability("swarm.worker.enroll");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [workerUrl, setWorkerUrl] = useState(defaultWorkerUrl);
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false), [copied, setCopied] = useState<"code" | "command" | "failed" | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (!capability.enabled) return null;

  async function create() {
    setBusy(true); setFailed(false); setEnrollment(null); setCopied(null);
    try {
      const response = await fetch("/api/enrollments", { method: "POST", credentials: "same-origin", headers: { Accept: "application/json", "X-AQ-Request": "1" } });
      const raw: unknown = response.status === 201 ? await response.json().catch(() => undefined) : undefined;
      if (!mounted.current) return;
      if (isRecord(raw) && typeof raw.code === "string" && raw.code && typeof raw.expires_at === "string") setEnrollment({ code: raw.code, expiresAt: raw.expires_at });
      else setFailed(true);
    } catch { if (mounted.current) setFailed(true); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function copy(text: string, what: "code" | "command") {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied("failed"); }
  }
  const command = `packaging/service/aq-install.sh --server ${workerUrl} --bundle ~/aq-bundle --slots 2`;
  return <section aria-label="Add machine" className={styles.addMachine}>
    <div className={styles.actions}><ActionButton disabled={busy} onClick={() => void create()}>Add machine</ActionButton></div>
    {failed && <p role="alert">The enrollment code could not be created.</p>}
    {enrollment && <div>
      <label>Worker URL <input type="text" value={workerUrl} onChange={e => setWorkerUrl(e.target.value)} autoComplete="off" spellCheck={false} /></label>
      <p><code>{command}</code> <ActionButton onClick={() => void copy(command, "command")}>Copy command</ActionButton></p>
      <p className={styles.actionNote}>Run it from an aq-worker checkout on the new machine. ~/aq-bundle holds the runtime binaries, native.json and repositories.json (docs/operations/install-service.md). The machine is allowed automatically and appears on this page.</p>
      <label>Enrollment code <input type="text" readOnly value={enrollment.code} autoComplete="off" spellCheck={false} aria-label="Enrollment code" /></label>{" "}
      <ActionButton onClick={() => void copy(enrollment.code, "code")}>Copy code</ActionButton>
      <p className={styles.actionNote}>Paste this when the script asks for it. It works once and expires at <Timestamp iso={enrollment.expiresAt} />.</p>
      {copied === "failed" ? <p role="status">Copy failed. Select the text and copy it by hand.</p> : copied && <p role="status">{copied === "code" ? "Code copied." : "Command copied."}</p>}
      <ActionButton onClick={() => { setEnrollment(null); setCopied(null); }}>Done</ActionButton>
    </div>}
  </section>;
}
