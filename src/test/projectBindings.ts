export function projectRecord(n = 1) {
  const id = (v: number) => `00000000-0000-4000-8000-${String(v).padStart(12, "0")}`;
  return { revision: 2, validated_at_ms: 10000, binding: {
    schema_version: 1, project_id: id(n), name: `Project ${n}`, enabled: true,
    repository_id: id(101), repository_binding_generation: 3, graph_workspace_id: id(102),
    repository_adapter_reference: "aq.git.configured", graph_adapter_reference: "aq.graph.configured",
    allowed_worker_groups: ["engineering"], allowed_node_ids: [] as string[],
    default_role: "developer" as string | undefined, default_intelligence: "standard-high" as string | undefined, role_notes: { reviewer: "Check the migration notes." } as Record<string, string> | undefined, allowed_environments: ["confined-worktree"],
  }, validation: { repository_generation: 3, repository_id: id(101), graph_workspace_id: id(102), repository_adapter_reference: "aq.git.configured", graph_adapter_reference: "aq.graph.configured",
    repository: "verified", graph: "stale", observed_at_ms: 9000, expires_at_ms: 15000 } };
}
