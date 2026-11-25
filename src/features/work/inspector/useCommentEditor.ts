import { useEffect, useRef, useState } from "react";
import { commentProblem, type TaskComment } from "../taskWork";

/** The comment version an edit started from: a save sends this revision, so AQ refuses it if the comment changed since. */
type EditBase = { revision: string; body: string };


type CommentMode = "read" | "edit" | "delete";
export function useCommentMode() {
  const [mode, setMode] = useState<CommentMode>("read");
  const item = useRef<HTMLLIElement>(null), returnTo = useRef<"edit" | "delete" | "item" | null>(null);
  const finish = (focus: "edit" | "delete" | "item") => { returnTo.current = focus; setMode("read"); };
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
  return { mode, setMode, item, finish };
}

export function useCommentDraft(c: TaskComment, mode: CommentMode) {
  const sourceBody = c.body ?? "";
  const current = () => ({ revision: c.revision, body: sourceBody });
  const [draft, setDraft] = useState(current().body);
  const [base, setBase] = useState<EditBase>(current);
  const [problem, setProblem] = useState<string | null>(null);
  const [rebased, setRebased] = useState(false);
  /*
   * Three-way edit (as WDR-01 does for task edits): when the comment changes while it is being edited, a draft the
   * user hasn't touched simply follows the new version; a changed draft keeps the user's text and shows AQ's
   * version, and Save waits until the user chooses one. A save is never retargeted at a version they haven't seen.
   */
  const changed = mode === "edit" && !c.deleted_at && c.revision !== base.revision;
  useEffect(() => {
    if (!changed) return;
    const now = current();
    if (draft === base.body) { setDraft(now.body); setBase(now); setRebased(true); }
    else if (draft === now.body) setBase(now);
  }, [changed, c.revision, c.body, draft, base.body]);
  const conflict = changed && ![base.body, sourceBody].includes(draft);
  function adoptCurrent() { setDraft(current().body); setBase(current()); }
  function type(text: string) { setDraft(text); setProblem(null); setRebased(false); }
  function valid() {
    if (conflict) return false;
    const problem = commentProblem(draft);
    setProblem(problem);
    return !problem;
  }
  return { draft, setDraft, base, problem, rebased, conflict, valid, type, adoptCurrent,
    start() { adoptCurrent(); setRebased(false); }, adoptRevision() { setBase(current()); } };
}

