import type { BootstrapView } from "../api/adapters/bootstrap";

import { PERFORMANCE } from "../api/adapters/performance";

export const UPGRADE_PATH = "Install compatible versions, then reload.";

// More specific prefixes precede their broader resource families.
const PREFIX_CAPABILITIES = [
  ["performance-", PERFORMANCE],
  ["human-graph-", "human.graph.read"],
  ["supervisor-", "supervisor.history.read"],
  ["notification-", "notifications.read"],
  ["decision-", "decisions.read"],
  ["host-decision-", "playbooks.decisions"],
  ["result-media-upload", "results.media.upload"],
  ["result-media-", "results.media.read"],
  ["result-", "results.read"],
  ["playbook-current-", "playbooks.catalog.read"],
  ["playbook-", "playbooks.inspect"],
  ["terminal-", "terminal.watch"],
] as const;

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
    "playbook-loaded-definitions": ["playbooks.loaded-definitions.read"],
    "playbook-definition-graph": ["playbooks.definition-graph.read"],
  };
  if (exact[resource]) return exact[resource];
  for (const [prefix, capability] of PREFIX_CAPABILITIES) {
    if (resource.startsWith(prefix)) return [capability];
  }
  return [];
}

export function blockIncompatibleFeatures(bootstrap: BootstrapView, blocked: ReadonlySet<string>): BootstrapView {
  if (!blocked.size) return bootstrap;
  return { ...bootstrap, compatibilityIssues: [...bootstrap.compatibilityIssues, ...blocked], capability(name) {
    return blocked.has(name) ? { enabled: false, reason: `This feature requires a compatible AQ API. ${UPGRADE_PATH}` } : bootstrap.capability(name);
  } };
}
