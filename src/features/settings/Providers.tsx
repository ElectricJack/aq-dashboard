import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isHttpClientError, ApiError, isProtectedReadFailure } from "../../api/client";
import { inspectProviderSave, saveProviderSettings, useProviderSettings, validLoginAge, type ProviderSettings, type SaveProviders } from "../../api/providerSettings";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./Providers.module.css";

function sameProviders(next: string[], saved: string[]) {
  return next.length === saved.length && next.every(id => saved.includes(id));
}

export function Providers() {
  const query = useProviderSettings(); const client = useQueryClient(); const { queryContext } = useSession();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [age, setAge] = useState<string | null>(null);
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
  // The Codex login age limit: the field's text while edited, else the stored limit.
  const savedAge = baseline?.codex_login_max_age_days ?? null;
  const ageText = age ?? (savedAge === null ? "" : String(savedAge));
  const ageValue = ageText.trim() === "" ? null : Number(ageText);
  const ageDirty = age !== null && ageValue !== savedAge;
  const dirty = !!baseline && (ageDirty || providers.length !== baseline.providers.length || providers.some(id => !baseline.providers.includes(id)));
  function edit(next: string[]) {
    if (draft === null) base.current = query.data!;
    if (base.current && sameProviders(next, base.current.providers)) { setDraft(null); base.current = null; } else setDraft(next);
    setError(null); setNotice(null);
  }
  async function complete(result: ProviderSettings) {
    client.setQueryData<ProviderSettings>(queryKey(queryContext, "provider-settings", {}), old => old && BigInt(old.revision) > BigInt(result.revision) ? old : result);
    void client.invalidateQueries({ queryKey: queryKey(queryContext, "provider-settings", {}) });
    drafts.dismissMessage(); setNotice("Providers saved.");
    setDraft(null); setAge(null); base.current = null; setUnknown(null); setError(null); setRetry(false); setConflict(false);
    void client.invalidateQueries({ predicate: q => q.queryKey.includes("swarm-capacity") || q.queryKey.includes("configured-provider-accounts") });
  }
  async function run(request: SaveProviders, inspect = false) {
    setPending(true); setError(null);
    try { await complete(await (inspect ? inspectProviderSave(request.operation_id) : saveProviderSettings(request))); return true; }
    catch (e) {
      if (inspect || !isHttpClientError(e)) {
        const missing = e instanceof ApiError && e.status === 404;
        const retry = inspect && missing;
        setUnknown(request); setRetry(retry);
        setError(retry ? "Save not recorded yet. Retry the same save safely." : "Provider save is unconfirmed. Check its status before editing again.");
      } else {
        setUnknown(null); setConflict(e.status === 409);
        setError(e.serverMessage ?? "Providers could not be saved. Your edits are preserved.");
      }
      return false;
    } finally { setPending(false); }
  }
  const drafts = useIntelligenceDraft({ id: "providers", label: "providers", dirty, locked: pending || unknown !== null || conflict,
    order: 200, save: async () => {
      if (!baseline) return false;
      if (!validLoginAge(ageValue)) { setError("The Codex login age limit is a whole number of days from 1 to 3650, or empty for no limit."); return false; }
      return run({ operation_id: crypto.randomUUID(), expected_revision: baseline.revision, expected_available_revision: baseline.available_revision, providers, ...(ageDirty ? { codex_login_max_age_days: ageValue } : {}) });
    } });
  const locked = drafts.saving || pending || unknown !== null || conflict;
  const missing = (query.data?.available ?? []).filter(p => !providers.includes(p.id));
  const choice = missing.some(p => p.id === selected) ? selected : missing[0]?.id ?? "";
  const rows = [...new Set([...(baseline?.providers ?? []), ...providers])];
  return <Panel title="Providers" description="Add the providers you want to use in Intelligence profiles. Removing a provider lets running agents finish and keeps its credentials and Intelligence settings."
    actions={<ActionButton disabled={locked || dirty || query.isFetching} onClick={() => void query.refetch()}>Reload providers</ActionButton>}>
    {!query.data || (query.isError && isProtectedReadFailure(query.error)) ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="providers" onRetry={() => void query.refetch()} /> : <div className={styles.content}>
      <RetainedNotice query={query} />
      <ul className={styles.list} aria-label="Added providers">
        {rows.map(id => {
          const provider = query.data!.available.find(p => p.id === id); const removed = !providers.includes(id);
          const name = provider?.name ?? id;
          return <li key={id} className={styles.row} data-removed={removed || undefined}>
            <div><strong>{name}</strong>{!!provider?.accounts.length && <details className={styles.details}><summary>Account details</summary><p className={styles.meta}>Account references: {provider.accounts.join(", ")}</p></details>}</div>
            <div className={styles.state}>{removed ? "Removal pending" : !baseline?.providers.includes(id) ? "Addition pending" : "Added"}
              {!removed && <p className={styles.meta}>{!provider || provider.credential_status === "not_configured" ? "Setup required" : provider.credential_status === "present" ? "Server credentials present" : provider?.credential_status === "disabled" ? "Disabled on server" : "Server credentials unavailable"}</p>}
              {!removed && provider?.attention && <p className={styles.error}>Not used for new agents: {provider.attention}</p>}
            </div>
            <ActionButton disabled={locked} aria-label={`${removed ? "Undo removal of" : "Remove"} ${name}`} onClick={() => edit(removed ? [...providers, id] : providers.filter(p => p !== id))}>{removed ? "Undo removal" : "Remove"}</ActionButton>
          </li>;
        })}
      </ul>
      {providers.length === 0 && <p className={styles.meta}>No providers added. New agents will wait until a provider is added and saved.</p>}
      <div className={styles.add}>
        <label>Provider to add<select aria-label="Provider to add" disabled={locked || !missing.length} value={choice} onChange={event => setSelected(event.target.value)}>
          {missing.length ? missing.map(p => <option key={p.id} value={p.id}>{p.name}</option>) : <option value="">All available providers added</option>}
        </select></label>
        <ActionButton disabled={locked || !choice || providers.length >= 32} onClick={() => edit([...providers, choice])}>Add provider</ActionButton>
      </div>
      <p className={styles.meta}>Providers marked Setup required need a connection configured on the server before they can run agents.</p>
      {query.data.codex_login_max_age_days !== undefined && <div className={styles.add}>
        <label>Codex login age limit (days)<input aria-label="Codex login age limit (days)" aria-describedby="codex-login-age-help" type="number" inputMode="numeric" min={1} max={3650} step={1} placeholder="No limit" disabled={locked} value={ageText} onChange={event => { setAge(event.target.value); setError(null); setNotice(null); }} /></label>
        <p id="codex-login-age-help" className={styles.meta}>AQ keeps one saved Codex login and lends it to every Codex agent. An agent is refused when that login was last refreshed longer ago than this; leave empty for no limit. To replace the saved login with your current one, run <code>aq-server import-login</code> on the server.</p>
      </div>}
      {notice && !dirty && <p role="status">{notice}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {unknown && <div className={styles.add}><ActionButton disabled={pending} onClick={() => void run(unknown, true)}>Check provider save status</ActionButton>{retry && <ActionButton disabled={pending} onClick={() => void run(unknown)}>Retry same provider save</ActionButton>}</div>}
      {conflict && <ActionButton disabled={pending} onClick={async () => { const result = await query.refetch(); if (result.isSuccess) { setDraft(null); setAge(null); base.current = null; setConflict(false); setError(null); } }}>Discard provider edits and reload</ActionButton>}
    </div>}
  </Panel>;
}
