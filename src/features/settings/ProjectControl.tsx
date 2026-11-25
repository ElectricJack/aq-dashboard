import {useEffect, useRef, useState} from "react";
import {useQueryClient} from "@tanstack/react-query";
import {useSession} from "../../app/session";
import {useDraft} from "../../app/useDraft";
import { isProjectIntent, projectIntent, projectRefusal, readProjectState, submitProjectIntent, type ProjectIntent } from "./projectControlRequests";
import type {ProjectBindingView} from "../../api/adapters/projectBindings";
import {ActionButton} from "../../components/layout/Workspace";
import styles from "./ProjectBindings.module.css";

const PROJECT_QUERIES = new Set(["worker-launch-projects", "projects", "overview", "human-graph-list", "all-project-work", "selected-project-control", "project-execution-bindings"]);
const SETUP = {
  missing: "Worker setup is incomplete for this project.",
  disabled: "Worker execution is disabled in the server setup.",
  unknown: "Worker setup could not be confirmed. Refresh or update the server.",
  enabled: null,
};
export function projectState(project: ProjectBindingView) {
  if (!project.enabled) return "Stopped";
  return project.workerPolicy === "enabled" ? "Started" : "Setup needed";
}
export function ProjectControl({ project: p, onChanged }: { project: ProjectBindingView; onChanged: () => Promise<unknown> }) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const [pending, setPending] = useDraft<ProjectIntent | null>(`project-control:${p.id}`, null, isProjectIntent);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const lock = useRef(false), alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const setup = SETUP[p.workerPolicy];

  async function refused(error: unknown) {
    if (!projectRefusal(error)) {
      setMessage("The outcome is uncertain. Retry the same change or check the current state before making another change.");
      return;
    }
    setPending(null);
    setMessage(error.serverMessage ?? "AQ refused the change. Refresh the project and try again.");
    if (error.status === 409) await onChanged();
  }

  function finish() {
    lock.current = false;
    if (alive.current) setBusy(false);
  }

  async function submit(saved: ProjectIntent) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await submitProjectIntent(p.id, saved);
      if (!alive.current) return;
      setPending(null);
      setMessage(saved.enabled ? "Start request confirmed." : "Stop request confirmed.");
      await onChanged();
      await client.invalidateQueries({ predicate: query => query.queryKey.includes(queryContext.principalId)
        && query.queryKey.some(key => PROJECT_QUERIES.has(String(key))) });
    } catch (error) {
      if (alive.current) await refused(error);
    } finally { finish(); }
  }

  function change(enabled: boolean) {
    if (pending || lock.current) return;
    if (enabled && setup) return;
    const saved = projectIntent(p, enabled);
    setPending(saved);
    void submit(saved);
  }

  async function check() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const state = await readProjectState(p.id);
      if (!alive.current) return;
      setMessage(`Current saved state: ${state}. Retry the same change to confirm its receipt.`);
      await onChanged();
    } catch {
      if (alive.current) setMessage("Could not check the project. Keep this operation and retry when connected.");
    } finally { finish(); }
  }
  return <div className={styles.control}>
    <div className={styles.controls}>
      {pending?<><ActionButton disabled={busy} onClick={()=>void submit(pending)}>Retry same {pending.enabled?"start":"stop"}</ActionButton><ActionButton disabled={busy} onClick={()=>void check()}>Check current state</ActionButton></>:p.enabled?<ActionButton disabled={busy} onClick={()=>change(false)}>Stop project</ActionButton>:<ActionButton className={styles.start} disabled={busy||!!setup} title={setup??undefined} onClick={()=>change(true)}>Start project</ActionButton>}
      <a className={styles.openWork} href={`/work?scope=project%3A${p.id}`}>Open work</a>
    </div>
    {setup&&<p className={styles.meta}>{setup}</p>}
    {message&&<p role="status">{message}</p>}
    {busy&&<p role="status">Saving project state…</p>}
  </div>;
}
