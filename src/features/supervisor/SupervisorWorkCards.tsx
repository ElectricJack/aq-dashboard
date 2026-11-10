import { useId, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { validateTaskDraft, type TaskDraft } from "../../api/adapters/taskCreate";
import { supervisorId, type ActionReceiptAttachment } from "../../api/adapters/supervisor";
import type { ActionOperation } from "../actions/actionClient";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./SupervisorConversation.module.css";

/** F2 task.create payload subset. The future typed conversation owner supplies
 * the project/revision and pending-safe action handler; prose never enters here. */
export function SupervisorTaskProposal({ draft: initial, onCreate, pending = false }: { draft: TaskDraft | Omit<TaskDraft, "task_state"> & { task_state: string }; onCreate: (draft: TaskDraft) => void; pending?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<TaskDraft>({ title: initial.title, body: initial.body, acceptance_criteria: initial.acceptance_criteria, task_state: initial.task_state === "active" ? "active" : "draft" });
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => { event.preventDefault(); if (pending) return; const problem = validateTaskDraft(draft); setError(problem); if (!problem) onCreate({ ...draft }); };
  return <form className={styles.workCard} onSubmit={submit} aria-label="Proposed task">
    <h3>Draft feedback task</h3><p>Review and edit the scope before creating this task.</p>
    <label htmlFor={`${id}-title`}>Task title</label><input id={`${id}-title`} value={draft.title} disabled={pending} onChange={event => setDraft({ ...draft, title: event.target.value })} />
    <label htmlFor={`${id}-body`}>Description</label><textarea id={`${id}-body`} value={draft.body} disabled={pending} onChange={event => setDraft({ ...draft, body: event.target.value })} />
    <label htmlFor={`${id}-acceptance`}>Acceptance criteria</label><textarea id={`${id}-acceptance`} value={draft.acceptance_criteria} disabled={pending} onChange={event => setDraft({ ...draft, acceptance_criteria: event.target.value })} />
    {error && <p role="status">{error}</p>}<ActionButton type="submit" disabled={pending}>{pending ? "Creating…" : "Create task"}</ActionButton>
  </form>;
}
/** Only operation receipts validated by their action owner may be supplied. */
export function SupervisorWorkReceipt({ operation, kind }: { operation: ActionOperation; kind: "task.create" | "task.graph.create" }) {
  if (operation.disposition !== "confirmed") return <p role="status">Task creation {operation.disposition}. No task creation is confirmed.</p>;
  const tasks = operation.affected_entities.filter(ref => ref.type === "task" && supervisorId(ref.id));
  if (!tasks.length) return null;
  return <div className={styles.workCard}><h3>{kind === "task.graph.create" ? "Dispatched task graph" : "Dispatched task"}</h3><p>Creation confirmed · execution is tracked in Work.</p>{tasks.map(ref => <Link key={ref.id} to={`/work/${encodeURIComponent(ref.id)}`}>Open task {ref.id}{ref.revision ? ` · revision ${ref.revision}` : ""}</Link>)}</div>;
}

/** History contains server-verified receipts bound to this supervisor session. */
export function SupervisorHistoryReceipt({receipt}:{receipt:ActionReceiptAttachment}) {
 return <div className={styles.workCard}><h3>{receipt.kind==='task.graph.create'?'Task graph created':'Task created'}</h3><p>Creation confirmed · execution is tracked in Work.</p>{receipt.created_task_ids.map(id=><Link key={id} to={`/work/${encodeURIComponent(id)}`}>Open task {id.slice(0,8)}</Link>)}</div>;
}
