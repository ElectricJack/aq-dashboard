/**
 * Mock-only review decision fixtures (DC-N). Every criterion, recorded result and
 * evidence ref says "Fixture"; nothing here claims to be a real AQ review.
 * Shapes follow the review-inbox-1 wire read by src/api/adapters/decisions.ts and
 * the receipt checked by scripts/probe-disposable-decision-actions.mjs. Unit tests
 * keep their own contract fixture in src/test/decisions.ts.
 */
import type { Bootstrap } from "../api/wire/proposed";
import { FIXTURE_IDS, fixtureProject } from "./humanGraph";
import { SERVER_TIME } from "./inspectionData";

/** Matches `decisionId` in src/test/decisions.ts so the reference review keeps its ids. */
export const fixtureDecisionId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
/** The mock principal: a UUID listed in the fixtures' `eligible_owners`. */
export const FIXTURE_PRINCIPAL_ID = fixtureDecisionId(901);
const OTHER_OWNER = fixtureDecisionId(902);

export const SERVER_TIME_MS = Date.parse(SERVER_TIME);
const HOUR = 3_600_000;
const hex = (n: number, length: number) => n.toString(16).padStart(2, "0").repeat(length / 2);
const ref = (id: string, n: number) => ({ id, version: "1", digest: hex(n, 64) });

type Ref = ReturnType<typeof ref>;
export type FixtureReceipt = {
  schema_version: 1; decision_id: string; decision_revision: 2; recorded_at_ms: number; request_digest: string;
  subject: Ref; review_policy: Ref; eligibility_project_revision: number;
  finality: { kind: "human_answer"; owner_user_id: string; operation_id: string; choice: "approve" | "reject" };
};
export type FixtureDecision = {
  request: { schema_version: 1; decision_id: string; operation_id: string; subject: Ref; eligible_owners: string[]; expires_at_ms: number; eligibility_project_revision: number; review_policy: Ref };
  subject: {
    schema_version: 1; project_id: string;
    task: { workspace_id: string; task_id: string; version: number; content_revision: number };
    result: { report_id: string; record_receipt: Ref; stopped_receipt: Ref };
    source: { repository_id: string; base: { format: "sha1"; hex: string }; resulting_object: { format: "sha1"; hex: string } };
    task_context: Ref; validation_policy: Ref; criteria: string[];
  };
  recorded_result: { report_id: string; conclusion: string; process_outcome: "success" | "failed"; recorded_at_ms: number };
  decision_revision: 1 | 2; state: "pending" | "answered"; current_report_head: boolean; receipt: FixtureReceipt | null;
};

type Spec = {
  n: number; project: string; workspace: string; task: string; report: string; taskVersion: number;
  current: boolean; owners: string[]; criteria: string[]; conclusion: string; submittedAgo: number;
  answer?: { choice: "approve" | "reject"; agoHours: number };
};

/** The receipt AQ returns for a human answer, bound to the exact request. */
export function fixtureReceipt(d: FixtureDecision, choice: "approve" | "reject", operationId: string, owner: string, recordedAt: number): FixtureReceipt {
  return {
    schema_version: 1, decision_id: d.request.decision_id, decision_revision: 2, recorded_at_ms: recordedAt,
    request_digest: d.request.subject.digest.split("").reverse().join(""),
    subject: d.request.subject, review_policy: d.request.review_policy, eligibility_project_revision: d.request.eligibility_project_revision,
    finality: { kind: "human_answer", owner_user_id: owner, operation_id: operationId, choice },
  };
}

function build(s: Spec): FixtureDecision {
  const id = fixtureDecisionId(s.n);
  const pending: FixtureDecision = {
    request: {
      schema_version: 1, decision_id: id, operation_id: fixtureDecisionId(s.n + 100), subject: ref(`fixture-review-subject-${s.n}`, s.n),
      eligible_owners: s.owners, expires_at_ms: SERVER_TIME_MS + 72 * HOUR, eligibility_project_revision: 1,
      review_policy: ref("fixture-review-policy", 0xa0),
    },
    subject: {
      schema_version: 1, project_id: s.project,
      task: { workspace_id: s.workspace, task_id: s.task, version: s.taskVersion, content_revision: 2 },
      result: { report_id: s.report, record_receipt: ref(`fixture-result-record-${s.n}`, s.n + 1), stopped_receipt: ref(`fixture-stopped-receipt-${s.n}`, s.n + 2) },
      source: { repository_id: fixtureDecisionId(6), base: { format: "sha1", hex: hex(s.n + 3, 40) }, resulting_object: { format: "sha1", hex: hex(s.n + 4, 40) } },
      task_context: ref(`fixture-task-context-${s.n}`, s.n + 5), validation_policy: ref("fixture-validation-policy", 0xb0),
      criteria: s.criteria,
    },
    recorded_result: { report_id: s.report, conclusion: s.conclusion, process_outcome: "success", recorded_at_ms: SERVER_TIME_MS - s.submittedAgo * HOUR },
    decision_revision: 1, state: "pending", current_report_head: s.current, receipt: null,
  };
  if (!s.answer) return pending;
  const receipt = fixtureReceipt(pending, s.answer.choice, fixtureDecisionId(s.n + 200), FIXTURE_PRINCIPAL_ID, SERVER_TIME_MS - s.answer.agoHours * HOUR);
  return { ...pending, decision_revision: 2, state: "answered", receipt };
}

