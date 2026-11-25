import {Link} from "react-router";
import {scopeSearch} from "../../app/scope";
import {ActionButton} from "../../components/layout/Workspace";
import type {TaskComposer} from "./useTaskComposer";
import styles from "./CreateTask.module.css";
function plainActivation(e: React.MouseEvent) {
  if (e.button !== 0) return false;
  return !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey);
}
function CreatedLink({ model, project }: { model: TaskComposer; project: string }) {
  const { created, leaveConfirmedTask } = model;
  if (!created) return null;
  return (
    <Link
      className={styles.openTask}
      onClick={(e) => {
        if (plainActivation(e)) leaveConfirmedTask();
      }}
      to={{ pathname: `/work/${created.id}`, search: scopeSearch({ kind: "project", project_id: project }) }}
    >
      Open created task
    </Link>
  );
}
export function OperationActions({model,project,operation}:{model:TaskComposer;project:string;operation:string}) {
 const {busy,lookup}=model;
 return <div className={styles.footer}>
   <CreatedLink model={model} project={project}/>
   <ActionButton disabled={busy} onClick={()=>void lookup()}>Check status</ActionButton>
   <RecoveryActions model={model} operation={operation}/>
 </div>;
}
function RecoveryActions({model,operation}:{model:TaskComposer;operation:string}) {
 const {busy,status,recover,terminal,revise}=model;
 if (!status) return <UnconfirmedActions model={model} operation={operation}/>;
 return <>
  {status.recovery.allowed && <ActionButton disabled={busy} onClick={()=>void recover()}>Recover retained request</ActionButton>}
  {terminal && <ActionButton disabled={busy} onClick={revise}>{status.state==="confirmed"?"Start another task":"Revise draft"}</ActionButton>}
 </>;
}
function UnconfirmedActions({model,operation}:{model:TaskComposer;operation:string}) {
 const {busy,frozen,unrecorded,retryOriginal,startOver}=model;
 return <>
  {frozen && <ActionButton disabled={busy} onClick={()=>void retryOriginal()}>Retry exact submission</ActionButton>}
  {unrecorded?.id===operation && <ActionButton disabled={busy} onClick={startOver}>Start over</ActionButton>}
 </>;
}
