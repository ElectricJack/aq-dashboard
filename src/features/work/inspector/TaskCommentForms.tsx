import { useId, useState } from "react";
import { ActionButton } from "../../../components/layout/Workspace";
import { DocumentBody } from "../../knowledge/DocumentBody";
import { commentProblem, type TaskComment } from "../taskWork";
import { useCommentWrite, type CommentStatus } from "./commentActions";
import type { useCommentDraft } from "./useCommentEditor";
import styles from "./Inspector.module.css";

type Write = ReturnType<typeof useCommentWrite>;

function Outcome({ status, verb, onRetry, onCheck }: { status: CommentStatus; verb: string; onRetry(): void; onCheck(): void }) {
  if (status.state === "failed") return <p role="alert" className={styles.commentError}>{status.message}</p>;
  if (status.state === "unknown") return <div role="status" className={styles.commentError}>
    <p>AQ hasn't confirmed this {verb} yet. It may still be saved; checking again won't add it twice.</p>
    <span className={styles.commentButtons}><ActionButton onClick={onCheck}>Check again</ActionButton><ActionButton onClick={onRetry}>Send the same {verb} again</ActionButton></span>
  </div>;
  return null;
}

export function Composer({ project, task }: { project: string; task: string }) {
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

export function EditComment({ editor, comment: c, project, edit, cancel }: {
  editor: ReturnType<typeof useCommentDraft>; comment: TaskComment; project: string; edit: Write; cancel(): void;
}) {
  const { conflict, rebased, draft, base, problem, setDraft } = editor;
  function save(event: React.FormEvent) {
    event.preventDefault();
    if (editor.valid()) edit.submit({ kind: "task.comment.edit", project, comment: c.comment_id, revision: base.revision, body: draft });
  }
  const id = useId();
  return <form className={styles.composer} onSubmit={save}>
      <label htmlFor={id} className="visually-hidden">Edit comment</label>
      {conflict && <CommentConflict comment={c} editor={editor} edit={edit} />}
      {rebased && !conflict && <p role="status" className={styles.meta}>This comment changed elsewhere while you were editing; the box now holds the newer version.</p>}
      <textarea id={id} rows={4} value={draft} disabled={edit.status.state === "busy" || edit.pending()} onChange={e => { editor.type(e.target.value); }} />
      {problem && <p role="alert" className={styles.commentError}>{problem}</p>}
      <EditActions edit={edit} conflict={conflict} cancel={() => { setDraft(c.body ?? ""); edit.reset(); cancel(); }} />
    </form>;
}

function EditActions({ edit, conflict, cancel }: { edit: Write; conflict: boolean; cancel(): void }) {
  return <>
      {!(conflict && edit.status.state === "failed") && <Outcome status={edit.status} verb="edit" onRetry={edit.retry} onCheck={edit.check} />}
      {!edit.pending() && <span className={styles.commentButtons}><ActionButton type="submit" disabled={edit.status.state === "busy" || conflict}>Save</ActionButton><ActionButton onClick={cancel}>Cancel</ActionButton></span>}
  </>;
}

function CommentConflict({ comment: c, editor, edit }: {
  comment: TaskComment; editor: ReturnType<typeof useCommentDraft>; edit: Write;
}) {
  return <div className={styles.conflict} role="group" aria-label="Newer version of this comment" data-comment-conflict="">
        <p>This comment was changed after you started editing it. AQ's version is below; your draft is kept in the box. Choose which to keep before saving.</p>
        <div className={styles.commentBody} data-current-version=""><DocumentBody body={c.body ?? ""} links quotes /></div>
        <span className={styles.commentButtons}>
          <ActionButton onClick={() => { editor.adoptCurrent(); edit.reset(); }}>Use AQ's version</ActionButton>
          <ActionButton onClick={() => { editor.adoptRevision(); edit.reset(); }}>Keep my draft</ActionButton>
        </span>
      </div>;
}

export function DeleteComment({ comment: c, project, remove, cancel }: { comment: TaskComment; project: string; remove: Write; cancel(): void }) {
  return <div className={styles.composer} role="group" aria-label="Delete comment">
      <p>Delete this comment? A “comment deleted” note stays in its place.</p>
      <Outcome status={remove.status} verb="deletion" onRetry={remove.retry} onCheck={remove.check} />
      {!remove.pending() && <span className={styles.commentButtons}><ActionButton disabled={remove.status.state === "busy"} onClick={() => remove.submit({ kind: "task.comment.delete", project, comment: c.comment_id, revision: c.revision })}>Delete comment</ActionButton><ActionButton onClick={() => { remove.reset(); cancel(); }}>Keep it</ActionButton></span>}
    </div>;
}
