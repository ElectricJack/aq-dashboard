import { useRef, useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { decideWorkspaceRequest, TASK_WORKSPACE_RESOURCES, type WorkspaceDecision, type WorkspaceRequest } from "../../../api/taskWorkspaceResources";
import { ContractError } from "../../../api/adapters/contract";
import { scopeSearch } from "../../../app/scope";
import { useSession } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { ResourceNotice, SourceIdentity } from "./WorkspaceResources";
import { incomingKey, useResourceAction, useWorkspaceRequests, workspaceKey } from "./workspaceQueries";
import styles from "./WorkspaceResources.module.css";

function Requests({ target }: { target: string }) {
  const { queryContext } = useSession();
  const key = incomingKey(queryContext, target);
  const cache = useQueryClient();
  const query = useWorkspaceRequests(target);
  const action = useResourceAction();
  const feedback = useRef<HTMLDivElement>(null);

  function decide(request: WorkspaceRequest, decision: WorkspaceDecision["decision"]) {
    void action.run(key, async () => {
      const updated = await decideWorkspaceRequest(request, decision);
      if (!updated.sources.some(row => row.target_project_id === target && row.state === decision &&
        row.project_revision === request.project_revision && row.repository_id === request.repository_id &&
        row.binding_generation === request.binding_generation && row.commit_oid === request.commit_oid && row.access === request.access)) {
        throw new ContractError("Workspace response did not confirm the decision");
      }
      void cache.invalidateQueries({ queryKey: workspaceKey(queryContext, request.home_project_id, request.task_id), exact: true });
      feedback.current?.focus();
    }, decision === "approved" ? "Source access approved." : "Source access denied.");
  }

  return <div className={styles.content}>
    <div tabIndex={-1} ref={feedback} className={styles.feedback}><ResourceNotice notice={action.notice} /></div>
    {!query.data || query.isError ? <QueryStatus status={query.isError ? "error" : "pending"}
      label="incoming workspace requests" error={query.error} onRetry={() => void query.refetch()} /> : <>
      <div className={styles.toolbar}>
        <p className={styles.meta}>Review the repository, commit and access requested for this project.</p>
        <ActionButton disabled={query.isFetching || action.pending} onClick={() => void query.refetch()}>Refresh requests</ActionButton>
      </div>
      {query.data.hasMore && <p className={styles.meta}>Showing the first {query.data.sources.length} pending requests.</p>}
      {query.data.sources.length === 0 ? <p>No incoming workspace requests.</p> : <ul className={styles.rows} aria-label="Incoming workspace requests">
        {query.data.sources.map(request => <li key={`${request.home_project_id}/${request.task_id}`}>
          <p><Link to={{ pathname: `/work/${request.task_id}`, search: scopeSearch({ kind: "project", project_id: request.home_project_id }) }}>
            Open task <code>{request.task_id}</code>
          </Link></p>
          <SourceIdentity source={request} />
          <div className={styles.toolbar}>
            <ActionButton disabled={action.pending || query.isFetching} onClick={() => void decide(request, "approved")}>Approve access</ActionButton>
            <ActionButton disabled={action.pending || query.isFetching} onClick={() => void decide(request, "denied")}>Deny access</ActionButton>
          </div>
        </li>)}
      </ul>}
    </>}
  </div>;
}

export function IncomingWorkspaceRequests({ target }: { target: string }) {
  const { bootstrap } = useSession();
  const [open, setOpen] = useState(false);
  if (!bootstrap.capability(TASK_WORKSPACE_RESOURCES).enabled) return null;
  return <details className={styles.incoming} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Incoming workspace requests</summary>
    {open && <Requests target={target} />}
  </details>;
}
