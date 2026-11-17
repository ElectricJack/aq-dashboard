import { createContext, useContext, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import type { IntelligenceFields } from "../../api/roleSettings";
import { readSwarmSettings, updateSwarmLimits, useSwarmSettings, type SwarmSettings } from "../../api/swarmSettings";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import styles from "./ProfileDocuments.module.css";

/**
 * Max agents per level: the swarm's limit on how many agents run at once on a level through one provider
 * (`POST /api/settings/swarm/limits` with a `cell` of provider and level id). Blank means unlimited and 0 pauses new
 * launches. The entries are drafts until Save: each changed limit is one request, sent at the limits' current revision.
 */
const MAX_LIMIT = 4_294_967_295;
const cellKey = (provider: string, level: string) => JSON.stringify([provider, level]);
const valid = (value: string) => value === "" || (/^\d+$/.test(value) && Number(value) <= MAX_LIMIT);

type Limits = {
  settings: SwarmSettings | undefined; unavailable: boolean; drafts: Record<string, string>; locked: boolean;
  edit(provider: string, level: string, value: string): void;
  /** What the person needs to know about the limits and their unsaved entries; shown under the levels table. */
  feedback: ReactNode;
};
const Context = createContext<Limits | null>(null);

export function LevelLimitsProvider({ children }: { children: ReactNode }) {
  const { queryContext } = useSession(), client = useQueryClient();
  const key = queryKey(queryContext, "swarm-settings", {});
  const query = useSwarmSettings();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false), [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const settings = query.data;
  const saved = (cell: string) => { const found = settings?.cells.find(c => cellKey(c.provider, c.intelligence_class) === cell); return found?.effective_limit == null ? "" : String(found.effective_limit); };
  const dirty = Object.entries(drafts).filter(([cell, value]) => value !== saved(cell));
  const invalid = dirty.some(([, value]) => !valid(value));
  function edit(provider: string, level: string, value: string) { setDrafts(old => ({ ...old, [cellKey(provider, level)]: value })); setNotice(null); setError(null); }
  async function save(): Promise<boolean> {
    if (!dirty.length) return true;
    if (saving || invalid || conflict) return false;
    setSaving(true); setError(null); setNotice(null);
    let current: SwarmSettings;
    try { current = await readSwarmSettings(); }
    catch { setError("The agent limits could not be read, so max agents were not saved. Your entries are kept."); setSaving(false); return false; }
    try {
      for (const [cell, value] of dirty) {
        const [provider, level] = JSON.parse(cell) as [string, string];
        current = await updateSwarmLimits({ operation_id: crypto.randomUUID(), expected_revision: current.revision, expected_catalog_revision: current.catalog_revision,
          cell: { provider, intelligence_class: level, limit: value === "" ? null : Number(value) } });
        const latest = current;
        client.setQueryData<SwarmSettings>(key, old => !old || BigInt(latest.revision) >= BigInt(old.revision) ? latest : old);
        setDrafts(old => { const next = { ...old }; delete next[cell]; return next; });
      }
      setNotice("Max agents saved."); return true;
    } catch (e) {
      const refused = e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500;
      setConflict(e instanceof ApiError && e.status === 409);
      setError(e instanceof ApiError && e.status === 409 ? "The agent limits changed elsewhere. Your entries are kept; reload the limits, then save again."
        : refused ? `AQ did not save max agents: ${(e as ApiError).serverMessage ?? "the request was refused"}. Your entries are kept.`
          : "Max agents could not be confirmed as saved. Your entries are kept; reload the limits to see what AQ holds.");
      return false;
    } finally { setSaving(false); void client.invalidateQueries({ queryKey: key }); }
  }
  async function reload() {
    setSaving(true);
    try { const result = await query.refetch(); if (result.isError) throw result.error; setConflict(false); setError(null); }
    catch { setError("The agent limits could not be reloaded. Your entries are kept."); }
    finally { setSaving(false); }
  }
  const coordinator = useIntelligenceDraft({ id: "level-limits", label: "max agents", dirty: dirty.length > 0, locked: saving || invalid || conflict, save, order: 35 });
  const locked = saving || coordinator.saving;
  const feedback = <div className={styles.limitStatus}>
      <p className={styles.note}>Max agents is how many agents may run at once on a level through one provider. Blank means unlimited; 0 pauses new launches. Running agents finish.</p>
      {query.isError && <p className={styles.warning} role="alert">The agent limits are unavailable, so max agents cannot be shown or changed. <ActionButton disabled={locked} onClick={() => void query.refetch()}>Reload limits</ActionButton></p>}
      {invalid && <p className={styles.warning} role="alert">Max agents is a whole number from 0 to 4,294,967,295, or blank for unlimited.</p>}
      {error && <p className={styles.warning} role="alert">{error}</p>}
      {(dirty.length > 0 || conflict) && <div className={styles.actions}>
        {dirty.length > 0 && <ActionButton className={styles.primary} disabled={locked || invalid || conflict} onClick={() => void save()}>{saving ? "Saving…" : "Save max agents"}</ActionButton>}
        {dirty.length > 0 && <ActionButton disabled={locked} onClick={() => { setDrafts({}); setError(null); setConflict(false); }}>Discard max agents changes</ActionButton>}
        {conflict && <ActionButton disabled={locked} onClick={() => void reload()}>Reload limits</ActionButton>}
      </div>}
      {notice && !dirty.length && <p className={styles.success} role="status">{notice}</p>}
    </div>;
  return <Context.Provider value={{ settings, unavailable: query.isError && !settings, drafts, locked, edit, feedback }}>{children}</Context.Provider>;
}
export function LevelLimitsFeedback() { return useContext(Context)?.feedback ?? null; }

/** The Max agents cell of one level: one number per provider its candidates name that the swarm has a limit for. */
export function LevelMaxAgents({ level }: { level: IntelligenceFields }) {
  const limits = useContext(Context);
  if (!limits) return null;
  const { settings } = limits;
  if (!settings) return <span className={styles.note}>{limits.unavailable ? "Unavailable" : "Reading…"}</span>;
  const providers = [...new Set(level.candidates.map(candidate => candidate.provider))];
  const cells = providers.flatMap(provider => { const cell = settings.cells.find(c => c.provider === provider && c.intelligence_class === level.id); return cell ? [cell] : []; });
  // The swarm lists a limit for a level and provider once that provider is connected and the level is saved.
  if (!cells.length) return <span className={styles.note}>No limit to set until one of this level’s providers is connected</span>;
  return <div className={styles.limits}>{cells.map(cell => {
    const key = cellKey(cell.provider, level.id), saved = cell.effective_limit === null ? "" : String(cell.effective_limit), value = limits.drafts[key] ?? saved;
    return <label key={cell.provider} className={styles.limit}>
      {cells.length > 1 && <span>{cell.provider}</span>}
      <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={10} placeholder="Unlimited" value={value} disabled={limits.locked} aria-invalid={!valid(value)}
        aria-label={`Max agents for ${level.name} on ${cell.provider}`} onChange={event => limits.edit(cell.provider, level.id, event.target.value.trim())} />
    </label>;
  })}</div>;
}
