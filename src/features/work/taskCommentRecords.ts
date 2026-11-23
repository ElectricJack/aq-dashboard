import { useTaskPages } from "./taskGraphPanels";
import { isRecord } from "../../api/adapters/contract";
import { adaptGraphEnvelope, validGraphId } from "../../api/adapters/humanGraph";
import { boundedList, boundedString, check, cursor, sequence, taskRecord, text, time } from "./taskWorkFields";

export type CommentAuthor = { kind: "owner" | "agent" | "supervisor" | "system"; user_id: string | null; display_name: string | null; session_id: string | null; attempt_id: string | null };
export type TaskComment = { comment_id: string; task_id: string; author: CommentAuthor; body: string | null; created_at: string; edited_at: string | null; deleted_at: string | null; revision: string; can_edit: boolean };
export type TaskComments = { task_id: string; items: TaskComment[]; next_cursor: string | null };
export const COMMENTS_PAGE = 50;
/** Markdown body bound (§4.1): nonblank, 16 KiB of UTF-8, no control characters but tab, LF and CR. */
export const COMMENT_MAX_BYTES = 16384;
function readAuthor(raw: unknown): CommentAuthor {
  check(isRecord(raw));
  check(["owner", "agent", "supervisor", "system"].includes(raw.kind as string));
  check(raw.user_id === null || validGraphId(raw.user_id));
  check(raw.session_id === null || validGraphId(raw.session_id));
  check(raw.attempt_id === null || validGraphId(raw.attempt_id));
  check(raw.display_name === null || boundedString(raw.display_name, 320));
  return { kind: raw.kind as CommentAuthor["kind"], user_id: raw.user_id, display_name: raw.display_name, session_id: raw.session_id, attempt_id: raw.attempt_id };
}

function readComment(data: unknown, id: string): TaskComment {
  const value = taskRecord(data, id);
  check(validGraphId(value.comment_id));
  check(time(value.created_at));
  check(value.edited_at === null || time(value.edited_at));
  check(value.deleted_at === null || time(value.deleted_at));
  check(sequence(value.revision));
  check(typeof value.can_edit === "boolean");
  // A tombstone has no body. A live comment has a nonempty one.
  check(value.deleted_at === null ? text(value.body, COMMENT_MAX_BYTES) : value.body === null);
  return {
    comment_id: value.comment_id, task_id: id, author: readAuthor(value.author), body: value.body as string | null,
    created_at: value.created_at, edited_at: value.edited_at, deleted_at: value.deleted_at, revision: value.revision,
    can_edit: value.can_edit && value.deleted_at === null,
  };
}

export function adaptTaskComments(raw: unknown, project: string, id: string) {
  return adaptGraphEnvelope(raw, project, (data): TaskComments => {
    const value = taskRecord(data, id);
    check(boundedList(value.items, 100));
    const items = value.items.map(item => readComment(item, id));
    check(new Set(items.map(comment => comment.comment_id)).size === items.length);
    return { task_id: id, items, next_cursor: cursor(value.next_cursor) };
  });
}

/** Why a comment body can't be sent, or null. */
export function commentProblem(body: string): string | null {
  if (!body.trim()) return "Write a comment first.";
  if (new TextEncoder().encode(body).length > COMMENT_MAX_BYTES) return "Comments can be at most 16 KB. Shorten this one.";
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(body)) return "Remove the control characters from this comment.";
  return null;
}

/** `GET …/tasks/{t}/comments`: newest first, 50 per page; older pages on request (cursors last 10 minutes). */
export function useTaskComments(project: string, id: string, enabled: boolean) {
  return useTaskPages({ project, id }, {
    key: "task-comments", section: "comments", adapt: adaptTaskComments, pageSize: COMMENTS_PAGE, enabled,
  });
}
