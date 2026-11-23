import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { apiGet, apiSend, ApiError, isProtectedReadFailure } from "../../../api/client";
import { boundedList, ContractError } from "../../../api/adapters/contract";
import { useDraft } from "../../../app/useDraft";
import { useSession, PANEL_READ } from "../../../app/session";
import { adaptManualFleet, manualAgent, selectionOf, type IntelligenceSelection, type LaunchProfile, type ManualAgent, type ManualFleet } from "./manualFleet";
export { adaptManualFleet, launchProfileKey, manualAgent, selectionOf, validLaunchProfile, type IntelligenceSelection, type LaunchProfile, type ManualAgent, type ManualFleet } from "./manualFleet";
export { capacity, mergeManual } from "./mergeManual";

type Target = { node: string; project: string };
type Launch = Target & { id?: string; intelligence?: IntelligenceSelection };
type Value = {
  fleet: ManualFleet | undefined;
  project: string | null;
  error: unknown;
  launch(request: Launch): Promise<string>;
  stop(id: string): Promise<void>;
  setSlots(node: string, project: string, slots: number): Promise<void>;
};
const Context = createContext<Value | null>(null);
export const useManualAgents = () => useContext(Context);

function useFleetRead(project: string | null) {
  const { queryContext, bootstrap } = useSession();
  const path = project ? `/api/manual-agents?project_id=${project}` : "/api/manual-agents";
  return useQuery({
    queryKey: ["manual-agents", queryContext.principalId, queryContext.authorizationRevision, project],
    queryFn: async ({ signal }) => adaptManualFleet(await apiGet(path, signal)),
    enabled: bootstrap.capability("tasks.create").enabled, refetchInterval: 1000, refetchOnWindowFocus: true, retry: false, meta: PANEL_READ,
  });
}

function useLaunchDrafts(data: ManualFleet | undefined) {
  const [drafts, setDrafts] = useDraft<ManualAgent[]>("manual-agent-launches", [], (v): v is ManualAgent[] => boundedList(v, 32, manualAgent));
  const recorded = new Set(data?.sessions.map(agent => agent.id));
  const outstanding = drafts.filter(draft => !recorded.has(draft.id));
  useEffect(() => {
    if (outstanding.length !== drafts.length) setDrafts(current => current.filter(draft => !recorded.has(draft.id)));
  }, [data, drafts, setDrafts]);
  function add(draft: ManualAgent) {
    setDrafts(current => current.some(agent => agent.id === draft.id) ? current : [...current, draft]);
  }
  function update(id: string, change: (agent: ManualAgent) => ManualAgent) {
    setDrafts(current => current.map(agent => agent.id === id ? change(agent) : agent));
  }
  return { outstanding, add, update };
}

function targetPath({ node, project }: Target) {
  return `/api/manual-agents/workers/${node}/projects/${project}`;
}
function pinnedSelection(intelligence?: IntelligenceSelection) {
  return intelligence ? { intelligence_profile: selectionOf(intelligence) } : {};
}

function matchingProfile(data: ManualFleet | undefined, selected: IntelligenceSelection | undefined) {
  if (!selected) return;
  return data?.launch_profiles.find(profile => profile.profile_id === selected.profile_id && profile.candidate_id === selected.candidate_id);
}

function launchSpec(choice: LaunchProfile | undefined, selected: IntelligenceSelection | undefined) {
  if (!choice) return { provider: "", model: "", ...pinnedSelection(selected) };
  return { provider: choice.provider, model: choice.model, reasoning: choice.reasoning, harness: choice.harness, profile_name: choice.name, ...pinnedSelection(selected) };
}

function pendingDraft(request: Launch, id: string, data: ManualFleet | undefined): ManualAgent {
  const item = data?.projects.find(project => project.id === request.project);
  if (!item) throw Error("Select a started project");
  const selected = request.intelligence;
  const choice = matchingProfile(data, selected);
  return {
    id, node_id: request.node, project_id: item.id,
    spec: { project_name: item.name, repository_id: item.repository_id, ...launchSpec(choice, selected) },
    status: "pending", stage: "Requesting agent startup", desired_running: true, created_at_ms: Date.now(), updated_at_ms: Date.now(), worker_seen_at_ms: null,
  };
}

function matchesTarget(row: { node_id: string; project_id: string }, target: Target) {
  return row.node_id === target.node && row.project_id === target.project;
}

async function launchReceipt(request: Launch, id: string) {
  const body = { operation_id: id, ...pinnedSelection(request.intelligence) };
  const result = await apiSend<unknown>("POST", targetPath(request), body);
  if (!manualAgent(result)) throw new ContractError("Invalid launch receipt");
  if (result.id !== id || !matchesTarget(result, request)) throw new ContractError("Invalid launch receipt");
  return result;
}

function launchFailure(agent: ManualAgent, error: unknown): ManualAgent {
  if (error instanceof ApiError && [400, 403, 404, 409, 422].includes(error.status ?? 0)) {
    return { ...agent, status: "failed", stage: error.serverMessage ?? "Launch refused", uncertain: false };
  }
  return { ...agent, status: "pending", stage: "Launch confirmation pending", uncertain: true };
}

function useFleetActions(data: ManualFleet | undefined, drafts: ReturnType<typeof useLaunchDrafts>) {
  const client = useQueryClient();
  const refresh = () => client.invalidateQueries({ queryKey: ["manual-agents"] });
  async function launch(request: Launch) {
    const id = request.id ?? crypto.randomUUID();
    drafts.add(pendingDraft(request, id, data));
    try {
      const result = await launchReceipt(request, id);
      drafts.update(id, () => result);
      await refresh();
    } catch (error) {
      drafts.update(id, agent => launchFailure(agent, error));
      throw error;
    }
    return id;
  }
  async function stop(id: string) {
    await apiSend("POST", `/api/manual-agents/${id}/stop`, { operation_id: crypto.randomUUID() });
    await refresh();
  }
  async function setSlots(node: string, project: string, slots: number) {
    const previous = data?.slots.find(item => matchesTarget(item, { node, project }));
    await apiSend("POST", `${targetPath({ node, project })}/slots`, { operation_id: crypto.randomUUID(), expected_revision: previous?.revision ?? 0, slots });
    await refresh();
  }
  return { launch, stop, setSlots };
}

export function ManualAgentsProvider({ children }: { children: ReactNode }) {
  const [params] = useSearchParams();
  const scope = params.get("scope");
  const project = scope?.startsWith("project:") ? scope.slice(8) : null;
  const read = useFleetRead(project);
  const drafts = useLaunchDrafts(read.data);
  const actions = useFleetActions(read.data, drafts);
  const visible = drafts.outstanding.filter(draft => !project || draft.project_id === project);
  const fleet = read.data && !isProtectedReadFailure(read.error) ? { ...read.data, sessions: [...read.data.sessions, ...visible] } : undefined;
  return <Context value={{ fleet, project, error: read.error, ...actions }}>{children}</Context>;
}
