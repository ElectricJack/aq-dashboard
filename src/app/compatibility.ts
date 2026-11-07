import type { BootstrapView } from "../api/adapters/bootstrap";

export const UPGRADE_PATH = "Install compatible versions, then reload.";

/** Existing query resources grouped by their independently negotiated feature. */
export function capabilitiesForResource(resource: string): string[] {
  const exact: Record<string, string[]> = {
    projects: ["projects.read"], overview: ["dashboard.overview"],
    tasks: ["tasks.read"], task: ["tasks.read"], "task-graph": ["tasks.read"],
    sessions: ["sessions.read"], session: ["sessions.read"], "overview-session-snapshots": ["sessions.read"],
    "overview-task-contributions": ["human.overview.tasks.read"], "overview-worker-heartbeats": ["workers.read"],
    "provider-usage": ["provider.quota"], "configured-provider-accounts": ["providers.configured.read"],
    "worker-nodes": ["workers.read"], "daemon-status": ["status.read"], search: ["search.read"],
    "result-feedback-context": ["results.feedback"],
    "task-create-context": ["tasks.create"], "supervisor-operation": ["supervisor.message.enqueue"],
    "session-source-events": ["session.events.read"], "session-usage": ["session.usage.read"],
    "project-execution-bindings": ["projects.read"],
    swarm: ["swarm.read"], "task-attempt-session": ["sessions.read"], "task-results": ["results.read"], "task-comments": ["tasks.comments.read"],
  };
  if (exact[resource]) return exact[resource];
  if (resource.startsWith("human-graph-")) return ["human.graph.read"];
  if (resource.startsWith("supervisor-")) return ["supervisor.history.read"];
  if (resource.startsWith("notification-")) return ["notifications.read"];
  if (resource.startsWith("decision-")) return ["decisions.read"];
  if (resource.startsWith("result-media-upload")) return ["results.media.upload"];
  if (resource.startsWith("result-media-")) return ["results.media.read"];
  if (resource.startsWith("result-")) return ["results.read"];
  if (resource.startsWith("playbook-current-")) return ["playbooks.catalog.read"];
  if (resource === "playbook-loaded-definitions") return ["playbooks.loaded-definitions.read"];
  if (resource.startsWith("playbook-")) return ["playbooks.inspect"];
  if (resource.startsWith("terminal-")) return ["terminal.watch"];
  return [];
}

export function blockIncompatibleFeatures(bootstrap: BootstrapView, blocked: ReadonlySet<string>): BootstrapView {
  if (!blocked.size) return bootstrap;
  return { ...bootstrap, compatibilityIssues: [...bootstrap.compatibilityIssues, ...blocked], capability(name) {
    return blocked.has(name) ? { enabled: false, reason: `This feature requires a compatible AQ API. ${UPGRADE_PATH}` } : bootstrap.capability(name);
  } };
}
