import { useCallback, useSyncExternalStore } from "react";

/**
 * Which inspector sections are open, remembered in this browser (spec 0004 §3). Presentation only: storage
 * that is missing, full or blocked (private mode) falls back to the defaults for this visit.
 */
export const SECTIONS_KEY = "aq.dashboard.task-sections";
export type SectionId = "status" | "description" | "acceptance" | "comments" | "attempts" | "results" | "hierarchy" | "history";
export const SECTION_DEFAULT_OPEN: Record<SectionId, boolean> = {
  status: true, description: true, acceptance: true, comments: true, attempts: true, results: true, hierarchy: true, history: false,
};

const listeners = new Set<() => void>();
let memory: Partial<Record<SectionId, boolean>> = {};
let cached: { raw: string | null; value: Partial<Record<SectionId, boolean>> } | undefined;

function read(): Partial<Record<SectionId, boolean>> {
  let raw: string | null = null;
  try { raw = globalThis.localStorage?.getItem(SECTIONS_KEY) ?? null; } catch { return memory; }
  if (cached?.raw === raw) return cached.value;
  let parsed: unknown = {};
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = {}; }
  const value: Partial<Record<SectionId, boolean>> = {};
  if (parsed && typeof parsed === "object") for (const id of Object.keys(SECTION_DEFAULT_OPEN) as SectionId[]) {
    const v = (parsed as Record<string, unknown>)[id];
    if (typeof v === "boolean") value[id] = v;
  }
  cached = { raw, value: { ...value, ...memory } };
  return cached.value;
}

export function sectionOpen(id: SectionId): boolean { return read()[id] ?? SECTION_DEFAULT_OPEN[id]; }

export function setSectionOpen(id: SectionId, open: boolean) {
  const next = { ...read(), [id]: open };
  try {
    if (!globalThis.localStorage) throw new Error("no storage");
    globalThis.localStorage.setItem(SECTIONS_KEY, JSON.stringify(next));
    delete memory[id];
  } catch { memory = { ...memory, [id]: open }; /* kept for this visit only */ }
  cached = undefined;
  listeners.forEach(l => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => { if (e.key === SECTIONS_KEY) { cached = undefined; listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function useSectionOpen(id: SectionId): [boolean, (open: boolean) => void] {
  const open = useSyncExternalStore(subscribe, () => sectionOpen(id), () => SECTION_DEFAULT_OPEN[id]);
  return [open, useCallback((v: boolean) => setSectionOpen(id, v), [id])];
}

/** Test hook: forget the in-memory fallback. */
export function resetSectionMemory() { memory = {}; cached = undefined; }
