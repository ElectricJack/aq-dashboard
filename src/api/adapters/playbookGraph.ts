import { ContractError, isRecord } from "./contract";
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

function adaptInspection(raw: unknown, steps: Map<string, GraphStep>) {
  if (!isRecord(raw) || new TextEncoder().encode(JSON.stringify(raw)).length > 24_576) return;
  for (const [id, entry] of Object.entries(raw)) {
    const step = steps.get(id);
    if (!step || !isRecord(entry)) continue;
    const summary = displayText(entry.summary) ? entry.summary : undefined;
    const uses: StepUse[] = [];
    if (Array.isArray(entry.uses)) {
      for (const use of entry.uses) {
        if (!isRecord(use) || !text(use.producer) || !text(use.consumer) || use.producer === use.consumer ||
          (use.producer !== id && use.consumer !== id) || !steps.has(use.producer) || !steps.has(use.consumer) ||
          !Array.isArray(use.paths) || use.paths.length === 0 || !use.paths.every(displayText)) continue;
        uses.push({ producer: use.producer, consumer: use.consumer, paths: use.paths,
          purpose: displayText(use.purpose) ? use.purpose : undefined });
      }
    }
    if (summary || uses.length > 0) step.inspection = { summary, uses };
    if (Array.isArray(entry.branches)) {
      for (const branch of entry.branches) {
        if (!isRecord(branch) || !text(branch.label) || !text(branch.to) || typeof branch.error !== "boolean" || !displayText(branch.reason)) continue;
        const transition = step.transitions.find(edge => edge.label === branch.label && edge.error === branch.error && edge.to === branch.to);
        if (transition && !transition.reason) transition.reason = branch.reason;
      }
    }
  }
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
  adaptInspection(raw.step_inspection, steps);
  return { graph: { entries, steps }, descriptionMarkdown };
}
