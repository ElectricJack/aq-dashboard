import { useState } from "react";
import { useManualAgents, launchProfileKey as key, selectionOf } from "../swarm/manualAgents";
import { workerProjects, launchOptions } from "../swarm/launchOptions";
import type { Row } from "./terminalRows";
import styles from "./TerminalWorkspace.module.css";

function useLaunchOptions(manual: ReturnType<typeof useManualAgents>) {
  const [worker, setWorker] = useState(""), [project, setProject] = useState(""), [provider, setProvider] = useState(""), [profile, setProfile] = useState("");
  const fleet = manual?.fleet;
  const selectedWorker = fleet?.workers.find(x => x.node_id === worker) ?? fleet?.workers[0];
  const projects = workerProjects(fleet, selectedWorker).filter(project => !manual?.project || project.id === manual.project);
  const selectedProject = projects.find(x => x.id === project) ?? projects[0];
  const { providers, provider: selectedProvider, profiles, choice } = launchOptions(fleet, selectedWorker, { provider, profile });
  return { fleet, selectedWorker, projects, selectedProject, providers, selectedProvider, profiles, choice, setWorker, setProject, setProvider, setProfile };
}

type LaunchProps = { onLaunch: (row: Row) => void; onError: (message: string) => void; workerNames: Record<string, string> };
type Options = ReturnType<typeof useLaunchOptions>;
function startAgent(manual: ReturnType<typeof useManualAgents>, options: Options, { workerNames, onLaunch, onError }: LaunchProps) {
  const { selectedWorker, selectedProject, choice } = options;
  if (!manual || !selectedWorker) return;
  if (!selectedProject || !choice) return;
  const id = crypto.randomUUID();
  const node = selectedWorker.node_id;
  const request = manual.launch({ node, project: selectedProject.id, id, intelligence: selectionOf(choice) });
  onLaunch({
    key: `manual:${id}`, id, project: selectedProject.name, projectId: selectedProject.id, worker: workerNames[node] ?? "Worker unavailable",
    model: `${choice.provider} · ${choice.model}`, status: "pending", terminal: id, manual: true,
  });
  void request.catch(() => onError("Launch could not be confirmed. Check the agent status."));
}
export function Launch(props: LaunchProps) {
  const manual = useManualAgents();
  const options = useLaunchOptions(manual);
  const { fleet, selectedWorker, projects, selectedProject, providers, selectedProvider, profiles, choice, setWorker, setProject, setProvider, setProfile } = options;
  const disabled = !selectedWorker || !selectedProject || !choice;
  return <div className={styles.launch}>
    <label>Worker<select value={selectedWorker?.node_id ?? ""} onChange={e => setWorker(e.target.value)}>{fleet?.workers.map(x => <option key={x.node_id} value={x.node_id}>{props.workerNames[x.node_id] ?? "Worker unavailable"}</option>)}</select></label>
    <label>Project<select value={selectedProject?.id ?? ""} onChange={e => setProject(e.target.value)}>{projects.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
    <label>Provider<select value={selectedProvider ?? ""} onChange={e => setProvider(e.target.value)}>{providers.map(x => <option key={x} value={x}>{x === "openai" ? "Codex" : "Claude"}</option>)}</select></label>
    <label>Level<select value={choice ? key(choice) : ""} onChange={e => setProfile(e.target.value)}>{profiles.map(x => <option key={key(x)} value={key(x)}>{x.name} · {x.model} · {x.reasoning}</option>)}</select></label>
    <button disabled={disabled} onClick={() => startAgent(manual, options, props)}>Start agent</button>
  </div>;
}
