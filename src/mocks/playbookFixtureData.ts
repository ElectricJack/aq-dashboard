import examples from "../../contracts/live/current-playbook-catalog/examples.json";
import {fixtureProject} from "./humanGraph";
import {SERVER_TIME} from "./inspectionData";
import type {PlaybookMode} from "./playbooks";
export const NOW = Date.parse(SERVER_TIME);
const minutesAgo = (m: number, s = 0) => NOW - m * 60_000 - s * 1000;
const sha = (prefix: string) => `sha256:${prefix}${"0".repeat(64 - prefix.length)}`;

export const PLAYBOOK_FIXTURE_NAMESPACE = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  generation: "1",
  name: "Fixture: project coding policy",
  project_id: fixtureProject.id,
};
const REVISION = "284";
const runId = (n: number) => `run-${String(n).padStart(16, "0")}`;
export const WAITING_RUN_ID = runId(284);
export const CHILD_RUN_ID = runId(285);

/** Pinned artifacts; the waiting run's artifact is the current definition below. */
const ARTIFACT = { recovery: sha("a81c9e"), report: sha("5e7a01"), integrate: sha("1c0de2"), route: sha("7a5c91"), validate: sha("b4d1d8"), routingInspection: sha("e101ca") };
const DEPENDENCIES = { checks: sha("c4ec5a"), "recovery-plan": sha("9e7c31") };

type RunView = {
  id: string; artifact: string; entry: string; step: string; status: string; outcome: string | null; reason: string | null;
  root: string; parent: string | null; children: string[]; dependencies: Record<string, string>; pending_kind: string | null; admitted_at_ms: number;
};
const run = (n: number, fields: Partial<RunView> & Pick<RunView, "artifact" | "entry" | "step" | "status" | "admitted_at_ms">): RunView => ({
  id: runId(n), outcome: null, reason: null, root: runId(n), parent: null, children: [], dependencies: {}, pending_kind: null, ...fields,
});

/** Key-ordered (ascending id), as the inspection API returns them. */
export const FIXTURE_RUNS: RunView[] = [
  run(280, { artifact: ARTIFACT.report, entry: "supervisor-report", step: "publish-report", status: "completed", outcome: "ok", admitted_at_ms: minutesAgo(12) }),
  run(282, { artifact: ARTIFACT.integrate, entry: "integrate-change", step: "merge-check", status: "blocked", reason: "Fixture: the merge check reported conflicting changes.", pending_kind: "investigation", admitted_at_ms: minutesAgo(8) }),
  run(284, { artifact: ARTIFACT.recovery, entry: "worker-recovery", step: "request-review", status: "waiting", reason: "Implementation stays paused until this revision receives a decision.", children: [CHILD_RUN_ID], dependencies: DEPENDENCIES, pending_kind: "decision", admitted_at_ms: minutesAgo(18) }),
  run(285, { artifact: ARTIFACT.validate, entry: "validate-recovery-inputs", step: "report-inputs", status: "completed", outcome: "ok", root: WAITING_RUN_ID, parent: WAITING_RUN_ID, admitted_at_ms: minutesAgo(17) }),
  run(289, { artifact: ARTIFACT.validate, entry: "validate-candidate", step: "run-checks", status: "running", admitted_at_ms: minutesAgo(3) }),
  run(291, { artifact: ARTIFACT.route, entry: "route-new-task", step: "choose-route", status: "running", admitted_at_ms: minutesAgo(1) }),
];

type Receipt = { sequence: string; step: string; at_ms: number; kind: string; operation: string | null; outcome: string | null; child: string | null };
type Effect = { id: string; step: string; command: string; status: string; deadline_at_ms: number | null; cancel_requested: boolean };
type RecordedReceipt = Pick<Receipt,"sequence"|"step"|"at_ms"|"kind"> & Partial<Receipt>;
function receipt(fields:RecordedReceipt):Receipt {
  const {sequence,step,at_ms,kind,...details} = fields;
  return {sequence,step,at_ms,kind,operation:null,outcome:null,child:null,...details};
}

