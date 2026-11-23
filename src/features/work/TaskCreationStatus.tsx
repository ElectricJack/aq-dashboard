import {OperationActions} from "./TaskCreationActions";
import type { TaskComposer } from "./useTaskComposer";
import styles from "./CreateTask.module.css";

const outcomeMessages: Partial<Record<NonNullable<TaskComposer["status"]>["state"], string>> = {
  confirmed: "Task creation receipt confirmed.",
  conflict: "Task creation conflicted. Your draft is preserved.",
  rejected: "Task creation was rejected. Your draft is preserved.",
  pending: "Task creation is pending.",
};
function statusText(model: TaskComposer) {
  if (model.busy) return "Checking task operation…";
  if (model.created) return "Task created and its record verified.";
  const message = model.status && outcomeMessages[model.status.state];
  if (message) return message;
  return model.unrecorded?.id === model.operation
    ? "AQ has no record of this operation."
    : "Task creation outcome is uncertain.";
}
export function OperationDetails({
  model,
  project,
  operation,
}: {
  model: TaskComposer;
  project: string;
  operation: string;
}) {
  const { status, readError } = model;
  return (
    <section className={styles.operation} aria-label="Task creation status">
      <p role="status">{statusText(model)}</p>
      <UnrecordedNotice model={model} operation={operation} />
      {readError && <p className={styles.warning}>{readError}</p>}
      <OperationActions model={model} project={project} operation={operation} />
      {status && !status.recovery.allowed && status.recovery.reason && (
        <p className={styles.meta}>{status.recovery.reason}</p>
      )}
      <OperationReference model={model} operation={operation} />
    </section>
  );
}
function UnrecordedNotice({ model, operation }: { model: TaskComposer; operation: string }) {
  const { busy, status, unrecorded } = model;
  if (busy || status) return null;
  if (unrecorded?.id !== operation) return null;
  return (
    <>
      {unrecorded.message && <p className={styles.meta}>AQ: “{unrecorded.message}”</p>}
      <p className={styles.meta}>
        No task was created from it as far as AQ knows: the request was refused before it was recorded, or is
        still on its way. Check status again, or start over to submit your draft as a new task.
      </p>
    </>
  );
}
function OperationReference({model,operation}:{model:TaskComposer;operation:string}) {
 const {status}=model;
 return (
    <details className={styles.details}>
      <summary>Operation reference</summary>
      <p>{operation}</p>
      {status && <p>{status.request_digest}</p>}
      {status?.receipt && <ReceiptFacts receipt={status.receipt}/>}
      <p>Keep this page address to inspect the same operation after a reload.</p>
    </details>
  );
}
function ReceiptFacts({receipt}:{receipt:NonNullable<NonNullable<TaskComposer["status"]>["receipt"]>}) {
 return (
        <dl>
          <dt>Original workspace</dt>
          <dd>{receipt.workspace_id}</dd>
          <dt>Creation change set</dt>
          <dd>{receipt.change_set_id}</dd>
          <dt>Initial record version</dt>
          <dd>{receipt.version}</dd>
          <dt>Initial content revision</dt>
          <dd>{receipt.content_revision}</dd>
        </dl>
 );
}
