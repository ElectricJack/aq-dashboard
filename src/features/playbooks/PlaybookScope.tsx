import { Link, useLocation } from "react-router";
import { ApiError } from "../../api/client";
import { Panel } from "../../components/layout/Workspace";
import styles from "./Playbooks.module.css";

export function playbookScopeUnavailable(project: string | null, error: unknown) {
  return project !== null && error instanceof ApiError && error.status === 404;
}

export function PlaybookScopeUnavailable({ title }: { title: string }) {
  const { pathname, search } = useLocation();
  const allProjects = new URLSearchParams(search);
  allProjects.delete("scope");
  return <Panel title={title}>
    <p role="status">Playbooks are unavailable for the selected project.</p>
    <Link className={styles.sectionLink} to={{ pathname, search: allProjects.toString() }}>View playbooks across all projects</Link>
  </Panel>;
}
