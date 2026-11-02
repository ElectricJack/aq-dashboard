import type { QueryContext } from "../api/queryKeys";

const PREFIX = "aq.dashboard.draft:";
const IDENTITY = `${PREFIX}identity`;
const memory = new Map<string, string>();
const listeners = new Set<() => void>();
let owner: string | null = null;
let unavailable = false;
const changed = () => { for (const listener of listeners) listener(); };

export function draftIdentity(context: Pick<QueryContext, "principalId" | "authorizationRevision">) {
  return JSON.stringify([context.principalId, context.authorizationRevision]);
}
export function draftStorageKey(context: QueryContext, key: string) {
  return PREFIX + JSON.stringify([context.principalId, context.authorizationRevision, key]);
}
export function subscribeDrafts(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Clear only AQ drafts, never unrelated application/session data. */
export function clearDrafts() {
  memory.clear(); owner = null;
  try {
    const keys = Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i));
    for (const key of keys) if (key?.startsWith(PREFIX)) sessionStorage.removeItem(key);
  } catch { unavailable = true; }
  changed();
}

/** Called before mounting a protected identity's composers, and on scope changes. */
export function activateDrafts(identity: string) {
  try {
    const previous = sessionStorage.getItem(IDENTITY);
    if (previous !== identity || (owner !== null && owner !== identity)) clearDrafts();
    sessionStorage.setItem(IDENTITY, identity); unavailable = false;
  } catch {
    if (owner !== identity) memory.clear();
    unavailable = true;
  }
  owner = identity;
}

export function readDraft(key: string): string | null {
  if (unavailable && memory.has(key)) return memory.get(key)!;
  try { return sessionStorage.getItem(key); }
  catch { return memory.get(key) ?? null; }
}
export function writeDraft(key: string, serialized: string) {
  // Async results from an unmounted composer must never resurrect a prior identity.
  try {
    const parts: unknown = JSON.parse(key.slice(PREFIX.length));
    if (!Array.isArray(parts) || JSON.stringify(parts.slice(0, 2)) !== owner) return;
  } catch { return; }
  memory.set(key, serialized);
  try { sessionStorage.setItem(key, serialized); }
  catch { unavailable = true; }
  changed();
}

/** Synchronous final checkpoint. Refuse the reload if storage cannot retain drafts. */
export function saveDraftsBeforeReload(): boolean {
  try {
    if (owner) sessionStorage.setItem(IDENTITY, owner);
    for (const [key, value] of memory) sessionStorage.setItem(key, value);
    unavailable = false;
    return true;
  } catch { unavailable = true; return false; }
}