export const RECEIPTS: Record<string, Receipt[]> = {
  [runId(280)]: [receipt({ sequence:"2801", step:"collect-status", at_ms:minutesAgo(12), kind:"command_result", operation: "op-280-1", outcome: "ok" }), receipt({ sequence:"2802", step:"publish-report", at_ms:minutesAgo(11), kind:"command_result", operation: "op-280-2", outcome: "ok" })],
  [runId(282)]: [receipt({ sequence:"2821", step:"prepare-change", at_ms:minutesAgo(8), kind:"command_result", operation: "op-282-1", outcome: "ok" }), receipt({ sequence:"2822", step:"merge-check", at_ms:minutesAgo(7), kind:"command_result", operation: "op-282-2", outcome: "conflict" })],
  [WAITING_RUN_ID]: [
    receipt({ sequence:"2841", step:"inspect-attempt", at_ms:minutesAgo(18), kind:"command_result", operation: "op-284-1", outcome: "ok" }),
    receipt({ sequence:"2842", step:"retain-source", at_ms:minutesAgo(17), kind:"command_result", operation: "op-284-2", outcome: "ok" }),
    receipt({ sequence:"2843", step:"retain-source", at_ms:minutesAgo(16), kind:"child_completed", child: CHILD_RUN_ID, outcome: "ok" }),
    receipt({ sequence:"2844", step:"request-review", at_ms:minutesAgo(16), kind:"operation_accepted", operation: "op-284-3" }),
  ],
  [CHILD_RUN_ID]: [receipt({ sequence:"2851", step:"report-inputs", at_ms:minutesAgo(16), kind:"command_result", operation: "op-285-1", outcome: "ok" })],
  [runId(289)]: [receipt({ sequence:"2891", step:"prepare-candidate", at_ms:minutesAgo(3), kind:"command_result", operation: "op-289-1", outcome: "ok" })],
  [runId(291)]: [],
};
export const EFFECTS: Record<string, Effect[]> = {
  [WAITING_RUN_ID]: [{ id: "op-284-3", step: "request-review", command: "decision.request", status: "accepted", deadline_at_ms: null, cancel_requested: false }],
  [runId(289)]: [{ id: "op-289-2", step: "run-checks", command: "checks.run", status: "running", deadline_at_ms: NOW + 10 * 60_000, cancel_requested: false }],
  [runId(291)]: [{ id: "op-291-1", step: "choose-route", command: "route.select", status: "accepted", deadline_at_ms: null, cancel_requested: false }],
};

