// Display and accessibility preferences (0002 §10): presentation only, no content, kept in this
// browser and deliberately not cleared by logout. Applied as attributes on <html> that tokens.css reads.
import { useCallback, useSyncExternalStore } from "react";

export type TextSize = "default" | "large" | "larger";
export type MotionPreference = "system" | "reduce";
export type DisplayPreferences = { textSize: TextSize; motion: MotionPreference; terminalFontSize: number };

export const PREFERENCES_KEY = "aq.dashboard.display-preferences";
export const TEXT_SIZES: readonly TextSize[] = ["default", "large", "larger"];
/** Matches the terminal's own A−/A+ range (terminalSetup.ts). */
export const TERMINAL_FONT_SIZES: readonly number[] = [14, 16, 18, 20];
export const DEFAULT_PREFERENCES: DisplayPreferences = { textSize: "default", motion: "system", terminalFontSize: 14 };

const listeners = new Set<() => void>();
let cached: { raw: string | null; value: DisplayPreferences } | undefined;

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function readPreferences(): DisplayPreferences {
  let raw: string | null = null;
  try { raw = storage()?.getItem(PREFERENCES_KEY) ?? null; } catch { raw = null; }
  if (cached && cached.raw === raw) return cached.value;
  let parsed: Partial<Record<keyof DisplayPreferences, unknown>> = {};
  try { parsed = raw ? JSON.parse(raw) ?? {} : {}; } catch { parsed = {}; }
  const value: DisplayPreferences = {
    textSize: TEXT_SIZES.includes(parsed.textSize as TextSize) ? parsed.textSize as TextSize : DEFAULT_PREFERENCES.textSize,
    motion: parsed.motion === "reduce" ? "reduce" : DEFAULT_PREFERENCES.motion,
    terminalFontSize: TERMINAL_FONT_SIZES.includes(parsed.terminalFontSize as number) ? parsed.terminalFontSize as number : DEFAULT_PREFERENCES.terminalFontSize,
  };
  cached = { raw, value };
  return value;
}

export function writePreferences(next: DisplayPreferences) {
  const value = { textSize: next.textSize, motion: next.motion, terminalFontSize: next.terminalFontSize };
  try { storage()?.setItem(PREFERENCES_KEY, JSON.stringify(value)); } catch { /* private mode: apply for this visit only */ }
  applyPreferences(value);
  listeners.forEach((listener) => listener());
}

export function applyPreferences(preferences: DisplayPreferences, root: HTMLElement = document.documentElement) {
  if (preferences.textSize === "default") delete root.dataset.textSize; else root.dataset.textSize = preferences.textSize;
  if (preferences.motion === "reduce") root.dataset.motion = "reduce"; else delete root.dataset.motion;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === PREFERENCES_KEY) { applyPreferences(readPreferences()); listener(); } };
  window.addEventListener("storage", onStorage);
  return () => { listeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

export function usePreferences(): [DisplayPreferences, (change: Partial<DisplayPreferences>) => void] {
  const preferences = useSyncExternalStore(subscribe, readPreferences, () => DEFAULT_PREFERENCES);
  const update = useCallback((change: Partial<DisplayPreferences>) => writePreferences({ ...readPreferences(), ...change }), []);
  return [preferences, update];
}
