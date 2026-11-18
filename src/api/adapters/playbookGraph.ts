import { ContractError, isRecord } from "./contract";
import type { Namespace } from "./playbooks";

export const DEFINITION_GRAPH_CAPABILITY = "playbooks.definition-graph.read";
export type StepKind = "invoke" | "decide" | "wait" | "for_each" | "call" | "join" | "return";
export type Transition = { label: string; to: string; error: boolean };
export type StepFact = { label: string; value: string };
export type GraphStep = { id: string; kind: StepKind; target: string | null; transitions: Transition[]; facts: StepFact[] };
export type DefinitionGraph = { entries: Map<string, string>; steps: Map<string, GraphStep> };
export type DefinitionInspection = { graph: DefinitionGraph | null; descriptionMarkdown: string | null };

const stepKinds = new Set<string>(["invoke", "decide", "wait", "for_each", "call", "join", "return"]);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
function ensure(value: unknown): asserts value {
  if (!value) throw new ContractError("Invalid compiled playbook graph response");
}

export function adaptDefinitionGraph(raw: unknown, artifact: string, namespace: Namespace): DefinitionInspection {
  ensure(isRecord(raw) && raw.api_version === "playbooks-definition-graph-1" && raw.artifact === artifact);
  ensure(isRecord(raw.namespace) && raw.namespace.id === namespace.id &&
    raw.namespace.generation === namespace.generation && raw.namespace.project_id === namespace.projectId);
  const descriptionMarkdown = raw.description_markdown ?? null;
  ensure(descriptionMarkdown === null || (text(descriptionMarkdown) &&
    new TextEncoder().encode(descriptionMarkdown).length <= 131_072));
  if (raw.graph === null) return { graph: null, descriptionMarkdown };
  ensure(isRecord(raw.graph) && isRecord(raw.graph.entries) && isRecord(raw.graph.steps));
  ensure(new TextEncoder().encode(JSON.stringify(raw.graph)).length <= 65_536);
  const factsByStep = raw.step_facts ?? {};
  ensure(isRecord(factsByStep) && new TextEncoder().encode(JSON.stringify(factsByStep)).length <= 32_768);
  const steps = new Map<string, GraphStep>();
  for (const [id, step] of Object.entries(raw.graph.steps)) {
    ensure(text(id) && isRecord(step) && step.id === id && text(step.kind) && stepKinds.has(step.kind));
    ensure((step.target === null || text(step.target)) && Array.isArray(step.edges));
    const transitions = step.edges.map(edge => {
      ensure(isRecord(edge) && text(edge.label) && text(edge.to));
      return { label: edge.label, to: edge.to, error: false };
    });
    if (step.on_error !== null) {
      ensure(text(step.on_error));
      transitions.push({ label: "On error", to: step.on_error, error: true });
    }
    const facts = Object.hasOwn(factsByStep, id) ? factsByStep[id] : [];
    ensure(Array.isArray(facts) && facts.every(fact => isRecord(fact) && text(fact.label) && typeof fact.value === "string"));
    steps.set(id, { id, kind: step.kind as StepKind, target: step.target, transitions, facts });
  }
  const entries = new Map<string, string>();
  for (const [entry, start] of Object.entries(raw.graph.entries)) {
    ensure(text(entry) && text(start) && steps.has(start));
    entries.set(entry, start);
  }
  ensure(entries.size > 0 && [...steps.values()].every(step => step.transitions.every(edge => steps.has(edge.to))));
  return { graph: { entries, steps }, descriptionMarkdown };
}
