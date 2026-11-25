import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isHttpClientError, ApiError } from "../../api/client";
import { queryKey } from "../../api/queryKeys";
import { deleteDocument, problemsOf, problemText, ROLE_SETTINGS, saveDocument, useDocuments, useProfileLimits, useProfileSnapshot, type DocumentFields, type DocumentKind, type Problem, type SettingsDocument } from "../../api/roleSettings";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { useIntelligenceDraft } from "./IntelligenceDrafts";
import { documentId, frontmatterValue, isDocumentId, setFrontmatterValue } from "./profileMarkdown";
import { ProfileStoreLimits } from "./ProfileStoreLimits";
import { Timestamp } from "./Timestamp";
import { actionError, conflictNotice, isConflict, saveRefusal, type DocumentAction, type Pending, type RowAlert, type Status } from "./profileDocumentStatus";
import styles from "./ProfileDocuments.module.css";

/** What one kind of document needs from the shared list and editor. */
export type DocumentsConfig<K extends DocumentKind> = {
  kind: K;
  /** The section heading and its level: "Roles", 2. */
  title: string; level: 2 | 3;
  description: string;
  /** One document, in lower case: "role". */
  noun: string;
  /** The columns after the name, read from the fields the server parsed. */
  columns: { header: string; cell(fields: DocumentFields[K]): ReactNode }[];
  /** How the server understood the saved document. */
  summary(fields: DocumentFields[K]): ReactNode;
  /** A form over part of the Markdown; it writes the Markdown, which stays the source. */
  structured?(props: { markdown: string; disabled: boolean; onChange(markdown: string): void }): ReactNode;
  /** The starting text of a new document. */
  template(): string;
  /** Roles only: an Enabled switch that rewrites the document's `enabled` line. */
  enabledSwitch?: boolean;
  /** Where the page-level Save takes this section, among the others. */
  order: number;
  /** The order of the list by document id; without it the documents stay in the server's order. */
  compare?(a: string, b: string): number;
  /** Shown directly under the list: what belongs to a column of it (for example a column's unsaved entries). */
  belowList?: ReactNode;
};

/** The key of the one new, unsaved document; never a valid id. */
const NEW = "+new";
function ProblemList({ title, problems }: { title: string; problems: Problem[] }) {
  return <div className={styles.problems} role="alert"><p>{title}</p><ul>{problems.map((problem, i) => <li key={i}>{problemText(problem)}</li>)}</ul></div>;
}

/** The active snapshot the saved documents compile into (a short digest and the store revision), and the store's limits beside it. `scope` is the tab it is on. */
export function ProfileSnapshotNote({ scope }: { scope: string }) {
  const query = useProfileSnapshot();
  const digest = query.data?.active_digest;
  return <div className={styles.store}>
    {query.data && <p className={styles.snapshot}>{digest ? <>Active snapshot <code title={digest}>{digest.slice(0, 12)}</code></> : "No active snapshot yet"} · revision {query.data.revision}</p>}
    <ProfileStoreLimits scope={scope} />
  </div>;
}

