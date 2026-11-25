import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { canonicalUuid, ContractError } from "../../../api/adapters/contract";
import { requestWorkspaceResource, type ResourceRequest, type WorkspaceAccess, type WorkspaceSource } from "../../../api/taskWorkspaceResources";
import { useProjects } from "../../../app/useProjects";
import { useSession } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import { QueryStatus } from "../../../components/QueryStatus/QueryStatus";
import { incomingKey, useResourceAction, useWorkspaceResources, workspaceKey } from "./workspaceQueries";
import styles from "./WorkspaceResources.module.css";

const statusLabels = { pending: "Awaiting approval", approved: "Approved", denied: "Denied" };
export const accessLabels: Record<WorkspaceAccess, string> = { read: "Read-only", write: "Read and write" };

export function SourceIdentity({ source }: { source: WorkspaceSource }) {
  return <dl className={styles.facts}>
    <dt>Repository</dt><dd>{source.repository_id}</dd>
    <dt>Access</dt><dd>{accessLabels[source.access]}</dd>
    <dt>Project revision</dt><dd>{source.project_revision}</dd>
    <dt>Binding generation</dt><dd>{source.binding_generation}</dd>
    <dt>Commit</dt><dd><code>{source.commit_oid}</code></dd>
  </dl>;
}

export function ResourceNotice({ notice }: Pick<ReturnType<typeof useResourceAction>, "notice">) {
  if (!notice) return null;
  return <p role={notice.kind === "confirmed" ? "status" : "alert"}>{notice.text}</p>;
}

function ResourceRequestForm({ choices, unavailable, excluded, pending, onRequest }: {
  choices: { id: string; label: string }[];
  unavailable: boolean;
  excluded: Set<string>;
  pending: boolean;
  onRequest(request: ResourceRequest): Promise<boolean>;
}) {
  const [target, setTarget] = useState("");
  const [access, setAccess] = useState<WorkspaceAccess>("read");
  const selectable = choices.some(item => item.id === target);
  const selected = selectable ? target : "";
  return <form className={styles.form} onSubmit={event => {
    event.preventDefault();
    if (selectable && !excluded.has(target)) void onRequest({ target_project_id: selected, access }).then(confirmed => {
      if (confirmed) { setTarget(""); setAccess("read"); }
    });
  }}>
    <label>Source project
      <select value={selected} required disabled={pending || choices.length === 0} onChange={event => setTarget(event.target.value)}>
        <option value="">Choose a project</option>
        {choices.map(item => <option key={item.id} value={item.id} disabled={excluded.has(item.id)}>{item.label}</option>)}
      </select>
    </label>
    <label>Source access
      <select value={access} disabled={pending || !selectable} onChange={event => setAccess(event.target.value === "write" ? "write" : "read")}>
        <option value="read">Read-only</option><option value="write">Read and write</option>
      </select>
    </label>
    <ActionButton type="submit" disabled={pending || !selectable || excluded.has(target)}>Request source</ActionButton>
    {unavailable && <p className={styles.meta}>AQ could not load projects.</p>}
  </form>;
}

export function WorkspaceResources({ project, task }: { project: string; task: string }) {
  const { queryContext } = useSession();
  const cache = useQueryClient();
  const query = useWorkspaceResources(project, task);
  const action = useResourceAction();
  const projects = useProjects();
  const choices = projects.data?.view.filter(item => item.id !== project && canonicalUuid(item.id)) ?? [];
  const labels = new Map(choices.map(item => [item.id, item.label]));
  const key = workspaceKey(queryContext, project, task);
  function request(value: ResourceRequest) {
    return action.run(key, async () => {
      const resources = await requestWorkspaceResource(project, task, value);
      const recorded = "service" in value
        ? resources.services.some(item => item.service === value.service)
        : resources.sources.some(item => item.target_project_id === value.target_project_id && item.access === value.access);
      if (!recorded) throw new ContractError("Workspace response did not confirm the request");
      if ("target_project_id" in value) {
        void cache.invalidateQueries({ queryKey: incomingKey(queryContext, value.target_project_id), exact: true });
      }
    }, "Workspace updated.");
  }
  if (!query.data || query.isError) {
    return <QueryStatus status={query.isError ? "error" : "pending"} label="task workspace resources"
      error={query.error} onRetry={() => void query.refetch()} />;
  }
  const { sources, services } = query.data;
  const postgres = services.some(item => item.service === "postgres");
  const excluded = new Set(sources.filter(item => item.state !== "denied").map(item => item.target_project_id));
  return <div className={styles.content}>
    <div className={styles.toolbar}>
      <p className={styles.meta}>Source access follows the target project’s workspace policy.</p>
      <ActionButton disabled={action.pending || query.isFetching} onClick={() => void query.refetch()}>Refresh resources</ActionButton>
    </div>
    {sources.length > 0 ? <ul className={styles.rows} aria-label="Task workspace sources">
      {sources.map(source => <li key={source.target_project_id}>
        <p><strong>{labels.get(source.target_project_id) ?? source.target_project_id}</strong> · {statusLabels[source.state]}</p>
        <SourceIdentity source={source} />
        {source.access === "read" && source.state !== "denied" && <div className={styles.toolbar}>
          <ActionButton disabled={action.pending || query.isFetching} onClick={() => void request({ target_project_id: source.target_project_id, access: "write" })}>
            Request write access
          </ActionButton>
        </div>}
      </li>)}
    </ul> : <p className={styles.meta}>No additional sources requested.</p>}
    <ResourceRequestForm choices={choices} unavailable={projects.isError} excluded={excluded} pending={action.pending} onRequest={request} />
    {postgres ? <p>PostgreSQL service requested.</p> :
      <div><ActionButton disabled={action.pending} onClick={() => void request({ service: "postgres" })}>Request PostgreSQL service</ActionButton></div>}
    <ResourceNotice notice={action.notice} />
  </div>;
}
