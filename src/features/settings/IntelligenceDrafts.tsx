import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import styles from "./Intelligence.module.css";
import { useBlocker } from "react-router";
import { ActionButton } from "../../components/layout/Workspace";

export type IntelligenceDraft = { id: string; label: string; dirty: boolean; locked: boolean; save(): Promise<boolean>; order?: number };
type DraftContext = {
  register(id: string, read: () => IntelligenceDraft): () => void; notify(): void;
  saving: boolean; dirty: boolean; locked: boolean; message: string | null; saveAll(): Promise<boolean>;
  hasConfirmedChanges(domain: string): boolean; resolveRevision(domain: string, revision: string): string; confirmRevision(domain: string, from: string, to: string): void;
};
const Context = createContext<DraftContext | null>(null);
export function useIntelligenceDrafts() {
  const context = useContext(Context);
  if (!context) throw new Error("Intelligence draft provider is missing");
  return context;
}
export function useIntelligenceDraft(entry: IntelligenceDraft) {
  const context = useIntelligenceDrafts();
  const latest = useRef(entry); latest.current = entry;
  useEffect(() => context.register(entry.id, () => latest.current), [context.register, entry.id]);
  useEffect(() => { context.notify(); }, [context.notify, entry.dirty, entry.locked]);
  return context;
}
export function IntelligenceDraftProvider({ children }: { children: ReactNode }) {
  const entries = useRef(new Map<string, () => IntelligenceDraft>());
  const revisions = useRef(new Map<string, Map<string, string>>());
  const [version, setVersion] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const notify = useCallback(() => setVersion(old => old + 1), []);
  const register = useCallback((id: string, read: () => IntelligenceDraft) => {
    entries.current.set(id, read); notify();
    return () => { if (entries.current.get(id) === read) { entries.current.delete(id); notify(); } };
  }, [notify]);
  const resolveRevision = useCallback((domain: string, revision: string) => {
    const changes = revisions.current.get(domain); let latest = revision; const seen = new Set<string>();
    while (changes?.has(latest) && !seen.has(latest)) { seen.add(latest); latest = changes.get(latest)!; }
    return latest;
  }, []);
  const hasConfirmedChanges = useCallback((domain: string) => revisions.current.has(domain), []);
  const confirmRevision = useCallback((domain: string, from: string, to: string) => {
    if (from === to) return;
    let changes = revisions.current.get(domain); if (!changes) { changes = new Map(); revisions.current.set(domain, changes); }
    changes.set(from, to);
  }, []);
  const saveAll = useCallback(async () => {
    if (savingRef.current) return false;
    savingRef.current = true; setSaving(true); setMessage(null);
    try {
      const queue = [...entries.current.values()].map(read => read()).sort((a, b) => (a.order ?? 10) - (b.order ?? 10));
      for (const scheduled of queue) {
        const entry = entries.current.get(scheduled.id)?.();
        if (!entry?.dirty) continue;
        const confirmed = !entry.locked && await entry.save();
        flushSync(() => {});
        if (!confirmed) { setMessage(`Could not finish saving ${entry.label}. Your remaining edits are preserved.`); return false; }
      }
      setMessage("Saved."); return true;
    } catch { setMessage("Saving stopped. Your remaining edits are preserved."); return false; }
    finally { savingRef.current = false; setSaving(false); }
  }, []);
  const values = [...entries.current.values()].map(read => read());
  const dirty = values.some(entry => entry.dirty);
  const locked = values.some(entry => entry.dirty && entry.locked);
  const context = useMemo(() => ({ register, notify, saving, dirty, locked, message, saveAll, resolveRevision, confirmRevision, hasConfirmedChanges }), [register, notify, saving, dirty, locked, message, saveAll, resolveRevision, confirmRevision, hasConfirmedChanges, version]);
  return <Context.Provider value={context}>{children}<UnsavedSettingsWarning /></Context.Provider>;
}
function UnsavedSettingsWarning() {
  const drafts = useIntelligenceDrafts();
  const unsaved = drafts.dirty;
  const dialog = useRef<HTMLDialogElement>(null);
  const isSettings = (path: string) => path === "/settings" || path.startsWith("/settings/");
  const blocker = useBlocker(({ currentLocation, nextLocation }) => unsaved && isSettings(currentLocation.pathname) && !isSettings(nextLocation.pathname));
  const blocked = blocker.state === "blocked";
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved]);
  useEffect(() => {
    if (!blocked) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog.current?.showModal) dialog.current.showModal(); else dialog.current?.setAttribute("open", "");
    return () => { dialog.current?.close?.(); previous?.focus(); };
  }, [blocked]);
  if (blocker.state !== "blocked") return null;
  return createPortal(<dialog ref={dialog} role="alertdialog" className={styles.unsavedDialog} aria-labelledby="unsaved-intelligence-title" onCancel={event => { event.preventDefault(); blocker.reset(); }}>
    <h3 id="unsaved-intelligence-title">Leave Settings with unsaved changes?</h3>
    <p>Your unsaved Intelligence changes will be lost.</p>
    <div className={styles.rowActions}>
      <ActionButton autoFocus onClick={() => blocker.reset()}>Stay in Settings</ActionButton>
      <ActionButton disabled={drafts.saving} onClick={() => blocker.proceed()}>Leave without saving</ActionButton>
    </div>
  </dialog>, document.body);
}
