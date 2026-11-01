export function projectRecord(n = 1) {
  const id = (v: number) => `00000000-0000-4000-8000-${String(v).padStart(12, "0")}`;
  return { revision: 2, validated_at_ms: 10000, binding: {
    schema_version: 1, project_id: id(n), name: `Project ${n}`, enabled: true,
    repository_id: id(101), repository_binding_generation: 3, graph_workspace_id: id(102),
    repository_adapter_reference: "aq.git.configured", graph_adapter_reference: "aq.graph.configured", catalog_digest: "a".repeat(64),
    allowed_worker_groups: ["engineering"], allowed_node_ids: [] as string[],
    allowed_agent_profiles: ["reviewer@2"], allowed_intelligence_profiles: ["engineering@2"], allowed_execution_profiles: ["confined@2"], allowed_environments: ["confined-worktree"],
  }, validation: { repository_generation: 3, repository_id: id(101), graph_workspace_id: id(102), repository_adapter_reference: "aq.git.configured", graph_adapter_reference: "aq.graph.configured",
    repository: "verified", graph: "stale", observed_at_ms: 9000, expires_at_ms: 15000 } };
}
