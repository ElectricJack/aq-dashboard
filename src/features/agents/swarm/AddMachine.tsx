import { useEffect, useRef, useState } from "react";
import { useSession } from "../../../app/session";
import { isRecord } from "../../../api/adapters/contract";
import { ActionButton } from "../../../components/layout/Workspace";
import { Timestamp } from "../../settings/Timestamp";
import styles from "./Swarm.module.css";

// Port 28081 is the worker listener of the aq-ms1 stack; the owner edits the URL for any other deployment.
const defaultWorkerUrl = () => `${window.location.protocol}//${window.location.hostname}:28081`;

const shellQuote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;
const NUMERIC_LOOPBACK = /^(127(\.\d{1,3}){3}|\[::1\])$/;
/** The worker URL is safe to put in the install command: https, or plain http only to numeric loopback. */
export function workerUrlProblem(value: string): string | null {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return "Enter a full Worker URL such as https://aq.example.com:28081."; }
  if (url.protocol === "https:") return null;
  if (url.protocol === "http:" && NUMERIC_LOOPBACK.test(url.hostname)) return null;
  return url.protocol === "http:" ? "This Worker URL is plain http to a non-loopback address; the worker would send its credentials unencrypted. Use https." : "The Worker URL must start with https://.";
}

/** The operator pins the installer served by AQ's private worker endpoint. */
export function hostedWorkerCommand(origin: unknown, digest: unknown): string | null {
  if (typeof origin !== "string" || !/^https:\/\/[a-zA-Z0-9][a-zA-Z0-9.-]*(?::[0-9]{1,5})?$/.test(origin)
    || typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest) || workerUrlProblem(origin)) return null;
  const script = [
    'set -eu',
    'f=$(mktemp)',
    `trap 'rm -f -- "$f"' EXIT`,
    'curl --proto "=https" --fail --silent --show-error --max-filesize 262144 --max-time 45 "$1/install/$2.sh" -o "$f"',
    'printf "%s  %s\\n" "$2" "$f" | sha256sum --check --status || { echo "Installer changed. Copy a fresh command from Add machine." >&2; exit 4; }',
    'bash "$f" "$1"',
  ].join("; ");
  return `bash -c ${shellQuote(script)} _ ${shellQuote(origin)} ${shellQuote(digest)}`;
}

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
  useEffect(() => {
    if (!enrollment) return;
    const left = Date.parse(enrollment.expiresAt) - Date.now();
    if (!Number.isFinite(left)) return;
    const timer = setTimeout(() => { setEnrollment(null); setCopied(null); }, Math.max(0, Math.min(left, 2 ** 31 - 1)));
    return () => clearTimeout(timer);
  }, [enrollment]);
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
  const hosted = hostedWorkerCommand(import.meta.env.VITE_AQ_WORKER_INSTALL_URL, import.meta.env.VITE_AQ_WORKER_INSTALL_SHA256);
  const problem = workerUrlProblem(workerUrl);
  const command = problem ? null : `packaging/service/aq-install.sh --server ${shellQuote(workerUrl.trim())} --bundle ~/aq-bundle --slots 2`;
  return <section aria-label="Add machine" className={styles.addMachine}>
    <div className={styles.actions}><ActionButton disabled={busy || !!enrollment} onClick={() => void create()}>Add machine</ActionButton></div>
    {failed && <p role="alert">The enrollment code could not be created.</p>}
    {enrollment && <div>
      {!hosted && <label>Worker URL <input type="text" value={workerUrl} onChange={e => setWorkerUrl(e.target.value)} autoComplete="off" spellCheck={false} /></label>}
      <p className={styles.actionNote}>{hosted ? "Run this command in Ubuntu WSL or Linux on the new PC. It downloads the worker and prompts for the code." : "Run it from an aq-worker checkout on the new machine. ~/aq-bundle holds the runtime binaries, native.json and repositories.json (docs/operations/install-service.md). The machine is allowed automatically and appears on this page."}</p>
      {hosted ? <div className={styles.hostedCommand}>
        <ActionButton onClick={() => void copy(hosted, "command")}>Copy command</ActionButton>
        <details><summary>Show command</summary><code>{hosted}</code></details>
      </div> : command ? <p><code>{command}</code> <ActionButton onClick={() => void copy(command, "command")}>Copy command</ActionButton></p> : <p role="alert">{problem}</p>}
      <label>Enrollment code <input type="text" readOnly value={enrollment.code} autoComplete="off" spellCheck={false} aria-label="Enrollment code" /></label>{" "}
      <ActionButton onClick={() => void copy(enrollment.code, "code")}>Copy code</ActionButton>
      <p className={styles.actionNote}>Paste this when the script asks for it. It works once and expires at <Timestamp iso={enrollment.expiresAt} />.</p>
      {copied === "failed" ? <p role="status">Copy failed. Select the text and copy it by hand.</p> : copied && <p role="status">{copied === "code" ? "Code copied." : "Command copied."}</p>}
      <ActionButton onClick={() => { setEnrollment(null); setCopied(null); }}>Done</ActionButton>
    </div>}
  </section>;
}
