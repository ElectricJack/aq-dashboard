import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import {
  DELIVERY_LIMIT_FIELDS, inspectDeliveryDocumentSave, inspectDeliveryLimitsSave, isDeliveryUnavailable, limitFromText, limitToText, readDeliveryDocument, readDeliveryLimits,
  saveDeliveryDocument, saveDeliveryLimits, type DeliveryDocument, type DeliveryLimitKey, type DeliveryLimits, type DeliveryLimitsRead,
} from "../../api/delivery";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { ActionButton, Panel, Toolbar } from "../../components/layout/Workspace";
import styles from "./DeliverySettings.module.css";

export const DELIVERY_DOCUMENT = "delivery-document";
export const DELIVERY_LIMITS = "delivery-limits";
export const DELIVERY_UNAVAILABLE = "Delivery is not available on this server";

/** What one kind of setting needs for the save flow: how to read, compare and send it. */
type Flow<V> = {
  /** The setting in lower case for a sentence, and as a heading. */
  what: string; title: string;
  read(): Promise<{ value: V; revision: string }>;
  same(a: V, b: V): boolean;
  send(value: V, expectedRevision: string, operationId: string): Promise<string>;
  inspect(operationId: string): Promise<string>;
  /** The saved value and its revision, to show from now on. */
  saved(value: V, revision: string): void;
  /** The current value, to show instead of an edit the owner gave up. */
  reloaded(value: V, revision: string): void;
};
/**
 * The save of one setting, as the routing document's: it is sent at the revision read just before the save and only
 * when the saved value is still the one the edit started from; a save whose answer was lost is checked by sending it again.
 */
function useSaveFlow<V>(flow: Flow<V>) {
  const [pending, setPending] = useState(false);
  const [unknown, setUnknown] = useState<{ value: V; operationId: string } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const clear = () => { setError(null); setNotice(null); };
  async function attempt(value: V, operationId: string, send: () => Promise<string>): Promise<boolean> {
    try {
      const revision = await send();
      flow.saved(value, revision);
      setUnknown(null); setConflict(false); setNotice(`${flow.title} saved.`);
      return true;
    } catch (e) {
      if (e instanceof ApiError && e.status !== undefined && e.status >= 400 && e.status < 500) {
        setUnknown(null); setConflict(e.status === 409);
        setError(e.status === 409 ? `Settings changed during the save. Your edits are preserved; reload to discard these edits.` : e.serverMessage ?? `AQ refused the ${flow.what}. Your edits are preserved.`);
      } else { setUnknown({ value, operationId }); setError(`The ${flow.what} save is unconfirmed. Check its status before editing again.`); }
      return false;
    }
  }
  async function save(base: V, value: V) {
    if (pending || unknown || conflict) return;
    setPending(true); clear();
    try {
      let latest: { value: V; revision: string };
      try { latest = await flow.read(); } catch { setError("Could not load the current settings. Your edits are preserved."); return; }
      if (!flow.same(latest.value, base)) { setConflict(true); setError("This changed elsewhere. Your edits are preserved; reload to discard these edits."); return; }
      const operationId = crypto.randomUUID();
      await attempt(value, operationId, () => flow.send(value, latest.revision, operationId));
    } finally { setPending(false); }
  }
  async function check() {
    if (!unknown || pending) return;
    setPending(true); clear();
    try { await attempt(unknown.value, unknown.operationId, () => flow.inspect(unknown.operationId)); } finally { setPending(false); }
  }
  async function reload() {
    setPending(true);
    try { const latest = await flow.read(); flow.reloaded(latest.value, latest.revision); setConflict(false); setError(null); }
    catch { setError("Could not reload settings. Your edits are preserved."); }
    finally { setPending(false); }
  }
  const feedback = <>
    {notice && <p className={styles.success} role="status">{notice}</p>}
    {error && <p className={styles.warning} role="alert">{error}</p>}
    {conflict && <ActionButton disabled={pending} onClick={() => void reload()}>Reload the {flow.what}</ActionButton>}
    {unknown && <ActionButton disabled={pending} onClick={() => void check()}>Check save status</ActionButton>}
  </>;
  return { pending, locked: pending || !!unknown || conflict, save, feedback, clear };
}

function DeliveryDocumentEditor({ current }: { current: DeliveryDocument }) {
  const { queryContext } = useSession(); const client = useQueryClient();
  const key = queryKey(queryContext, DELIVERY_DOCUMENT, {});
  const base = current.markdown;
  const [draft, setDraft] = useState<string | null>(null);
  const flow = useSaveFlow<string>({
    what: "delivery document", title: "Delivery document", read: async () => { const latest = await readDeliveryDocument(); return { value: latest.markdown, revision: latest.revision }; }, same: (a, b) => a === b,
    send: (markdown, expected_revision, operation_id) => saveDeliveryDocument({ markdown, expected_revision, operation_id }), inspect: inspectDeliveryDocumentSave,
    saved: (markdown, revision) => { client.setQueryData<DeliveryDocument>(key, { markdown, revision }); setDraft(null); void client.invalidateQueries({ queryKey: key }); },
    reloaded: (markdown, revision) => { client.setQueryData<DeliveryDocument>(key, { markdown, revision }); setDraft(null); },
  });
  const text = draft ?? base;
  const bytes = new TextEncoder().encode(text).length;
  return <section className={styles.section} aria-labelledby="delivery-document-heading">
    <h3 id="delivery-document-heading">Delivery document</h3>
    <p className={styles.meta}>The Markdown that says how a task's finished work reaches GitHub: when it is published, checked, merged or sent back to its agent. A playbook is written from it.</p>
    <label className={styles.label} htmlFor="delivery-document-markdown">Markdown</label>
    <textarea id="delivery-document-markdown" className={styles.editor} value={text} disabled={flow.locked} spellCheck={false}
      onChange={event => { setDraft(event.target.value === base ? null : event.target.value); flow.clear(); }} />
    <p className={styles.meta}>{bytes.toLocaleString()} bytes</p>
    <Toolbar><ActionButton disabled={draft === null || flow.locked} onClick={() => void flow.save(base, text)}>{flow.pending ? "Saving…" : "Save the delivery document"}</ActionButton></Toolbar>
    {flow.feedback}
  </section>;
}

