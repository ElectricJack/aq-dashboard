import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, isProtectedReadFailure } from "../../api/client";
import { inspectProviderSave, saveProviderSettings, useProviderSettings, type ProviderSettings, type SaveProviders } from "../../api/providerSettings";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./Providers.module.css";

export function Providers() {
  const query = useProviderSettings(); const client = useQueryClient(); const { queryContext } = useSession();
  const [draft, setDraft] = useState<string[] | null>(null);
  const base = useRef<ProviderSettings | null>(null);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<SaveProviders | null>(null);
  const [retry, setRetry] = useState(false);
  const [conflict, setConflict] = useState(false);
  const providers = draft ?? query.data?.providers ?? [];
  const baseline = base.current ?? query.data;
  const dirty = !!baseline && (providers.length !== baseline.providers.length || providers.some(id => !baseline.providers.includes(id)));
  function edit(next: string[]) {
    if (draft === null) base.current = query.data!;
    if (base.current && next.length === base.current.providers.length && next.every(id => base.current!.providers.includes(id))) { setDraft(null); base.current = null; } else setDraft(next);
    setError(null); setNotice(null);
  }
  async function complete(result: ProviderSettings) {
    client.setQueryData<ProviderSettings>(queryKey(queryContext, "provider-settings", {}), old => old && BigInt(old.revision) > BigInt(result.revision) ? old : result);
    void client.invalidateQueries({ queryKey: queryKey(queryContext, "provider-settings", {}) });
    drafts.dismissMessage(); setNotice("Providers saved.");
    setDraft(null); base.current = null; setUnknown(null); setError(null); setRetry(false); setConflict(false);
    void client.invalidateQueries({ predicate: q => q.queryKey.includes("swarm-capacity") || q.queryKey.includes("configured-provider-accounts") });
  }
  async function run(request: SaveProviders, inspect = false) {
    setPending(true); setError(null);
    try { await complete(await (inspect ? inspectProviderSave(request.operation_id) : saveProviderSettings(request))); return true; }
    catch (e) {
      if (inspect || !(e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500)) {
        setUnknown(request); setRetry(inspect && e instanceof ApiError && e.status === 404);
        setError(inspect && e instanceof ApiError && e.status === 404 ? "Save not recorded yet. Retry the same save safely." : "Provider save is unconfirmed. Check its status before editing again.");
      } else {
        setUnknown(null); setConflict(e.status === 409);
        setError(e.serverMessage ?? "Providers could not be saved. Your edits are preserved.");
      }
      return false;
    } finally { setPending(false); }
  }
  const drafts = useIntelligenceDraft({ id: "providers", label: "providers", dirty, locked: pending || unknown !== null || conflict,
    order: 200, save: async () => baseline ? run({ operation_id: crypto.randomUUID(), expected_revision: baseline.revision, expected_available_revision: baseline.available_revision, providers }) : false });
  const locked = drafts.saving || pending || unknown !== null || conflict;
  const missing = (query.data?.available ?? []).filter(p => !providers.includes(p.id));
  const choice = missing.some(p => p.id === selected) ? selected : missing[0]?.id ?? "";
  const rows = [...new Set([...(baseline?.providers ?? []), ...providers])];
  return <Panel title="Providers" description="Choose which configured providers AQ can use for new agents. Removing a provider lets running agents finish and keeps its credentials and Intelligence settings."
    actions={<ActionButton disabled={locked || dirty || query.isFetching} onClick={() => void query.refetch()}>Reload providers</ActionButton>}>
    {!query.data || (query.isError && isProtectedReadFailure(query.error)) ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="providers" onRetry={() => void query.refetch()} /> : <div className={styles.content}>
      <RetainedNotice query={query} />
      <ul className={styles.list} aria-label="Added providers">
        {rows.map(id => {
          const provider = query.data!.available.find(p => p.id === id); const removed = !providers.includes(id);
          const name = provider?.name ?? id;
          return <li key={id} className={styles.row} data-removed={removed || undefined}>
            <div><strong>{name}</strong><p className={styles.meta}>{provider?.accounts.join(", ") || "No longer configured on this server"}</p></div>
            <div className={styles.state}>{removed ? "Removal pending" : !baseline?.providers.includes(id) ? "Addition pending" : "Added"}
              {!removed && <p className={styles.meta}>{provider?.credential_status === "present" ? "Server credentials present" : provider?.credential_status === "disabled" ? "Disabled on server" : "Server credentials unavailable"}</p>}
            </div>
            <ActionButton disabled={locked} aria-label={`${removed ? "Undo removal of" : "Remove"} ${name}`} onClick={() => edit(removed ? [...providers, id] : providers.filter(p => p !== id))}>{removed ? "Undo removal" : "Remove"}</ActionButton>
          </li>;
        })}
      </ul>
      {providers.length === 0 && <p className={styles.meta}>No providers added. New agents will wait until a provider is added and saved.</p>}
      <div className={styles.add}>
        <label>Provider to add<select aria-label="Provider to add" disabled={locked || !missing.length} value={choice} onChange={event => setSelected(event.target.value)}>
          {missing.length ? missing.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">All configured providers added</option>}
        </select></label>
        <ActionButton disabled={locked || !choice} onClick={() => edit([...providers, choice])}>Add provider</ActionButton>
      </div>
      <p className={styles.meta}>Available providers come from the server configuration. Configure a new provider connection on the server before adding it here. Credential presence does not confirm authentication or model readiness.</p>
      {notice && !dirty && <p role="status">{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {unknown && <div className={styles.add}><ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check provider save status</ActionButton>{retry && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same provider save</ActionButton>}</div>}
      {conflict && <ActionButton disabled={pending} onClick={async () => { const result = await query.refetch(); if (result.isSuccess) { setDraft(null); base.current = null; setConflict(false); setError(null); } }}>Discard provider edits and reload</ActionButton>}
    </div>}
  </Panel>;
}
