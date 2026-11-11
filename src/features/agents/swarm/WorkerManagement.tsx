import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { apiGet, apiSend, ApiError } from "../../../api/client";
import { isRecord, ContractError } from "../../../api/adapters/contract";
import type { SwarmView } from "../../../api/adapters/swarm";
import { queryKey } from "../../../api/queryKeys";
import { useSession, PANEL_READ } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import styles from "./Swarm.module.css";

type Setting = {
  kind: "machine" | "node";
  id: string;
  label: string | null;
  max_agents: number | null;
  removed: boolean;
  revision: number;
};
type Settings = { settings: Setting[] };
function isSetting(raw: unknown): raw is Setting {
  return isRecord(raw) && ["machine", "node"].includes(String(raw.kind)) && typeof raw.id === "string"
    && (raw.label === null || typeof raw.label === "string")
    && (raw.max_agents === null || Number.isInteger(raw.max_agents) && Number(raw.max_agents) >= 0 && Number(raw.max_agents) <= 2_147_483_647)
    && typeof raw.removed === "boolean" && Number.isSafeInteger(raw.revision) && Number(raw.revision) > 0;
}
export function useWorkerSettings() {
  const { bootstrap, queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "worker-settings", {}),
    queryFn: async ({ signal }): Promise<Settings> => {
      const raw = await apiGet<unknown>("/api/worker-management", signal);
      if (!isRecord(raw) || !Array.isArray(raw.settings) || !raw.settings.every(isSetting)) {
        throw new ContractError("Invalid worker settings");
      }
      return raw as Settings;
    },
    enabled: bootstrap.capability("swarm.worker.control").enabled,
    refetchInterval: 10_000,
    retry: false,
    meta: PANEL_READ,
  });
}

export function applyWorkerSettings(view: SwarmView, settings: Settings | undefined): SwarmView {
  if (!settings) return view;
  return {
    ...view,
    machines: view.machines.map(machine => {
      const setting = settings.settings.find(s => s.kind === "machine" && s.id === machine.id);
      const nodes = machine.nodes.filter(n => !settings.settings.some(s => s.kind === "node" && s.id === n.id && s.removed))
        .map(node => {
          const own = settings.settings.find(s => s.kind === "node" && s.id === node.id);
          return { ...node, name: own?.label ?? node.name };
        });
      const total = nodes.every(n => n.slots.total !== null) ? nodes.reduce((sum, n) => sum + n.slots.total!, 0) : machine.agentMax;
      return { ...machine, label: setting?.label ?? machine.label, agentMax: setting?.max_agents ?? total, nodes };
    }),
  };
}

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
    if (lock.current || !remove && !valid) return;
    if (remove && !pending && !window.confirm("Are you sure?")) return;
    const change = pending ?? {
      operation_id: crypto.randomUUID(), expected_revision: current?.revision ?? 0,
      label: remove ? current?.label ?? name : label.trim(),
      max_agents: remove ? current?.max_agents ?? null : limit === "" ? null : Number(limit), remove,
    };
    lock.current = true;
    setBusy(true);
    setMessage(null);
    setPending(change);
    try {
      const receipt = await apiSend<unknown>("POST", `/api/worker-management/${kind}/${encodeURIComponent(id)}`, change);
      if (!isSetting(receipt) || receipt.kind !== kind || receipt.id !== id || receipt.revision !== change.expected_revision + 1) {
        throw new ContractError("Invalid settings receipt");
      }
      setPending(null);
      setMessage(change.remove ? "Removed." : "Saved.");
      if (change.remove) setParams(previous => {
        const next = new URLSearchParams(previous);
        next.delete("select");
        return next;
      }, { replace: true });
      await client.invalidateQueries({ predicate: query => ["worker-settings", "swarm", "capacity", "worker-nodes", "manual-agents"].some(key => query.queryKey.includes(key)) });
    } catch (error) {
      const refused = error instanceof ApiError && (error.status ?? 0) >= 400 && (error.status ?? 0) < 500;
      if (refused) setPending(null);
      setMessage(refused ? error.serverMessage ?? "Settings could not be saved." : "Confirmation is pending. Retry to check the same request.");
      if (refused) await client.invalidateQueries({ predicate: query => query.queryKey.includes("worker-settings") });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return <form className={styles.management} aria-label={kind === "machine" ? "Machine settings" : "Worker node settings"} onSubmit={event => { event.preventDefault(); void save(false); }}>
    <label>Name<input value={label} maxLength={64} onChange={event => setLabel(event.target.value)} disabled={busy || !!pending} /></label>
    <label>Max agents<input type="number" min={0} max={kind === "node" ? 8 : 2_147_483_647} step={1} value={limit} placeholder={`Automatic${maximum === null ? "" : ` (${maximum})`}`} onChange={event => setLimit(event.target.value)} disabled={busy || !!pending} /></label>
    <p className={styles.actionNote}>{kind === "machine" ? "Total across this machine’s workers." : "Total across this worker’s projects."} Leave blank for automatic capacity.</p>
    <div className={styles.managementActions}>
      <ActionButton type="submit" disabled={!valid || busy || pending?.remove}>{busy ? "Saving…" : pending ? "Retry save" : "Save"}</ActionButton>
      <ActionButton onClick={() => void save(true)} disabled={busy || pending?.remove === false}>{pending?.remove ? "Retry removal" : kind === "machine" ? "Remove machine" : "Remove worker node"}</ActionButton>
    </div>
    {message && <p role="status" className={styles.actionNote}>{message}</p>}
  </form>;
}