export const ADMISSIONS = [{ request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", status: "admitted", created_at_ms: minutesAgo(1, 5), run_id: runId(291), activation_revision: "3", catalog_revision: "5" }];

/** Current catalog represents two fixture artifacts, in digest order. */
type DefinitionMetadata = {artifact:string;name:string;purpose:string;entries:string[]};
function definition({artifact,name,purpose,entries}: DefinitionMetadata) {
  const item = structuredClone(examples.definitions.items[0]!);
  Object.assign(item.record.metadata, { artifact, executable_fingerprint: sha("f1a9e2"), source_digest: sha("50c3e7"), name, purpose, entries, dependencies: {} });
  item.key = artifact;
  return item;
}
const DEFINITIONS = [
  definition({artifact:ARTIFACT.recovery, name:"worker-recovery", purpose:"Recover a stalled worker attempt. Preserve its source and request a human review before starting recovery.", entries:["worker-recovery"]}),
  definition({artifact:ARTIFACT.validate, name:"validate-candidate", purpose:"Check that a candidate is ready to integrate, or validate the inputs to a recovery.", entries:["validate-candidate", "validate-recovery-inputs"]}),
];
const ROUTING_DEFINITION = definition({artifact:ARTIFACT.routingInspection, name:"task-routing", purpose:"Keep owner-set routes and assess tasks that still need an automatic routing decision.", entries:["main"]});

type StepLink = {successors?:Record<string,string>;onError?:string};
function step(id:string,kind:string,target:string|null,links:StepLink={}) {
  const {successors={},onError=null}=links;
  return {id,kind,target,edges:Object.entries(successors).map(([label,to])=>({label,to})),on_error:onError};
}
function graph(entries: Record<string, string>, steps: ReturnType<typeof step>[]) {
  return { entries, steps: Object.fromEntries(steps.map(row => [row.id, row])) };
}
const GRAPHS = new Map([
  [ARTIFACT.recovery, graph({ "worker-recovery": "inspect-attempt" }, [
    step("inspect-attempt", "invoke", "task.inspect_attempt", {successors:{ found: "retain-source" }}),
    step("retain-source", "invoke", "git.retain_source", {successors:{ retained: "request-review" }, onError:"stop-recovery"}),
    step("request-review", "wait", "decision.resolved", {successors:{ approved: "start-recovery", denied: "stop-recovery" }}),
    step("start-recovery", "call", "recovery-plan/start"),
    step("stop-recovery", "return", null),
  ])],
  [ARTIFACT.validate, graph({ "validate-candidate": "prepare-candidate", "validate-recovery-inputs": "report-inputs" }, [
    step("prepare-candidate", "invoke", "checks.prepare", {successors:{ ready: "run-checks" }}),
    step("run-checks", "invoke", "checks.run", {successors:{ passed: "accept-candidate", failed: "reject-candidate" }}),
    step("accept-candidate", "return", null),
    step("reject-candidate", "return", null),
    step("report-inputs", "invoke", "recovery.report_inputs"),
  ])],
  [ARTIFACT.routingInspection, graph({ main: "read" }, [
    step("read", "invoke", "work.read", {successors:{ observed: "owned", refused: "skipped" }, onError:"failed"}),
    step("owned", "decide", null, {successors:{ false: "ask", true: "skipped", unknown: "failed" }}),
    step("ask", "invoke", "judgment.assess", {successors:{ accepted: "await", assessed: "assume", failed: "assume", refused: "assume" }, onError:"assume"}),
    step("await", "join", null, {successors:{ completed: "route", no_match: "assume", timeout: "assume" }, onError:"assume"}),
    step("assume", "invoke", "work.route", {successors:{ refused: "refused", routed: "routed", stale: "skipped" }, onError:"failed"}),
    step("route", "invoke", "work.route", {successors:{ refused: "refused", routed: "routed", stale: "skipped" }, onError:"failed"}),
    step("failed", "return", null),
    step("refused", "return", null),
    step("routed", "return", null),
    step("skipped", "return", null),
  ])],
]);
const ROUTE_CHECK_USE = {
  producer: "read", consumer: "owned", paths: ["task.facts.route"], purpose: "Route check",
};
const ASSESSMENT_USE = {
  producer: "read", consumer: "ask", paths: ["task.facts.title", "task.facts.description", "task.facts.kind"],
  purpose: "Assessment context",
};
const ROUTING_INSPECTION = {
  read: {
    summary: "Looks up the task for this run and reads its current title, description, declared kind, and who set any existing route.\n\nIf the workflow requests an assessment, the agent uses those details to understand the work.",
    uses: [ROUTE_CHECK_USE, ASSESSMENT_USE],
    branches: [
      { label: "observed", to: "owned", error: false, reason: "The task was found and its details are available." },
      { label: "refused", to: "skipped", error: false, reason: "The task is unknown or its project does not use automatic routing." },
      { label: "On error", to: "failed", error: true, reason: "The step could not proceed, for example because its input was invalid or the runtime rejected the command." },
    ],
  },
  owned: {
    summary: "Checks whether an owner has already chosen the route for this task. It compares task.facts.route, which came from the task lookup, with owner. This keeps a manually chosen route in place.",
    uses: [ROUTE_CHECK_USE],
    branches: [
      { label: "false", to: "ask", error: false, reason: "The route is unset or was chosen by the automatic router." },
      { label: "true", to: "skipped", error: false, reason: "An owner already chose a route for this task." },
      { label: "unknown", to: "failed", error: false, reason: "The condition could not be evaluated." },
    ],
  },
  ask: {
    summary: "Asks an agent to classify the kind of work and assess its risk. The agent uses the task's title, description, and declared kind from the earlier task lookup.",
    uses: [ASSESSMENT_USE],
  },
};
const ROUTING_DESCRIPTION = `## Routing policy

**Keep routes chosen by an owner.** Assess the kind of work and its risk when the task needs an automatic route.`;
const RECOVERY_DESCRIPTION = `## When to use this playbook

Use worker recovery when a stalled attempt needs to hand off its changes.

1. **Preserve the source** from the stalled attempt.
2. Wait for a human to review the recovery plan.
3. Start recovery if the plan is approved.`;
const ACTIVATION = (() => {
  const item = structuredClone(examples.activations.items[0]!);
  Object.assign(item.record.metadata, { binding: "worker-recovery", artifact: ARTIFACT.recovery });
  item.key = sha("ac7e01");
  return item;
})();

export const inspectionPage = <T,>(items: T[], next_cursor: string | null = null) =>
  ({ api_version: "playbooks-inspection-1", namespace: PLAYBOOK_FIXTURE_NAMESPACE, server_time_ms: NOW, revision: REVISION, items, next_cursor });

function catalog(kind: "definitions" | "activations", items: unknown[]) {
  const source = examples[kind];
  return { ...structuredClone(source), namespace: PLAYBOOK_FIXTURE_NAMESPACE, server_time_ms: NOW, items, next_cursor: null };
}

export function definitionGraph(mode: PlaybookMode, artifact: string) {
  return {
        api_version: "playbooks-definition-graph-1", namespace: PLAYBOOK_FIXTURE_NAMESPACE,
        artifact, graph: mode === "empty" ? null : GRAPHS.get(artifact) ?? null,
        ...(mode !== "empty" && artifact === ARTIFACT.recovery && {
          description_markdown: RECOVERY_DESCRIPTION,
          step_facts: { "request-review": [
            { label: "Matches event fields", value: "decision_id" },
            { label: "Deadline", value: "1 h" },
            { label: "Stores result as", value: "review_decision" },
          ] },
        }),
        ...(mode === "step-inspection" && artifact === ARTIFACT.routingInspection && {
          description_markdown: ROUTING_DESCRIPTION,
          step_inspection: ROUTING_INSPECTION,
          step_facts: {
            read: [
              { label: "Input fields", value: "subject" },
              { label: "Stores result as", value: "task" },
            ],
            owned: [{ label: "Checks", value: "task.facts.route" }],
            ask: [
              { label: "Input fields", value: "budget, context, fields, flags, question, rationale_max_bytes, subject" },
              { label: "Stores result as", value: "j" },
            ],
          },
        }),
  };
}
export type CatalogKind="definitions"|"activations";
function mismatch(query: string | null, actual: string) {
  return !!query && query !== actual;
}
export function catalogChanged(kind: CatalogKind, params: URLSearchParams) {
 const source=examples[kind];
 return mismatch(params.get("incarnation"),source.incarnation)||mismatch(params.get("metadata_revision"),source.metadata_revision);
}
export function catalogPage(kind: CatalogKind, mode: PlaybookMode, params: URLSearchParams) {
 if (mode==="empty") return catalog(kind,[]);
 const exact=params.get("exact"),after=params.get("after");
 const definitions=mode==="step-inspection"?[ROUTING_DEFINITION]:DEFINITIONS;
 const all=kind==="definitions"?definitions:[ACTIVATION];
 return catalog(kind,all.filter(item=>(!exact||item.key===exact)&&(!after||item.key>after)));
}