const REFERENCE_PROJECT = fixtureDecisionId(3);
const WORKSPACE = fixtureDecisionId(8);
const GRAPH_WORKSPACE = fixtureProject.workspace_id;

/** Ids of the labelled review states, for tests and evidence. */
export const DECISION_FIXTURE_IDS = {
  /** Pending, current, answerable: the reference review (ids as in src/test/decisions.ts). */
  current: fixtureDecisionId(1),
  /** Pending but superseded: its result has a newer report (`current_report_head: false`). */
  superseded: fixtureDecisionId(21),
  /** Pending, current, in the labelled Work fixture project. */
  otherProject: fixtureDecisionId(31),
  /** Answered: approved, with a recorded receipt. */
  approved: fixtureDecisionId(41),
  /** Answered: changes requested, with a recorded receipt. */
  rejected: fixtureDecisionId(51),
} as const;

/** Fresh copies, so a mock session can record answers without touching the module data. */
export function decisionFixtures(): FixtureDecision[] {
  return [
    build({ n: 1, project: REFERENCE_PROJECT, workspace: WORKSPACE, task: fixtureDecisionId(4), report: fixtureDecisionId(5), taskVersion: 3, current: true,
      owners: [FIXTURE_PRINCIPAL_ID, OTHER_OWNER], submittedAgo: 2,
      criteria: ["Fixture: recovery tests retained", "Fixture: source evidence reviewed"],
      conclusion: "Fixture · Recovery replays reconcile with recorded state; ready for review." }),
    build({ n: 21, project: REFERENCE_PROJECT, workspace: WORKSPACE, task: fixtureDecisionId(4), report: fixtureDecisionId(25), taskVersion: 2, current: false,
      owners: [FIXTURE_PRINCIPAL_ID], submittedAgo: 26,
      criteria: ["Fixture: recovery tests retained"],
      conclusion: "Fixture · Earlier recovery report, since replaced by a newer report." }),
    build({ n: 31, project: fixtureProject.id, workspace: GRAPH_WORKSPACE, task: FIXTURE_IDS.approve, report: fixtureDecisionId(35), taskVersion: 1, current: true,
      owners: [FIXTURE_PRINCIPAL_ID], submittedAgo: 5,
      criteria: ["Fixture: an operator approves the recovery plan"],
      conclusion: "Fixture · Recovery plan drafted for operator approval." }),
    build({ n: 41, project: fixtureProject.id, workspace: GRAPH_WORKSPACE, task: FIXTURE_IDS.lease, report: fixtureDecisionId(45), taskVersion: 2, current: true,
      owners: [FIXTURE_PRINCIPAL_ID], submittedAgo: 50, answer: { choice: "approve", agoHours: 48 },
      criteria: ["Fixture: lease fields and expiry rules are written down"],
      conclusion: "Fixture · Lease contract written down and reviewed." }),
    build({ n: 51, project: REFERENCE_PROJECT, workspace: WORKSPACE, task: fixtureDecisionId(54), report: fixtureDecisionId(55), taskVersion: 4, current: true,
      owners: [FIXTURE_PRINCIPAL_ID, OTHER_OWNER], submittedAgo: 30, answer: { choice: "reject", agoHours: 28 },
      criteria: ["Fixture: legacy lease path has no remaining callers"],
      conclusion: "Fixture · Legacy lease path removal proposed." }),
  ];
}

/** The inbox row the server would list for a decision and principal. */
export function fixtureSummary(d: FixtureDecision, principal: string) {
  return {
    decision_id: d.request.decision_id, decision_revision: d.decision_revision, state: d.state, expires_at_ms: d.request.expires_at_ms,
    project_id: d.subject.project_id, task_id: d.subject.task.task_id, report_id: d.subject.result.report_id,
    current_report_head: d.current_report_head, eligible_owner: d.request.eligible_owners.includes(principal),
  };
}

/**
 * Mock app bootstrap: the fixture principal (a UUID owner of the fixtures) and
 * `decisions.resolve`, offered unless the scenario turns dashboard actions off.
 */
export function withDecisionFixtures(bootstrap: Bootstrap): Bootstrap {
  const actions = bootstrap.capabilities.find((c) => c.name === "dashboard.actions")?.enabled !== false;
  return {
    ...bootstrap,
    principal: { ...bootstrap.principal, id: FIXTURE_PRINCIPAL_ID },
    capabilities: [
      ...bootstrap.capabilities.filter((c) => c.name !== "decisions.resolve"),
      actions
        ? { name: "decisions.resolve", version: "1", enabled: true }
        : { name: "decisions.resolve", version: "1", enabled: false, reason: "Fixture scenario: actions are not offered" },
    ],
  };
}
