import { useEffect, useId, useRef } from "react";
import { Link } from "react-router";
import { validGraphId } from "../../api/adapters/humanGraph";
import type { ResultDetail } from "../../api/adapters/resultsFeedback";
import { scopeSearch } from "../../app/scope";
import { useProjects } from "../../app/useProjects";
import { ActionButton } from "../../components/layout/Workspace";
import { FeedbackTaskPicker } from "./FeedbackTaskPicker";
import { useFeedbackDraft, type FeedbackSource } from "./useFeedbackDraft";
import { feedbackParams, type FeedbackFields } from "./feedbackDraftModel";
import { OperationStatus } from "./useResultOperation";
import styles from "./Results.module.css";

type Model = ReturnType<typeof useFeedbackDraft>;
type FormFields = Pick<Model, "fields" | "update">;
type Props = FeedbackSource & { open?: boolean; onClose(): void };

function CreateFields({ fields, update, resultProject, projects }: FormFields & { resultProject: string; projects: ReturnType<typeof useProjects> }) {
  const choices = new Map([{ id: resultProject, label: resultProject }, ...(projects.data?.view ?? [])].map(project => [project.id, project]));
  return <>
    <label>Title<input required maxLength={200} value={fields.title} onChange={e => update({ title: e.target.value })}/></label>
    <label>Description<textarea required rows={3} value={fields.description} onChange={e => update({ description: e.target.value })}/></label>
    <label>Acceptance criteria<textarea required rows={3} value={fields.criteria} onChange={e => update({ criteria: e.target.value })}/></label>
    <label>Project<select value={fields.project} onChange={e => update({ project: e.target.value })}>
      {[...choices.values()].map(project => <option key={project.id} value={project.id}>{project.label}</option>)}
    </select></label>
    <label>Parent task (optional)<input value={fields.parent} onChange={e => update({ parent: e.target.value })} placeholder="Task ID"/></label>
  </>;
}

function ExactPins({ detail, model }: { detail: ResultDetail; model: Model }) {
  const { fields, update, comment } = model;
  function toggle(id: string, checked: boolean) {
    update({ artifacts: checked ? [...fields.artifacts, id] : fields.artifacts.filter(pin => pin !== id) });
  }
  return <details><summary>Exact pins</summary>
    <p className={styles.meta}>Result {detail.result.id} · revision {detail.revision.revision}</p>
    {comment && <p className={styles.meta}>Comment {comment.id} · revision {comment.revision}</p>}
    {detail.assessment.artifacts.map(pin => <label key={pin.artifact_id}>
      <input type="checkbox" checked={fields.artifacts.includes(pin.artifact_id)} onChange={e => toggle(pin.artifact_id, e.target.checked)}/>
      {pin.artifact_id} · {pin.digest}
    </label>)}
  </details>;
}

function DraftForm({ source, model, formId }: { source: FeedbackSource; model: Model; formId: string }) {
  const { comments, detail } = source;
  const projects = useProjects();
  const { fields, update, operation, context } = model;
  function selectComment(commentId: string) {
    update({ commentId, description: comments.find(comment => comment.id === commentId)?.body ?? "" });
  }
  return <form id={formId} onSubmit={e => void model.submit(e)}>
    <fieldset disabled={!model.enabled || !!operation.id} className={styles.fields}>
      <label>Feedback comment<select value={fields.commentId} onChange={e => selectComment(e.target.value)}>
        {comments.map(comment => <option key={comment.id} value={comment.id}>{comment.body.slice(0, 90)}</option>)}
      </select></label>
      <label>Action<select value={fields.mode} onChange={e => update({ mode: e.target.value as FeedbackFields["mode"] })}>
        <option value="create">Create a new task</option><option value="link">Link existing task</option>
      </select></label>
      {model.creating
        ? <CreateFields fields={fields} update={update} projects={projects} resultProject={detail.result.project_id}/>
        : <FeedbackTaskPicker project={detail.result.project_id} value={fields.existing} onChange={existing => update({ existing })}/>}
      <ExactPins detail={detail} model={model}/>
    </fieldset>
    {model.creating && context.isError && <p>Project revision unavailable. <ActionButton onClick={() => void context.refetch()}>Refresh project</ActionButton></p>}
  </form>;
}

function FeedbackOutcome({ detail, model }: { detail: ResultDetail; model: Model }) {
  const { operation, linked, creating, fields } = model;
  const scope = scopeSearch({ kind: "project", project_id: detail.result.project_id });
  const search = operation.id ? feedbackParams(new URLSearchParams(scope), { id: operation.id, detail }) : undefined;
  return <>
    <OperationStatus operation={operation} recover={creating} onCheck={value => { void model.checked(value); }} onRevise={model.refreshGuards}/>
    {search && creating && <p className={styles.meta}><Link to={{
      pathname: `/results/${detail.result.id}/revisions/${detail.revision.revision}`, search: search.toString(),
    }}>Retained operation</Link></p>}
    {linked && <ActionButton onClick={model.restart}>Start another feedback task</ActionButton>}
    {linked && <section role="status"><p>{creating ? "Feedback task created and linked. Thread remains open." : "Existing task linked. Thread remains open."}</p>
      <Link to={{ pathname: `/work/${linked}`, search: scopeSearch({ kind: "project", project_id: fields.project }) }}>Open feedback task</Link>
    </section>}
  </>;
}

function canSubmit({ enabled, comment, creating, context, fields }: Model) {
  if (!enabled || !comment) return false;
  if (!creating) return validGraphId(fields.existing);
  return !!context.data && !context.isFetching && !context.isError;
}

export function FeedbackDraft({ open = true, onClose, ...source }: Props) {
  const model = useFeedbackDraft(source);
  const formId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (open) element?.showModal();
    else element?.close();
    return () => element?.close();
  }, [open]);
  return <dialog ref={dialog} className={styles.draftDialog} aria-label="Create feedback task" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header className={styles.panelHeader}><h2>Create feedback task</h2><ActionButton onClick={onClose}>Close draft</ActionButton></header>
    <div className={styles.draftBody}>
      <p className={styles.meta}>Discussion stays separate from work. Creating or linking a task leaves the thread open.</p>
      {!source.comments.length && <p>Post a comment first to pin this feedback to an exact discussion.</p>}
      {model.error && <p role="alert">{model.error}</p>}
      <DraftForm source={source} model={model} formId={formId}/>
      <FeedbackOutcome detail={source.detail} model={model}/>
    </div>
    <footer className={styles.draftFooter}>
      <ActionButton onClick={onClose}>Cancel</ActionButton>
      {!model.operation.id && <ActionButton type="submit" form={formId} className={styles.primary} disabled={!canSubmit(model)}>
        {model.creating ? "Create linked task" : "Link existing task"}
      </ActionButton>}
    </footer>
  </dialog>;
}
