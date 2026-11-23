import { useId, useEffect, useRef, useState } from "react";
import { DraftContent } from "./TaskDraftForm";
import { OperationDetails } from "./TaskCreationStatus";
import { Plus } from "lucide-react";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { validGraphId } from "../../api/adapters/humanGraph";
import { ActionButton } from "../../components/layout/Workspace";
import { UnavailableAction } from "../knowledge/KnowledgeActions";
import { useTaskComposer } from "./useTaskComposer";
import styles from "./CreateTask.module.css";
export function CreateTaskAction() {
  const { bootstrap, queryContext } = useSession();
  const [scope] = useScope();
  const capability = bootstrap.capability("tasks.create");
  const identity = `${queryContext.principalId}:${queryContext.authorizationRevision}`;
  const [revoked, setRevoked] = useState<string | null>(null);
  const project = scope.kind === "project" && validGraphId(scope.project_id) ? scope.project_id : undefined;
  if (revoked === identity)
    return (
      <div className={styles.action}>
        <p role="alert" className={styles.warning}>
          Access changed. Reload after signing in to check the operation.
        </p>
        <ActionButton onClick={() => window.location.reload()}>Reload access</ActionButton>
      </div>
    );
  // The compact header has no room for the reason, so it is the button's description and a tooltip on hover, focus or tap (SO-22).
  if (!capability.enabled || !project)
    return (
      <UnavailableAction
        label="Create task"
        reason={(!capability.enabled ? capability.reason : undefined) ?? "Choose a project first"}
        icon={<Plus size={18} aria-hidden />}
      />
    );
  return (
    <Composer key={`${identity}:${project}`} project={project} onAccessRevoked={() => setRevoked(identity)} />
  );
}

function useComposerDialog(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element || element.open === open) return;
    if (open) element.showModal();
    else element.close();
  }, [open]);
  return dialog;
}
function Composer({ project, onAccessRevoked }: { project: string; onAccessRevoked: () => void }) {
  const model = useTaskComposer(project, onAccessRevoked);
  const { open, setOpen, context, operation, error } = model;
  const title = operation ? "Task operation" : "Create task";
  const dialog = useComposerDialog(open),
    titleId = useId();
  return (
    <>
      <div className={styles.action}>
        <ActionButton className={styles.primary} onClick={model.launch}>
          <Plus size={18} aria-hidden />
          {title}
        </ActionButton>
      </div>
      <dialog
        ref={dialog}
        className={styles.dialog}
        aria-labelledby={titleId}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
      >
        <header className={styles.header}>
          <h2 id={titleId}>{title}</h2>
          <ActionButton onClick={() => setOpen(false)} aria-label="Close task composer">
            Close
          </ActionButton>
        </header>
        <p className={styles.meta}>
          {context.data?.name ?? "Selected project"} · Creating a task does not start an agent.
        </p>
        {error && (
          <p role="alert" className={styles.warning}>
            {error}
          </p>
        )}
        <DraftContent model={model} project={project} />
        {operation && <OperationDetails model={model} project={project} operation={operation} />}
      </dialog>
    </>
  );
}
