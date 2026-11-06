import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { useSession } from "../../../app/session";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { ActionButton } from "../../../components/layout/Workspace";
import { DocumentBody } from "../../knowledge/DocumentBody";
import { commentProblem, type TaskComment, type useTaskComments } from "../taskWork";
import { useCommentWrite, type CommentStatus } from "./commentActions";
import { Ago, IdValue, NotOffered } from "./common";
import { ShowAll } from "./Section";
import styles from "./Inspector.module.css";

export const COMMENTS_PREVIEW = 5;
const AUTHOR: Record<TaskComment["author"]["kind"], string> = { owner: "Owner", agent: "Agent", supervisor: "Supervisor", system: "System" };

/** Comments (spec 0004 item 13): newest first, a composer posting as the owner, edit and delete of own comments. */
export function TaskComments({ project, task, query, linkSearch }: { project: string; task: string; query: ReturnType<typeof useTaskComments>; linkSearch: string }) {
  const { bootstrap } = useSession();
  const read = bootstrap.capability("tasks.comments.read"), write = bootstrap.capability("tasks.comments.write"), actions = bootstrap.capability("dashboard.actions");
  const [all, setAll] = useState(false);
  if (!read.enabled) return <NotOffered what="Comments" reason={read.reason} />;
  const refused = !write.enabled ? write : !actions.enabled ? actions : null;
  const writable = !refused;
  const composer = !refused ? <Composer project={project} task={task} /> : <NotOffered what="Writing comments" reason={refused.reason} />;
  if (!query.data) return <>{composer}<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's comments" subject="collection" retryLabel="task comments" onRetry={() => void query.refetch()} /></>;
  const items = query.data.pages.flatMap(p => p.data.items);
  const shown = all ? items : items.slice(0, COMMENTS_PREVIEW);
  return <>
    {composer}
    <RetainedNotice query={query} />
    {!items.length ? <p className={styles.meta}>No comments yet.</p> : <ol className={styles.comments} aria-label="Comments">
      {shown.map(c => <CommentItem key={c.comment_id} comment={c} project={project} linkSearch={linkSearch} writable={writable} />)}
    </ol>}
    <div className={styles.commentPaging}>
      <ShowAll shown={COMMENTS_PREVIEW} total={items.length} noun="loaded comments" expanded={all} onShowAll={setAll} />
      {(all || items.length <= COMMENTS_PREVIEW) && query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => { setAll(true); void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "Loading older comments…" : "Load older comments"}</ActionButton>}
      <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh comments</ActionButton>
    </div>
    {query.isFetchNextPageError && <div role="alert" className={styles.meta}><p>Older comments couldn't be read. The thread may have changed; reload it from the newest comment.</p><ActionButton onClick={() => void query.refetch()}>Reload thread</ActionButton></div>}
  </>;
}

function Outcome({ status, verb, onRetry, onCheck }: { status: CommentStatus; verb: string; onRetry(): void; onCheck(): void }) {
  if (status.state === "failed") return <p role="alert" className={styles.commentError}>{status.message}</p>;
  if (status.state === "unknown") return <div role="status" className={styles.commentError}>
    <p>AQ hasn't confirmed this {verb} yet. It may still be saved; checking again won't add it twice.</p>
    <span className={styles.commentButtons}><ActionButton onClick={onCheck}>Check again</ActionButton><ActionButton onClick={onRetry}>Send the same {verb} again</ActionButton></span>
  </div>;
  return null;
}

function Composer({ project, task }: { project: string; task: string }) {
  const [body, setBody] = useState(""), [problem, setProblem] = useState<string | null>(null), id = useId();
  const write = useCommentWrite(() => setBody(""));
  const busy = write.status.state === "busy", locked = write.pending();
  return <form className={styles.composer} onSubmit={e => { e.preventDefault(); const p = commentProblem(body); setProblem(p); if (!p) write.submit({ kind: "task.comment.add", project, task, body }); }}>
    <label htmlFor={id}>Add a comment</label>
    <textarea id={id} rows={2} value={body} disabled={busy || locked} placeholder="Markdown is supported. Agents working on this task can read the thread." onChange={e => { setBody(e.target.value); setProblem(null); if (write.status.state === "failed" || write.status.state === "done") write.reset(); }} />
    {problem && <p role="alert" className={styles.commentError}>{problem}</p>}
    <Outcome status={write.status} verb="comment" onRetry={write.retry} onCheck={write.check} />
    {!locked && <span className={styles.commentButtons}><ActionButton type="submit" disabled={busy}>{busy ? "Posting…" : "Comment"}</ActionButton></span>}
    {write.status.state === "done" && <p role="status" className="visually-hidden">Comment posted</p>}
  </form>;
}

function Author({ comment: c, linkSearch }: { comment: TaskComment; linkSearch: string }) {
  const a = c.author, kind = AUTHOR[a.kind];
  if ((a.kind === "agent" || a.kind === "supervisor") && a.session_id) return <span className={styles.commentAuthor} data-author={a.kind}>
    <strong>{kind}</strong> <Link to={{ pathname: `/agents/${encodeURIComponent(a.session_id)}`, search: linkSearch }}>session {a.session_id.slice(0, 8)}</Link>
    {a.attempt_id && <> · attempt <IdValue id={a.attempt_id} label="comment attempt ID" /></>}
  </span>;
  return <span className={styles.commentAuthor} data-author={a.kind}><strong>{a.display_name ?? kind}</strong>{a.display_name && <span className={styles.meta}> {kind}</span>}</span>;
}

/** The comment version an edit started from: a save sends this revision, so AQ refuses it if the comment changed since. */
type EditBase = { revision: string; body: string };

function CommentItem({ comment: c, project, linkSearch, writable }: { comment: TaskComment; project: string; linkSearch: string; writable: boolean }) {
  const [mode, setMode] = useState<"read" | "edit" | "delete">("read"), [draft, setDraft] = useState(c.body ?? ""), [problem, setProblem] = useState<string | null>(null), id = useId();
  const [base, setBase] = useState<EditBase>({ revision: c.revision, body: c.body ?? "" }), [rebased, setRebased] = useState(false);
  const item = useRef<HTMLLIElement>(null), returnTo = useRef<"edit" | "delete" | "item" | null>(null);
  const finish = (focus: "edit" | "delete" | "item") => { returnTo.current = focus; setMode("read"); };
  const edit = useCommentWrite(() => finish("edit")), remove = useCommentWrite(() => finish("item"));
  // Focus returns to the control that opened the form, or to the comment itself (its tombstone after a delete, P1-11).
  useEffect(() => {
    const target = returnTo.current;
    if (!target || mode !== "read") return;
    returnTo.current = null;
    const button = target === "item" ? null : item.current?.querySelector<HTMLElement>(`[data-comment-${target}]`);
    if (button) { button.focus(); return; }
    // The comment itself takes focus only for this move, so a click on its text never focuses it.
    const li = item.current;
    if (!li) return;
    li.tabIndex = -1; li.addEventListener("blur", () => li.removeAttribute("tabindex"), { once: true }); li.focus();
  });
  /*
   * Three-way edit (as WDR-01 does for task edits): when the comment changes while it is being edited, a draft the
   * user hasn't touched simply follows the new version; a changed draft keeps the user's text and shows AQ's
   * version, and Save waits until the user chooses one. A save is never retargeted at a version they haven't seen.
   */
  const changed = mode === "edit" && !c.deleted_at && c.revision !== base.revision;
  useEffect(() => {
    if (!changed) return;
    const now = { revision: c.revision, body: c.body ?? "" };
    if (draft === base.body) { setDraft(now.body); setBase(now); setRebased(true); }
    else if (draft === now.body) setBase(now);
  }, [changed, c.revision, c.body, draft, base.body]);
  if (c.deleted_at) return <li ref={item} className={styles.comment} data-comment={c.comment_id} data-deleted="">
    <p className={styles.commentHead}><Author comment={c} linkSearch={linkSearch} /> · <Ago at={c.created_at} /></p>
    <p className={styles.tombstone}>Comment deleted <Ago at={c.deleted_at} /></p>
  </li>;
  const own = writable && c.can_edit;
  const conflict = changed && draft !== base.body && draft !== (c.body ?? "");
  const startEdit = () => { setDraft(c.body ?? ""); setBase({ revision: c.revision, body: c.body ?? "" }); setRebased(false); edit.reset(); setMode("edit"); };
  return <li ref={item} className={styles.comment} data-comment={c.comment_id}>
    <p className={styles.commentHead}><Author comment={c} linkSearch={linkSearch} /> · <Ago at={c.created_at} />{c.edited_at && <span className={styles.meta} title={`Edited ${c.edited_at}`}> · edited</span>}</p>
    {mode === "edit" ? <form className={styles.composer} onSubmit={e => { e.preventDefault(); if (conflict) return; const p = commentProblem(draft); setProblem(p); if (!p) edit.submit({ kind: "task.comment.edit", project, comment: c.comment_id, revision: base.revision, body: draft }); }}>
      <label htmlFor={id} className="visually-hidden">Edit comment</label>
      {conflict && <div className={styles.conflict} role="group" aria-label="Newer version of this comment" data-comment-conflict="">
        <p>This comment was changed after you started editing it. AQ's version is below; your draft is kept in the box. Choose which to keep before saving.</p>
        <div className={styles.commentBody} data-current-version=""><DocumentBody body={c.body ?? ""} links quotes /></div>
        <span className={styles.commentButtons}>
          <ActionButton onClick={() => { setDraft(c.body ?? ""); setBase({ revision: c.revision, body: c.body ?? "" }); edit.reset(); }}>Use AQ's version</ActionButton>
          <ActionButton onClick={() => { setBase({ revision: c.revision, body: c.body ?? "" }); edit.reset(); }}>Keep my draft</ActionButton>
        </span>
      </div>}
      {rebased && !conflict && <p role="status" className={styles.meta}>This comment changed elsewhere while you were editing; the box now holds the newer version.</p>}
      <textarea id={id} rows={4} value={draft} disabled={edit.status.state === "busy" || edit.pending()} onChange={e => { setDraft(e.target.value); setProblem(null); setRebased(false); }} />
      {problem && <p role="alert" className={styles.commentError}>{problem}</p>}
      {!(conflict && edit.status.state === "failed") && <Outcome status={edit.status} verb="edit" onRetry={edit.retry} onCheck={edit.check} />}
      {!edit.pending() && <span className={styles.commentButtons}><ActionButton type="submit" disabled={edit.status.state === "busy" || conflict}>Save</ActionButton><ActionButton onClick={() => { setDraft(c.body ?? ""); edit.reset(); finish("edit"); }}>Cancel</ActionButton></span>}
    </form> : <div className={styles.commentBody}><DocumentBody body={c.body ?? ""} links quotes /></div>}
    {mode === "delete" && <div className={styles.composer} role="group" aria-label="Delete comment">
      <p>Delete this comment? A “comment deleted” note stays in its place.</p>
      <Outcome status={remove.status} verb="deletion" onRetry={remove.retry} onCheck={remove.check} />
      {!remove.pending() && <span className={styles.commentButtons}><ActionButton disabled={remove.status.state === "busy"} onClick={() => remove.submit({ kind: "task.comment.delete", project, comment: c.comment_id, revision: c.revision })}>Delete comment</ActionButton><ActionButton onClick={() => { remove.reset(); finish("delete"); }}>Keep it</ActionButton></span>}
    </div>}
    {own && mode === "read" && <span className={styles.commentButtons}>
      <button type="button" className={styles.linkButton} data-comment-edit="" onClick={startEdit}>Edit<span className="visually-hidden"> comment from <Ago at={c.created_at} /></span></button>
      <button type="button" className={styles.linkButton} data-comment-delete="" onClick={() => setMode("delete")}>Delete<span className="visually-hidden"> comment from <Ago at={c.created_at} /></span></button>
    </span>}
  </li>;
}
