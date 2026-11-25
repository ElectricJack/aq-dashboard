import { useState } from "react";
import type { TaskDraft } from "../../api/adapters/taskCreate";
import { RoleSelect } from "./taskRole";
import { StoryPointsField } from "./StoryPointsField";
import {ActionButton} from "../../components/layout/Workspace";
import type {TaskComposer} from "./useTaskComposer";
import { WorkspaceDeclaration } from "./resources/WorkspaceDeclaration";
import styles from "./CreateTask.module.css";
function hasDraft(draft: TaskDraft) {
  return !!(draft.title || draft.body || draft.acceptance_criteria);
}
export function DraftContent({ model, project }: { model: TaskComposer; project: string }) {
  if (!model.operation || model.frozen) return <TaskForm model={model} project={project} />;
  return <RecoveredDraft model={model} />;
}
function TaskForm({ model, project }: { model: TaskComposer; project: string }) {
  const { submit, busy, operation, draft, setDraft, canSetStoryPoints, canDeclareWorkspace } = model;
  const [open, setOpen] = useState(false);
  const declared = canDeclareWorkspace && Boolean(draft.workspace?.length);
  return (
    <form onSubmit={(e) => void submit(e)}>
      <fieldset disabled={busy || !!operation} className={styles.fields}>
        <label>
          Title
          <input
            value={draft.title}
            required
            maxLength={512}
            onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))}
          />
        </label>
        <label>
          Description
          <textarea
            value={draft.body}
            rows={6}
            onChange={(e) => setDraft((v) => ({ ...v, body: e.target.value }))}
          />
        </label>
        <label>
          Acceptance criteria
          <textarea
            value={draft.acceptance_criteria}
            rows={4}
            onChange={(e) => setDraft((v) => ({ ...v, acceptance_criteria: e.target.value }))}
          />
        </label>
        {canSetStoryPoints && (
          <StoryPointsField
            value={draft.storyPoints ?? ""}
            onChange={(storyPoints) => setDraft((v) => ({ ...v, storyPoints }))}
          />
        )}
        <label>
          Initial task state
          <select
            value={declared ? "draft" : draft.task_state}
            disabled={declared}
            onChange={(e) =>
              setDraft((v) => ({ ...v, task_state: e.target.value as TaskDraft["task_state"] }))
            }
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
          </select>
        </label>
        {canDeclareWorkspace && <details className={styles.details} onToggle={event => setOpen(event.currentTarget.open)}>
          <summary>Declare workspace resources{declared && ` (${draft.workspace?.length})`}</summary>
          {open && <WorkspaceDeclaration project={project} value={draft.workspace ?? []}
            onChange={workspace => setDraft(value => ({ ...value, workspace }))} />}
        </details>}
        <RoleSelect
          project={project}
          value={draft.role ?? ""}
          onChange={(role) => setDraft((v) => ({ ...v, role }))}
          hintClassName={styles.meta}
        />
      </fieldset>
      {!operation && <FormFooter model={model} />}
    </form>
  );
}
function RecoveredDraft({ model }: { model: TaskComposer }) {
  const { draft, canSetStoryPoints } = model;
  if (!hasDraft(draft)) return null;
  return (
    <section aria-label="Recovered local task draft">
      <p>Recovered local draft. Check the retained operation before submitting again.</p>
      <div className={styles.fields}>
        <label>
          Title
          <input readOnly value={draft.title} />
        </label>
        <label>
          Description
          <textarea readOnly rows={6} value={draft.body} />
        </label>
        <label>
          Acceptance criteria
          <textarea readOnly rows={4} value={draft.acceptance_criteria} />
        </label>
        {canSetStoryPoints && <StoryPointsField value={draft.storyPoints ?? ""} />}
        <p>Initial task state: {draft.task_state}</p>
        <p>Role: {draft.role || "project default"}</p>
      </div>
    </section>
  );
}
function FormFooter({ model }: { model: TaskComposer }) {
  const { busy, context } = model;
  const waiting = !context.data || context.isFetching;
  const description = context.isError
    ? "Project context unavailable. Refresh it before submitting."
    : waiting
      ? "Checking project context…"
      : "Creation uses the current project revision.";
  return (
    <footer className={styles.footer}>
      <p className={styles.meta}>{description}</p>
      {context.isError && (
        <ActionButton onClick={() => void context.refetch()}>Refresh project context</ActionButton>
      )}
      <ActionButton type="submit" className={styles.primary} disabled={busy || context.isError || waiting}>
        Create task
      </ActionButton>
    </footer>
  );
}
