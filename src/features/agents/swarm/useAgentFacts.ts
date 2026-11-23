import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiGet } from "../../../api/client";
import { isRecord } from "../../../api/adapters/contract";
import { adaptGraphDetail, adaptGraphEnvelope, validGraphId } from "../../../api/adapters/humanGraph";
import { adaptAgentRanWith, type AgentView, type RanWithView, type SwarmView } from "../../../api/adapters/swarm";
import { graphPath } from "../../../api/humanGraphReads";
import { queryKey } from "../../../api/queryKeys";
import { PANEL_READ, useSession } from "../../../app/session";
import { titleMissing } from "./slots";

/**
 * Until the swarm read carries them, a running agent's task title and what it ran with (role, level, model, reasoning
 * effort) come from the task's own reads: the title from the task read, `ran_with` from the work read's holding attempt.
 * Each is read once per task or attempt and kept; nothing is polled. The human Graph API serves four requests at a time
 * and queues twelve, so these reads run two at a time. A read that fails leaves the row as the swarm read gave it.
 */
const KEEP_MS = 10 * 60_000;
const MAX_AT_ONCE = 2;
let running = 0;
const queue: (() => void)[] = [];
async function limited<T>(job: () => Promise<T>): Promise<T> {
  if (running >= MAX_AT_ONCE) await new Promise<void>(resolve => queue.push(resolve));
  running += 1;
  try { return await job(); } finally { running -= 1; queue.shift()?.(); }
}

type Target = { project: string; task: string; attempt: string };
type Facts = { titles: Map<string, string>; ranWith: Map<string, RanWithView> };

function swarmAgents(view: SwarmView | undefined) {
  return view?.machines.flatMap(machine => machine.nodes.flatMap(node => node.agents)) ?? [];
}
function factTarget(agent: AgentView): Target | null {
  if (agent.manual || !agent.task) return null;
  const { id: project } = agent.project, { id: task } = agent.task;
  if (!validGraphId(project) || !validGraphId(task)) return null;
  return { project, task, attempt: agent.attemptId };
}

/** The agents whose row lacks a title or a `ran_with` and whose ids the Graph reads accept. */
export function factTargets(view: SwarmView | undefined): { titles: Target[]; ranWith: Target[] } {
  const titles = new Map<string, Target>(), ranWith = new Map<string, Target>();
  for (const agent of swarmAgents(view)) {
    const target = factTarget(agent);
    if (!target) continue;
    if (titleMissing(agent.task)) titles.set(target.task, target);
    if (!agent.ranWith) ranWith.set(target.attempt, target);
  }
  return { titles: [...titles.values()], ranWith: [...ranWith.values()] };
}

function taskWithTitle(task: AgentView["task"], titles: Facts["titles"]) {
  if (!task || !titleMissing(task)) return task;
  const title = titles.get(task.id);
  return title === undefined ? task : { id: task.id, title };
}
function fillAgent(agent: AgentView, facts: Facts): AgentView {
  const task = taskWithTitle(agent.task, facts.titles);
  const updated = facts.ranWith.get(agent.attemptId);
  const addRun = !agent.ranWith && updated !== undefined;
  if (task === agent.task && !addRun) return agent;
  return addRun ? { ...agent, task, ranWith: updated } : { ...agent, task };
}

/** The swarm view with the facts filled in. Rows the reads did not answer are returned unchanged. */
export function applyFacts(view: SwarmView, facts: Facts): SwarmView {
  if (facts.titles.size === 0 && facts.ranWith.size === 0) return view;
  return { ...view, machines: view.machines.map(m => ({ ...m, nodes: m.nodes.map(n => ({ ...n, agents: n.agents.map(a => fillAgent(a, facts)) })) })) };
}

/** `ran_with` of the attempt that holds the task, only when it is the attempt the swarm row names. */
export function ranWithOf(raw: unknown, project: string, attempt: string): RanWithView | null {
  return adaptGraphEnvelope(raw, project, value => {
    const execution = isRecord(value) && isRecord(value.execution) ? value.execution : null;
    return execution && execution.attempt_id === attempt ? adaptAgentRanWith(execution.ran_with) : null;
  }).data;
}

function usableTitle(title: unknown, task: string): title is string {
  return typeof title === "string" && title.trim() !== "" && title !== task;
}

async function readTitle(target: Target, signal: AbortSignal) {
  const raw = await apiGet<unknown>(graphPath(target.project, "task", target.task), signal);
  return adaptGraphDetail(raw, target.project, "task", target.task).data.title;
}
async function readAttempt(target: Target, signal: AbortSignal) {
  const raw = await apiGet<unknown>(`${graphPath(target.project, "task", target.task)}/work`, signal);
  return ranWithOf(raw, target.project, target.attempt);
}

export function useAgentFacts(view: SwarmView | undefined): SwarmView | undefined {
  const { bootstrap, queryContext } = useSession();
  const enabled = bootstrap.capability("human.graph.read").enabled;
  const targets = useMemo(() => factTargets(view), [view]);
  const common = { enabled, staleTime: KEEP_MS, gcTime: KEEP_MS, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false, meta: PANEL_READ } as const;
  const titles = useQueries({
    queries: targets.titles.map(t => ({
      ...common, queryKey: queryKey(queryContext, "swarm-task-title", { project: t.project, id: t.task }),
      queryFn: ({ signal }: { signal: AbortSignal }) => limited(() => readTitle(t, signal)),
    })),
  });
  const ranWith = useQueries({
    queries: targets.ranWith.map(t => ({
      ...common, queryKey: queryKey(queryContext, "swarm-attempt-ran-with", { project: t.project, id: t.task, attempt: t.attempt }),
      queryFn: ({ signal }: { signal: AbortSignal }) => limited(() => readAttempt(t, signal)),
    })),
  });
  // The query results are new arrays on every render; key the memo on what they hold.
  const titleKey = titles.map(q => q.data ?? "").join("\n"), ranWithKey = ranWith.map(q => q.dataUpdatedAt).join(",");
  return useMemo(() => {
    if (!view) return view;
    const facts: Facts = { titles: new Map(), ranWith: new Map() };
    targets.titles.forEach((t, i) => { const title = titles[i]?.data; if (usableTitle(title, t.task)) facts.titles.set(t.task, title); });
    targets.ranWith.forEach((t, i) => { const r = ranWith[i]?.data; if (r) facts.ranWith.set(t.attempt, r); });
    return applyFacts(view, facts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, targets, titleKey, ranWithKey]);
}
