import { useState } from "react";
import { Link } from "react-router";
import { useSession } from "../../../app/session";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../../components/QueryStatus/RetainedNotice";
import { ActionButton } from "../../../components/layout/Workspace";
import { DocumentBody } from "../../knowledge/DocumentBody";
import { type TaskComment, type useTaskComments } from "../taskWork";
import { useCommentWrite } from "./commentActions";
import { Ago, IdValue, NotOffered } from "./common";
import { ShowAll } from "./Section";
import { useCommentDraft, useCommentMode } from "./useCommentEditor";
import { Composer, EditComment, DeleteComment } from "./TaskCommentForms";
import styles from "./Inspector.module.css";

export const COMMENTS_PREVIEW = 5;
const AUTHOR: Record<TaskComment["author"]["kind"], string> = { owner: "Owner", agent: "Agent", supervisor: "Supervisor", system: "System" };

/** Comments (spec 0004 item 13): newest first, a composer posting as the owner, edit and delete of own comments. */
export function TaskComments({ project, task, query, linkSearch }: { project: string; task: string; query: ReturnType<typeof useTaskComments>; linkSearch: string }) {
  const { bootstrap } = useSession();
  const read = bootstrap.capability("tasks.comments.read"), write = bootstrap.capability("tasks.comments.write"), actions = bootstrap.capability("dashboard.actions");
  const [all, setAll] = useState(false);
  if (!read.enabled) return <NotOffered what="Comments" reason={read.reason} />;
  const refused = [write, actions].find(capability => !capability.enabled);
  const writable = !refused;
  const composer = !refused ? <Composer project={project} task={task} /> : <NotOffered what="Writing comments" reason={refused.reason} />;
  if (!query.data) return <>{composer}<QueryStatus status={query.isError ? "error" : "pending"} error={query.error} label="this task's comments" subject="collection" retryLabel="task comments" onRetry={() => void query.refetch()} /></>;
  const items = query.data.pages.flatMap(p => p.data.items);
  const shown = all ? items : items.slice(0, COMMENTS_PREVIEW);
  return <>
    {composer}
    <RetainedNotice query={query} />
    {items.length > 0 && <ol className={styles.comments} aria-label="Comments">
      {shown.map(c => <CommentItem key={c.comment_id} comment={c} project={project} linkSearch={linkSearch} writable={writable} />)}
    </ol>}
    <CommentPaging all={all} setAll={setAll} total={items.length} query={query} />
    <OlderCommentError query={query} />
  </>;
}

function OlderCommentError({ query }: { query: ReturnType<typeof useTaskComments> }) {
  if (!query.isFetchNextPageError) return null;
  return <div role="alert" className={styles.meta}><p>Older comments couldn't be read. The thread may have changed; reload it from the newest comment.</p><ActionButton onClick={() => void query.refetch()}>Reload thread</ActionButton></div>;
}

function CommentPaging({ all, setAll, total, query }: {
  all: boolean; setAll(value: boolean): void; total: number; query: ReturnType<typeof useTaskComments>;
}) {
  return <div className={styles.commentPaging} data-comment-paging="">
      {!total && <p className={styles.meta}>No comments yet.</p>}
      <ShowAll shown={COMMENTS_PREVIEW} total={total} noun="loaded comments" expanded={all} onShowAll={setAll} />
      {(all || total <= COMMENTS_PREVIEW) && query.hasNextPage && <ActionButton disabled={query.isFetchingNextPage} onClick={() => { setAll(true); void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "Loading older comments…" : "Load older comments"}</ActionButton>}
      <ActionButton disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh comments</ActionButton>
    </div>;
}

function Author({ comment: c, linkSearch }: { comment: TaskComment; linkSearch: string }) {
  const a = c.author, kind = AUTHOR[a.kind];
  if (["agent", "supervisor"].includes(a.kind) && a.session_id) return <span className={styles.commentAuthor} data-author={a.kind}>
    <strong>{kind}</strong> <Link to={{ pathname: `/agents/${encodeURIComponent(a.session_id)}`, search: linkSearch }}>session {a.session_id.slice(0, 8)}</Link>
    {a.attempt_id && <> · attempt <IdValue id={a.attempt_id} label="comment attempt ID" /></>}
  </span>;
  return <span className={styles.commentAuthor} data-author={a.kind}><strong>{a.display_name ?? kind}</strong>{a.display_name && <span className={styles.meta}> {kind}</span>}</span>;
}


function CommentHeader({ comment, linkSearch, edited }: { comment: TaskComment; linkSearch: string; edited?: string | null }) {
  return <p className={styles.commentHead}>
    <Author comment={comment} linkSearch={linkSearch} /> · <Ago at={comment.created_at} />
    {edited && <span className={styles.meta} title={`Edited ${edited}`}> · edited</span>}
  </p>;
}

type ItemProps = { comment: TaskComment; project: string; linkSearch: string; writable: boolean };
function CommentItem({ comment: c, project, linkSearch, writable }: ItemProps) {
  const { mode, setMode, item, finish } = useCommentMode();
  const edit = useCommentWrite(() => finish("edit")), remove = useCommentWrite(() => finish("item"));
  const editor = useCommentDraft(c, mode);
  if (c.deleted_at) return <li ref={item} className={styles.comment} data-comment={c.comment_id} data-deleted="">
    <CommentHeader comment={c} linkSearch={linkSearch} />
    <p className={styles.tombstone}>Comment deleted <Ago at={c.deleted_at} /></p>
  </li>;
  const own = writable && c.can_edit;
  return <li ref={item} className={styles.comment} data-comment={c.comment_id}>
    <CommentHeader comment={c} linkSearch={linkSearch} edited={c.edited_at} />
    {mode === "edit" ? <EditComment editor={editor} comment={c} project={project} edit={edit} cancel={() => finish("edit")} /> : <div className={styles.commentBody}><DocumentBody body={c.body ?? ""} links quotes /></div>}
    {mode === "delete" && <DeleteComment comment={c} project={project} remove={remove} cancel={() => finish("delete")} />}
    {own && mode === "read" && <span className={styles.commentButtons}>
      <button type="button" className={styles.linkButton} data-comment-edit="" onClick={() => { editor.start(); edit.reset(); setMode("edit"); }}>Edit<span className="visually-hidden"> comment from <Ago at={c.created_at} /></span></button>
      <button type="button" className={styles.linkButton} data-comment-delete="" onClick={() => setMode("delete")}>Delete<span className="visually-hidden"> comment from <Ago at={c.created_at} /></span></button>
    </span>}
  </li>;
}
