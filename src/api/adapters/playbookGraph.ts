import { ContractError, isRecord, nullable, sameFields } from "./contract";
import type { Namespace } from "./playbooks";

export const DEFINITION_GRAPH_CAPABILITY = "playbooks.definition-graph.read";
export type StepKind = "invoke" | "decide" | "wait" | "for_each" | "call" | "join" | "return";
export type Transition = { label: string; to: string; error: boolean; reason?: string };
export type StepFact = { label: string; value: string };
export type StepUse = { producer: string; consumer: string; paths: string[]; purpose?: string };
export type GraphStep = {
  id: string; kind: StepKind; target: string | null; transitions: Transition[]; facts: StepFact[];
  inspection?: { summary?: string; uses: StepUse[] };
};
export type DefinitionGraph = { entries: Map<string, string>; steps: Map<string, GraphStep> };
export type DefinitionInspection = { graph: DefinitionGraph | null; descriptionMarkdown: string | null };

const stepKinds = new Set<string>(["invoke", "decide", "wait", "for_each", "call", "join", "return"]);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function ensure(value: unknown): asserts value {
  if (!value) throw new ContractError("Invalid compiled playbook graph response");
}

const displayText = (value: unknown): value is string => text(value) && value.trim().length > 0;

function stepId(value: unknown, steps: Map<string, GraphStep>): value is string {
  return text(value) && steps.has(value);
}

function usePaths(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(displayText);
}

function stepUse(use: unknown, step: GraphStep, steps: Map<string, GraphStep>): StepUse | null {
  if (!isRecord(use)) return null;
  const { producer, consumer, paths, purpose } = use;
  if (!stepId(producer, steps) || !stepId(consumer, steps)) return null;
  if (producer === consumer || ![producer, consumer].includes(step.id)) return null;
  if (!usePaths(paths)) return null;
  return { producer, consumer, paths, purpose: displayText(purpose) ? purpose : undefined };
}

function hasBranchReason(value: unknown): value is Transition & { reason: string } {
  if (!isRecord(value)) return false;
  return text(value.label) && text(value.to) && typeof value.error === "boolean" && displayText(value.reason);
}

function branchReasons(branches: unknown, step: GraphStep) {
  if (!Array.isArray(branches)) return;
  for (const branch of branches.filter(hasBranchReason)) {
    const transition = step.transitions.find(edge => sameFields(edge, branch, ["label", "error", "to"]));
    if (transition && !transition.reason) transition.reason = branch.reason;
  }
}

function inspectedUses(uses: unknown, step: GraphStep, steps: Map<string, GraphStep>) {
  if (!Array.isArray(uses)) return [];
  return uses.map(value => stepUse(value, step, steps)).filter(use => use !== null);
}

function inspectStep(entry: Record<string, unknown>, step: GraphStep, steps: Map<string, GraphStep>) {
  const summary = displayText(entry.summary) ? entry.summary : undefined;
  const uses = inspectedUses(entry.uses, step, steps);
  if (summary || uses.length > 0) step.inspection = { summary, uses };
  branchReasons(entry.branches, step);
}

function adaptInspection(raw: unknown, steps: Map<string, GraphStep>) {
  if (!isRecord(raw) || new TextEncoder().encode(JSON.stringify(raw)).length > 24_576) return;
  for (const [id, entry] of Object.entries(raw)) {
    const step = steps.get(id);
    if (!step || !isRecord(entry)) continue;
    inspectStep(entry, step, steps);
  }
}

function stepTransitions(edges: unknown[], onError: unknown) {
  const transitions = edges.map(edge => {
    ensure(isRecord(edge));
    ensure(text(edge.label));
    ensure(text(edge.to));
    return { label: edge.label, to: edge.to, error: false };
  });
  if (onError !== null) {
    ensure(text(onError));
    transitions.push({ label: "On error", to: onError, error: true });
  }
  return transitions;
}

function graphSteps(rows: Record<string, unknown>, factsByStep: Record<string, unknown>) {
  const steps = new Map<string, GraphStep>();
  for (const [id, step] of Object.entries(rows)) {
    ensure(text(id));
    ensure(isRecord(step));
    ensure(step.id === id);
    ensure(text(step.kind));
    ensure(stepKinds.has(step.kind));
    ensure(nullable(step.target, text));
    ensure(Array.isArray(step.edges));
    const transitions = stepTransitions(step.edges, step.on_error);
    const facts = Object.hasOwn(factsByStep, id) ? factsByStep[id] : [];
    ensure(Array.isArray(facts) && facts.every(fact => isRecord(fact) && text(fact.label) && typeof fact.value === "string"));
    steps.set(id, { id, kind: step.kind as StepKind, target: step.target, transitions, facts });
  }
  return steps;
}

export function adaptDefinitionGraph(raw: unknown, artifact: string, namespace: Namespace): DefinitionInspection {
  ensure(isRecord(raw));
  ensure(raw.api_version === "playbooks-definition-graph-1");
  ensure(raw.artifact === artifact);
  ensure(isRecord(raw.namespace));
  ensure(raw.namespace.id === namespace.id);
  ensure(raw.namespace.generation === namespace.generation);
  ensure(raw.namespace.project_id === namespace.projectId);
  const descriptionMarkdown = raw.description_markdown ?? null;
  ensure(descriptionMarkdown === null || (text(descriptionMarkdown) &&
    new TextEncoder().encode(descriptionMarkdown).length <= 131_072));
  if (raw.graph === null) return { graph: null, descriptionMarkdown };
  ensure(isRecord(raw.graph));
  ensure(isRecord(raw.graph.entries));
  ensure(isRecord(raw.graph.steps));
  ensure(new TextEncoder().encode(JSON.stringify(raw.graph)).length <= 65_536);
  const factsByStep = raw.step_facts ?? {};
  ensure(isRecord(factsByStep));
  ensure(new TextEncoder().encode(JSON.stringify(factsByStep)).length <= 32_768);
  const steps = graphSteps(raw.graph.steps, factsByStep);
  const entries = new Map<string, string>();
  for (const [entry, start] of Object.entries(raw.graph.entries)) {
    ensure(text(entry));
    ensure(stepId(start, steps));
    entries.set(entry, start);
  }
  ensure(entries.size > 0);
  ensure([...steps.values()].every(step => step.transitions.every(edge => steps.has(edge.to))));
  adaptInspection(raw.step_inspection, steps);
  return { graph: { entries, steps }, descriptionMarkdown };
}