const sameLimits = (a: DeliveryLimits, b: DeliveryLimits) => DELIVERY_LIMIT_FIELDS.every(({ key }) => a[key] === b[key]);
const limitsText = (limits: DeliveryLimits) => Object.fromEntries(DELIVERY_LIMIT_FIELDS.map(({ key, unit }) => [key, limitToText(limits[key], unit)])) as Record<DeliveryLimitKey, string>;

function DeliveryLimitsForm({ current }: { current: DeliveryLimitsRead }) {
  const { queryContext } = useSession(); const client = useQueryClient();
  const key = queryKey(queryContext, DELIVERY_LIMITS, {});
  const base = current.limits;
  // What is typed, by limit; nothing until the owner edits one.
  const [draft, setDraft] = useState<Record<DeliveryLimitKey, string> | null>(null);
  const flow = useSaveFlow<DeliveryLimits>({
    what: "delivery limits", title: "Delivery limits", read: async () => { const latest = await readDeliveryLimits(); return { value: latest.limits, revision: latest.revision }; }, same: sameLimits,
    send: (limits, expected_revision, operation_id) => saveDeliveryLimits({ limits, expected_revision, operation_id }), inspect: inspectDeliveryLimitsSave,
    saved: (limits, revision) => { client.setQueryData<DeliveryLimitsRead>(key, { limits, revision }); setDraft(null); void client.invalidateQueries({ queryKey: key }); },
    reloaded: (limits, revision) => { client.setQueryData<DeliveryLimitsRead>(key, { limits, revision }); setDraft(null); },
  });
  const text = draft ?? limitsText(base);
  const parsed = DELIVERY_LIMIT_FIELDS.map(({ key, unit }) => ({ key, result: limitFromText(text[key], unit) }));
  const problems = new Map<DeliveryLimitKey, string>();
  for (const { key, result } of parsed) if ("problem" in result) problems.set(key, result.problem);
  const limits = problems.size === 0 ? Object.fromEntries(parsed.map(({ key, result }) => [key, "value" in result ? result.value : 0])) as DeliveryLimits : null;
  const changed = limits !== null && !sameLimits(limits, base);
  function edit(field: DeliveryLimitKey, value: string) {
    const next = { ...text, [field]: value };
    const unchanged = DELIVERY_LIMIT_FIELDS.every(({ key, unit }) => { const parsedNext = limitFromText(next[key], unit); return "value" in parsedNext && parsedNext.value === base[key]; });
    setDraft(unchanged ? null : next); flow.clear();
  }
  return <section className={styles.section} aria-labelledby="delivery-limits-heading">
    <h3 id="delivery-limits-heading">Delivery limits</h3>
    <p className={styles.meta}>How often and how long delivery works with git and GitHub, and how much one push may carry.</p>
    <div className={styles.limits}>
      {DELIVERY_LIMIT_FIELDS.map(({ key, label, unit, help }) => <div key={key} className={styles.field}>
        <label htmlFor={`delivery-limit-${key}`}>{label}</label>
        <div className={styles.input}>
          <input id={`delivery-limit-${key}`} inputMode="decimal" value={text[key]} disabled={flow.locked} aria-invalid={problems.has(key)} aria-describedby={`delivery-limit-${key}-help`}
            onChange={event => edit(key, event.target.value)} />
          <span>{unit}</span>
        </div>
        <p id={`delivery-limit-${key}-help`} className={styles.meta}>{help}</p>
        {problems.has(key) && <p className={styles.warning} role="alert">{label}: {problems.get(key)}</p>}
      </div>)}
    </div>
    <Toolbar><ActionButton disabled={!changed || flow.locked} onClick={() => void flow.save(base, limits!)}>{flow.pending ? "Saving…" : "Save the delivery limits"}</ActionButton></Toolbar>
    {flow.feedback}
  </section>;
}

/** The Delivery tab: the delivery document and the delivery limits. */
export function DeliverySettings() {
  const { queryContext } = useSession();
  const document = useQuery({ queryKey: queryKey(queryContext, DELIVERY_DOCUMENT, {}), queryFn: ({ signal }) => readDeliveryDocument(signal), retry: false });
  const limits = useQuery({ queryKey: queryKey(queryContext, DELIVERY_LIMITS, {}), queryFn: ({ signal }) => readDeliveryLimits(signal), retry: false });
  const unavailable = isDeliveryUnavailable(document.error) || isDeliveryUnavailable(limits.error);
  return <Panel title="Delivery" description="How finished work is delivered to GitHub: the document the delivery playbook is written from, and its limits.">
    {unavailable ? <p className={styles.meta} role="status">{DELIVERY_UNAVAILABLE}</p> : <div className={styles.sections}>
      {document.data ? <DeliveryDocumentEditor current={document.data} /> : <QueryStatus status={document.isError ? "error" : "pending"} error={document.error} label="the delivery document" onRetry={() => void document.refetch()} />}
      {limits.data ? <DeliveryLimitsForm current={limits.data} /> : <QueryStatus status={limits.isError ? "error" : "pending"} error={limits.error} label="the delivery limits" onRetry={() => void limits.refetch()} />}
    </div>}
  </Panel>;
}