/** The list of one kind of document and the editor for one of them. The Markdown is what is saved; the summary is what the server made of it. */
export function ProfileDocuments<K extends DocumentKind>({ config }: { config: DocumentsConfig<K> }) {
  const { kind, title, noun } = config;
  const { queryContext } = useSession();
  const client = useQueryClient();
  const query = useDocuments(kind);
  const limits = useProfileLimits();
  const [open, setOpen] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [alert, setAlert] = useState<RowAlert | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const headingId = useId(), editorId = useId();
  const editorHeading = useRef<HTMLHeadingElement>(null), newButton = useRef<HTMLButtonElement>(null), confirmButton = useRef<HTMLButtonElement>(null);
  const focusEditor = useRef(false);
  const { compare } = config;
  const documents = compare ? [...query.data?.documents ?? []].sort((a, b) => compare(a.id, b.id)) : query.data?.documents ?? [];
  const byId = new Map(documents.map(document => [document.id, document]));
  const nameOf = (document: SettingsDocument<K>) => document.fields?.name || document.id;
  const isDirty = (key: string) => drafts[key] !== undefined && (key === NEW || drafts[key] !== byId.get(key)?.markdown);
  const dirtyKeys = Object.keys(drafts).filter(isDirty);
  const setStatus = (key: string, status: Status) => setStatuses(old => ({ ...old, [key]: status }));
  const dropDraft = (key: string) => setDrafts(old => { const next = { ...old }; delete next[key]; return next; });
  useEffect(() => { if (focusEditor.current && open) { focusEditor.current = false; editorHeading.current?.focus(); editorHeading.current?.scrollIntoView?.({ block: "nearest" }); } }, [open]);
  useEffect(() => { if (confirming) confirmButton.current?.focus(); }, [confirming]);

  /** Every read of these Settings is refreshed: a save changes the snapshot, and may change what other documents refer to. */
  async function refresh() {
    void client.invalidateQueries({ queryKey: queryKey(queryContext, ROLE_SETTINGS, {}).slice(0, 5) });
    const result = await query.refetch();
    if (result.isError) throw result.error;
  }
  function pendingFor(key: string): Pending | string {
    const markdown = drafts[key] ?? byId.get(key)?.markdown ?? "";
    if (key !== NEW) return { key, id: key, request: { markdown, expected_revision: byId.get(key)?.revision ?? "0", operation_id: crypto.randomUUID() } };
    const id = documentId(markdown);
    if (!id || !isDocumentId(id)) return `Give the ${noun} an id on its “id:” line: a lowercase letter followed by lowercase letters, digits or “-”.`;
    return { key, id, request: { markdown, expected_revision: "0", operation_id: crypto.randomUUID() } };
  }
  async function send(pending: Pending): Promise<boolean> {
    if (busy) return false;
    const { key, id } = pending;
    setBusy(key); setStatus(key, {}); setNotice(null); setAlert(null);
    try {
      await saveDocument(kind, id, pending.request);
      // The saved text is the server's now; a failed re-read must not bring the draft back as unsaved.
      await refresh().catch(() => undefined);
      dropDraft(key);
      setStatuses(old => ({ ...old, [key]: {}, [id]: { notice: "Saved." } }));
      if (key === NEW && open === NEW) setOpen(id);
      return true;
    } catch (error) {
      if (isConflict(error)) {
        await refresh().catch(() => undefined);
        setStatus(key, { error: conflictNotice(noun, pending) });
      } else if (isHttpClientError(error)) {
        setStatus(key, saveRefusal(error, noun));
      } else setStatus(key, { error: "The save could not be confirmed. Your text is kept. Retrying sends the same save again; AQ applies it once.", retry: pending });
      return false;
    } finally { setBusy(null); }
  }
  async function save(key: string): Promise<boolean> {
    const pending = pendingFor(key);
    if (typeof pending === "string") { setStatus(key, { error: pending }); return false; }
    return send(pending);
  }
  async function saveAll(): Promise<boolean> {
    for (const key of dirtyKeys) if (!await save(key)) return false;
    return true;
  }
  /** A change made from the list (delete, enable, disable): refusals are shown under the list in the server's words. */
  async function act(document: SettingsDocument<K>, { verb, run, done }: DocumentAction): Promise<boolean> {
    if (busy) return false;
    const name = nameOf(document);
    setBusy(document.id); setAlert(null); setNotice(null); setConfirming(null);
    try {
      await run({ expected_revision: document.revision, operation_id: crypto.randomUUID() });
      await refresh().catch(() => undefined);
      setNotice(done);
      return true;
    } catch (error) {
      const problems = problemsOf(error), status = error instanceof ApiError ? error.status : undefined;
      if (status === 409 || status === 404) await refresh().catch(() => undefined);
      setAlert({ title: `AQ did not ${verb} “${name}”:`, problems, ...(problems.length ? {} : { error: actionError(error, noun) }) });
      return false;
    } finally { setBusy(null); }
  }
  async function remove(document: SettingsDocument<K>) {
    if (!await act(document, { verb: "delete", run: fence => deleteDocument(kind, document.id, fence), done: `Deleted “${nameOf(document)}”.` })) return;
    dropDraft(document.id);
    if (open === document.id) setOpen(null);
    newButton.current?.focus();
  }
  function setEnabled(document: SettingsDocument<K>, enabled: boolean) {
    const markdown = setFrontmatterValue(document.markdown, "enabled", String(enabled));
    if (markdown === null) { setAlert({ title: `“${nameOf(document)}” could not be changed:`, problems: [], error: "Its text has no frontmatter to edit. Open it and edit the Markdown." }); return; }
    void act(document, { verb: enabled ? "enable" : "disable", run: fence => saveDocument(kind, document.id, { ...fence, markdown }), done: null });
  }
  function show(key: string) { focusEditor.current = true; setOpen(key); if (key === open) editorHeading.current?.focus(); }
  function edit({ key, markdown }: { key: string; markdown: string }) { setDrafts(old => ({ ...old, [key]: markdown })); setStatuses(old => ({ ...old, [key]: {} })); }

  const coordinator = useIntelligenceDraft({ id: `documents:${kind}`, label: title.toLowerCase(), dirty: dirtyKeys.length > 0, locked: busy !== null, save: saveAll, order: config.order });
  const locked = busy !== null || coordinator.saving;
  const Heading = `h${config.level}` as "h2" | "h3", SubHeading = `h${config.level + 1}` as "h3" | "h4", SummaryHeading = `h${config.level + 2}` as "h4" | "h5";
  const openDocument = open && open !== NEW ? byId.get(open) : undefined;
  const editing = open !== null && (open === NEW ? drafts[NEW] !== undefined : openDocument !== undefined || drafts[open] !== undefined);
  const text = open === null ? "" : drafts[open] ?? openDocument?.markdown ?? "";
  const status = (open && statuses[open]) || {};
  const bytes = new TextEncoder().encode(text).length, maxBytes = limits.data?.limits.documents.max_document_bytes;
  const openName = open === NEW ? `New ${noun}` : openDocument ? nameOf(openDocument) : open ?? "";

  return <section className={styles.documents} aria-labelledby={headingId}>
    <div className={styles.toolbar}>
      <div><Heading id={headingId}>{title}</Heading><p className={styles.meta}>{config.description}</p></div>
      <ActionButton ref={newButton} disabled={!query.data || locked} onClick={() => { if (drafts[NEW] === undefined) edit({ key: NEW, markdown: config.template() }); show(NEW); }}>New {noun}</ActionButton>
    </div>
    {!query.data ? <QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label={title.toLowerCase()} onRetry={() => void query.refetch()} /> : <>
      {query.isError && <p className={styles.warning} role="status">{title} could not be refreshed. Showing the last saved view.</p>}
      {documents.length === 0 ? <p className={styles.meta}>No {title.toLowerCase()} yet.</p> : <>
        <p className={styles.scrollHint}>Scroll horizontally to see every column.</p>
        <div className={styles.tableWrap} role="region" aria-label={`${title}, scroll horizontally`} tabIndex={0}>
          <table className={styles.table} aria-label={title}>
            <thead><tr><th scope="col">Name</th>{config.columns.map(column => <th key={column.header} scope="col">{column.header}</th>)}{config.enabledSwitch && <th scope="col">Enabled</th>}<th scope="col">Actions</th></tr></thead>
            <tbody>{documents.map(document => {
              const name = nameOf(document), fields = document.fields;
              const enabled = (fields as { enabled?: boolean } | null)?.enabled;
              return <tr key={document.id} aria-label={name} data-document-id={document.id} data-open={open === document.id || undefined}>
                <td><div className={styles.name}><strong>{name}</strong><span>{document.id}</span>{isDirty(document.id) && <span>Unsaved changes</span>}</div></td>
                {fields ? config.columns.map(column => <td key={column.header}>{column.cell(fields)}</td>)
                  : <td colSpan={config.columns.length} className={styles.warning}>AQ cannot read this {noun}: {document.problem}</td>}
                {config.enabledSwitch && <td>{enabled === undefined ? "—" : <label className={styles.switch}>
                  <input type="checkbox" role="switch" aria-label={`${name} enabled`} checked={enabled} disabled={locked || isDirty(document.id)} title={isDirty(document.id) ? "Save or discard your changes first" : undefined} onChange={event => setEnabled(document, event.target.checked)} />
                  {enabled ? "Enabled" : "Disabled"}</label>}</td>}
                <td>{confirming === document.id ? <div className={styles.confirm} role="group" aria-label={`Confirm delete ${name}`}>
                  <span>Delete “{name}”? AQ refuses when something still refers to it.</span>
                  <div className={styles.rowActions}><ActionButton ref={confirmButton} disabled={locked} aria-label={`Confirm delete ${name}`} onClick={() => void remove(document)}>Confirm delete</ActionButton>
                    <ActionButton disabled={locked} onClick={() => setConfirming(null)}>Cancel</ActionButton></div>
                </div> : <div className={styles.rowActions}>
                  <ActionButton aria-label={`Edit ${name}`} aria-expanded={open === document.id} aria-controls={open === document.id ? editorId : undefined} onClick={() => show(document.id)}>Edit</ActionButton>
                  <ActionButton aria-label={`Delete ${name}`} disabled={locked} onClick={() => setConfirming(document.id)}>{busy === document.id ? "Working…" : "Delete"}</ActionButton>
                </div>}</td>
              </tr>;
            })}</tbody>
          </table>
        </div>
        {config.belowList}
      </>}
      {notice && <p className={styles.success} role="status">{notice}</p>}
      {alert && (alert.problems.length ? <ProblemList title={alert.title} problems={alert.problems} /> : <p className={styles.warning} role="alert">{alert.title} {alert.error}</p>)}
      {editing && open !== null && <section id={editorId} className={styles.editor} aria-label={open === NEW ? `New ${noun}` : `Edit ${openName}`}>
        <SubHeading ref={editorHeading} tabIndex={-1}>{openName}</SubHeading>
        {open !== NEW && !openDocument && <p className={styles.warning} role="status">This {noun} is no longer saved in AQ. Saving your text creates it again.</p>}
        {config.structured?.({ markdown: text, disabled: locked, onChange: markdown => edit({ key: open, markdown }) })}
        <div className={styles.beside}>
          <div className={styles.document}>
            {config.enabledSwitch && frontmatterValue(text, "id") !== null && <label className={styles.switch}>
              <input type="checkbox" role="switch" checked={frontmatterValue(text, "enabled") !== "false"} disabled={locked} onChange={event => { const next = setFrontmatterValue(text, "enabled", String(event.target.checked)); if (next !== null) edit({ key: open, markdown: next }); }} />
              Hand this {noun} new work</label>}
            <label className={styles.label} htmlFor={`${editorId}-text`}>Markdown</label>
            <textarea id={`${editorId}-text`} className={styles.text} data-short={config.structured ? true : undefined} value={text} disabled={locked} spellCheck={false} onChange={event => edit({ key: open, markdown: event.target.value })} />
            <p className={styles.note}>{bytes.toLocaleString()}{maxBytes !== undefined && ` / ${maxBytes.toLocaleString()}`} bytes</p>
            {maxBytes !== undefined && bytes > maxBytes && <p className={styles.warning} role="alert">A document can be at most {maxBytes.toLocaleString()} bytes.</p>}
          </div>
          <div className={styles.summary}>
            {status.problems && status.problems.length > 0 && <ProblemList title={`AQ did not save this ${noun}:`} problems={status.problems} />}
            <SummaryHeading>How AQ reads the saved {noun}</SummaryHeading>
            {!openDocument ? <p className={styles.meta}>Save the {noun} to see how AQ reads it.</p> : <>
              {openDocument.fields ? config.summary(openDocument.fields) : <p className={styles.warning}>AQ cannot read the saved text: {openDocument.problem}</p>}
              <p className={styles.note}>Revision {openDocument.revision} · saved <Timestamp iso={new Date(openDocument.updated_at_ms).toISOString()} /></p>
              {isDirty(open) && <><p className={styles.note}>This is the saved version. Save to see how AQ reads your changes.</p>
                <details><summary>Saved Markdown</summary><pre className={styles.saved} tabIndex={0}>{openDocument.markdown}</pre></details></>}
            </>}
          </div>
        </div>
        <div className={styles.actions}>
          <ActionButton className={styles.primary} aria-label={`Save ${noun}`} disabled={locked || !isDirty(open)} onClick={() => void save(open)}>{busy === open ? "Saving…" : "Save"}</ActionButton>
          {isDirty(open) && <ActionButton disabled={locked} onClick={() => { dropDraft(open); setStatus(open, {}); if (open === NEW) { setOpen(null); newButton.current?.focus(); } }}>Discard changes</ActionButton>}
          {status.retry && <ActionButton disabled={locked} onClick={() => void send(status.retry!)}>Retry save</ActionButton>}
          <ActionButton disabled={busy === open} onClick={() => setOpen(null)}>Close</ActionButton>
          {status.notice && !isDirty(open) && <span className={styles.success} role="status">{status.notice}</span>}
        </div>
        {status.error && <p className={styles.warning} role="alert">{status.error}</p>}
      </section>}
    </>}
  </section>;
}
