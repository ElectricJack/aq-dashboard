import { useId } from "react";
import { canonicalUuid } from "../../../api/adapters/contract";
import { MAX_WORKSPACE_PROJECTS, type ResourceRequest } from "../../../api/taskWorkspaceResources";
import { useProjects } from "../../../app/useProjects";
import { ActionButton } from "../../../components/layout/Workspace";
import styles from "./WorkspaceResources.module.css";

export function WorkspaceDeclaration({ project, value, onChange }: {
  project: string;
  value: ResourceRequest[];
  onChange(next: ResourceRequest[]): void;
}) {
  const projects = useProjects();
  const description = useId();
  const eligible = projects.data?.view.filter(item => item.id !== project && canonicalUuid(item.id)) ?? [];
  const sources = value.filter(item => "target_project_id" in item);
  const service = value.some(item => "service" in item);
  const choice = eligible.find(item => !sources.some(source => source.target_project_id === item.id));
  const selectedProjects = new Map(eligible.map(item => [item.id, item.label]));
  return <div className={styles.content}>
    <p id={description} className={styles.meta}>Resource declarations are saved with the draft. The target project’s policy determines source approval.</p>
    {sources.map((source, index) => <div className={styles.form} key={index}>
      <label>Source project {index + 1}
        <select value={source.target_project_id} onChange={event => {
          const target = event.target.value;
          onChange(value.map(item => item === source ? { ...source, target_project_id: target } : item));
        }}>
          {!selectedProjects.has(source.target_project_id) && <option value={source.target_project_id}>{source.target_project_id}</option>}
          {eligible.map(item => <option key={item.id} value={item.id}
            disabled={source.target_project_id !== item.id && sources.some(entry => entry.target_project_id === item.id)}>{item.label}</option>)}
        </select>
      </label>
      <label>Source access {index + 1}
        <select value={source.access} onChange={event => {
          const access = event.target.value === "write" ? "write" : "read";
          onChange(value.map(item => item === source ? { ...source, access } : item));
        }}>
          <option value="read">Read-only</option><option value="write">Read and write</option>
        </select>
      </label>
      <ActionButton aria-label={`Remove source project ${index + 1}`} onClick={() => onChange(value.filter(item => item !== source))}>Remove</ActionButton>
    </div>)}
    {projects.isError && <p className={styles.meta}>AQ could not load eligible projects.</p>}
    <div className={styles.toolbar}>
      <ActionButton disabled={!choice || sources.length >= MAX_WORKSPACE_PROJECTS} onClick={() => {
        if (choice) onChange([...value, { target_project_id: choice.id, access: "read" }]);
      }}>Add source project</ActionButton>
      <label className={styles.serviceChoice}>
        <input type="checkbox" checked={service} aria-describedby={description}
          onChange={event => onChange(event.target.checked ? [...value, { service: "postgres" }] : value.filter(item => !("service" in item)))} />
        Request PostgreSQL service
      </label>
    </div>
  </div>;
}
