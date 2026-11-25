import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { apiSend, isHttpClientError } from "../../../api/client";
import { ContractError } from "../../../api/adapters/contract";
import { useSession } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import styles from "./Swarm.module.css";
import inspectorStyles from "./WorkerInspector.module.css";

export { applyWorkerSettings, useWorkerSettings } from "./workerManagementData";
import { isSetting, useWorkerSettings, type Setting } from "./workerManagementData";

type Props = { kind: "machine" | "node"; id: string; name: string; maximum: number | null };
export function WorkerManagement(props: Props) {
  const { bootstrap } = useSession();
  const query = useWorkerSettings();
  if (!bootstrap.capability("swarm.worker.control").enabled) return null;
  if (!query.data) return <p role="status" className={styles.actionNote}>
    {query.isError ? "Worker settings could not be loaded." : "Loading worker settings…"}
  </p>;
  const current = query.data.settings.find(s => s.kind === props.kind && s.id === props.id);
  return <ManagementForm key={`${props.kind}:${props.id}:${current?.revision ?? 0}`} {...props} current={current} />;
}

type Change = { operation_id: string; expected_revision: number; label: string; max_agents: number | null; remove: boolean };
function receiptMatches(receipt: unknown, kind: Props["kind"], id: string, change: Change) {
  if (!isSetting(receipt)) return false;
  const target = receipt.kind === kind && receipt.id === id;
  return target && receipt.revision === change.expected_revision + 1;
}

function newChange(remove: boolean, current: Setting | undefined, draft: { label: string; name: string; limit: string }): Change {
  const { label, name, limit } = draft;
  const submittedLimit = limit === "" ? null : Number(limit);
  return {
    operation_id: crypto.randomUUID(), expected_revision: current?.revision ?? 0,
    label: remove ? current?.label ?? name : label.trim(),
    max_agents: remove ? current?.max_agents ?? null : submittedLimit, remove,
  };
}

async function submitChange(kind: Props["kind"], id: string, change: Change) {
  const receipt = await apiSend<unknown>("POST", `/api/worker-management/${kind}/${encodeURIComponent(id)}`, change);
  if (!receiptMatches(receipt, kind, id, change)) throw new ContractError("Invalid settings receipt");
}

function allowSave(remove: boolean, valid: boolean, pending: Change | null) {
  if (!remove) return valid;
  return Boolean(pending) || window.confirm("Are you sure?");
}

function ManagementForm({ kind, id, name, maximum, current }: Props & { current: Setting | undefined }) {
  const [label, setLabel] = useState(current?.label ?? name);
  const [limit, setLimit] = useState(current?.max_agents?.toString() ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Change | null>(null);
  const lock = useRef(false);
  const client = useQueryClient();
  const [, setParams] = useSearchParams();
  const valid = label.trim().length > 0 && label.trim().length <= 64
    && (limit === "" || /^\d+$/.test(limit) && Number(limit) <= (kind === "node" ? 8 : 2_147_483_647));
  async function save(remove: boolean) {
    if (lock.current) return;
    if (!allowSave(remove, valid, pending)) return;
    const change = pending ?? newChange(remove, current, { label, name, limit });
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setPending(change);
    try {
      await submitChange(kind, id, change);
      setPending(null);
      setMessage(change.remove ? "Removed." : "Saved.");
      if (change.remove) setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete("select");
        return next;
      }, { replace: true });
      await client.invalidateQueries({ predicate: query => ["worker-settings", "swarm", "capacity", "worker-nodes", "manual-agents"].some(key => query.queryKey.includes(key)) });
    } catch (error) {
      const refused = isHttpClientError(error);
      if (refused) setPending(null);
      setMessage(refused ? error.serverMessage ?? "Settings could not be saved." : "Confirmation is pending. Retry to check the same request.");
      if (refused) await client.invalidateQueries({ predicate: query => query.queryKey.includes("worker-settings") });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <form className={kind === "machine" ? styles.management : `${styles.management} ${inspectorStyles.settings}`} aria-label={kind === "machine" ? "Machine settings" : "Worker node settings"} onSubmit={event => { event.preventDefault(); void save(false); }}>
    <label>Name<input value={label} maxLength={64} onChange={event => setLabel(event.target.value)} disabled={busy || !!pending} /></label>
    <label>Max agents<input type="number" min={0} max={kind === "node" ? 8 : 2_147_483_647} step={1} value={limit} placeholder={`Automatic${maximum === null ? "" : ` (${maximum})`}`} onChange={event => setLimit(event.target.value)} disabled={busy || !!pending} /></label>
    <p className={styles.actionNote}>{kind === "machine" ? "Total across this machine’s workers." : "Total across this worker’s projects."} Leave blank for automatic capacity.</p>
    <div className={kind === "machine" ? styles.managementActions : inspectorStyles.settingsActions}>
      <ActionButton type="submit" disabled={!valid || busy || pending?.remove}>{busy ? "Saving…" : pending ? "Retry save" : "Save"}</ActionButton>
      <ActionButton className={kind === "node" ? inspectorStyles.remove : undefined} onClick={() => void save(true)} disabled={busy || pending?.remove === false}>{pending?.remove ? "Retry removal" : kind === "machine" ? "Remove machine" : "Remove worker node"}</ActionButton>
    </div>
    {message && <p role="status" className={styles.actionNote}>{message}</p>}
  </form>;
}
