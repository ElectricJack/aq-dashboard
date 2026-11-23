import { ContractError, isRecord, timestampMs } from "./contract";
import { validGraphId } from "./humanGraph";

export const HOST_DECISIONS = "playbooks.decisions";
export const HOST_DECISIONS_ROOT = "/api/playbooks/decisions";
export const HOST_DECISION_NOTE_BYTES = 2048;

export type HostChoice = "approved" | "rejected";
export type HostDecision = {
  handle: string;
  projectId: string;
  workspaceId: string;
  namespace: string;
  subject: { id: string; revision: number };
  question: string;
  choices: HostChoice[];
  responders: string[];
  expiresAt: number;
};
export type HostDecisionDetail = HostDecision & {
  taskId: string | null;
  producedKnowledgeIds: string[] | null;
};

function ensure(value: unknown): asserts value {
  if (!value) throw new ContractError("Invalid playbook decision response");
}

function validChoice(value: unknown): value is HostChoice {
  return value === "approved" || value === "rejected";
}

function compactUuid(value: string) {
  const unwrapped = value.replace(/^urn:uuid:/, "").replace(/^\{(.+)\}$/, "$1");
  return unwrapped.replaceAll("-", "").toLowerCase();
}

export function isHostDecisionResponder(decision: HostDecision, principalId: string) {
  const principal = compactUuid(principalId);
  return decision.responders.some(value => compactUuid(value.slice(5)) === principal);
}

function decisionSubject(subject: unknown): HostDecision["subject"] {
  ensure(isRecord(subject));
  ensure(typeof subject.id === "string" && subject.id.length > 0);
  ensure(typeof subject.revision === "number" && Number.isSafeInteger(subject.revision) && subject.revision >= 0);
  return { id: subject.id, revision: subject.revision };
}

function decisionChoices(choices: unknown): HostChoice[] {
  ensure(Array.isArray(choices) && choices.length > 0 && choices.every(validChoice));
  ensure(new Set(choices).size === choices.length);
  return choices;
}

function decisionResponders(responders: unknown): string[] {
  ensure(Array.isArray(responders) && responders.length > 0);
  ensure(responders.every(r => typeof r === "string" && r.startsWith("user:") && /^[0-9a-f]{32}$/.test(compactUuid(r.slice(5)))));
  return responders;
}

function adaptHostDecision(value: unknown): HostDecision {
  ensure(isRecord(value) && validGraphId(value.handle) && isRecord(value.namespace));
  const namespace = value.namespace;
  ensure(validGraphId(namespace.project_id));
  ensure(validGraphId(namespace.workspace_id));
  ensure(validGraphId(namespace.owner_user_id));
  ensure(typeof namespace.name === "string" && namespace.name.trim());
  const subject = decisionSubject(value.subject);
  ensure(typeof value.question === "string" && value.question.trim());
  const choices = decisionChoices(value.choices);
  const responders = decisionResponders(value.responders);
  ensure(timestampMs(value.expires_at_ms));
  return {
    handle: value.handle, projectId: namespace.project_id, workspaceId: namespace.workspace_id,
    namespace: namespace.name, subject,
    question: value.question, choices, responders, expiresAt: value.expires_at_ms,
  };
}

export function adaptHostDecisions(value: unknown): HostDecision[] {
  ensure(isRecord(value) && Array.isArray(value.decisions));
  const decisions = value.decisions.map(adaptHostDecision);
  ensure(new Set(decisions.map(row => row.handle)).size === decisions.length);
  return decisions;
}

export function adaptHostDecisionDetail(value: unknown, handle: string): HostDecisionDetail {
  const decision = adaptHostDecision(value);
  ensure(isRecord(value) && decision.handle === handle);
  const taskId = value.subject_task_id;
  const ids = value.produced_knowledge_ids;
  ensure(taskId === null || (validGraphId(taskId) && compactUuid(taskId) === compactUuid(decision.subject.id)));
  ensure(ids === null || (taskId && Array.isArray(ids) && ids.every(validGraphId) && new Set(ids).size === ids.length));
  return { ...decision, taskId, producedKnowledgeIds: ids };
}

export function adaptHostDecisionAnswer(value: unknown, decision: HostDecision): HostChoice {
  ensure(isRecord(value));
  ensure(validChoice(value.outcome));
  ensure(decision.choices.includes(value.outcome));
  ensure(isRecord(value.output));
  const subject = value.output.subject;
  ensure(value.output.reference === `decision:${decision.handle}`);
  ensure(isRecord(subject));
  ensure(subject.id === decision.subject.id);
  ensure(subject.revision === decision.subject.revision);
  return value.outcome;
}

export const hostChoiceLabel: Record<HostChoice, string> = { approved: "Approve", rejected: "Request changes" };
