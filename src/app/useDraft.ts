import { useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { draftStorageKey, readDraft, subscribeDrafts, writeDraft } from "./drafts";
import { useSession } from "./session";

/** Tab-local content only. Callers validate stored JSON before restoring it. */
export function useDraft<T>(draftKey: string, initial: T, validate: (value: unknown) => value is T): readonly [T, Dispatch<SetStateAction<T>>] {
  const { queryContext } = useSession();
  const key = draftStorageKey(queryContext, draftKey);
  const snapshot = useCallback(() => readDraft(key), [key]);
  const serialized = useSyncExternalStore(subscribeDrafts, snapshot, () => null);
  function decode(raw: string | null): T {
    try { const parsed: unknown = raw === null ? null : JSON.parse(raw); return validate(parsed) ? parsed : initial; }
    catch { return initial; }
  }
  const setValue: Dispatch<SetStateAction<T>> = value => {
    const next = typeof value === "function" ? (value as (current: T) => T)(decode(readDraft(key))) : value;
    writeDraft(key, JSON.stringify(next));
  };
  return [decode(serialized), setValue];
}
