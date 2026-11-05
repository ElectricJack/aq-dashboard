import { http, HttpResponse } from "msw";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import examples from "../../contracts/live/current-playbook-catalog/examples.json";
import { fixtureProject } from "./humanGraph";
import { SERVER_TIME } from "./inspectionData";

/**
 * Mock-mode playbook fixtures for design reference 06 (Playbooks).
 * Shapes follow `playbooks-inspection-1` (src/test/playbooks.ts) and the
 * current catalog examples (contracts/live/current-playbook-catalog). The
 * namespace name labels every row as fixture data; nothing here is live AQ data.
 */
export const PLAYBOOK_CAPABILITIES = [
  "playbooks.inspect",
  "playbooks.catalog.read",
  // PROPOSED playbook action capabilities (dashboard-actions-1 kinds); not offered by aq-server main yet.
  "playbooks.runs.start",
  "playbooks.runs.cancel",
  "playbooks.activations.activate",
  "playbooks.activations.rollback",
] as const;
export type PlaybookMode = "ok" | "empty" | "failed" | "unavailable";

/** `?scenario=` switches for playbook reads: empty rows, failed reads, or an unconfigured runtime. */
export function playbookMode(name: string | null | undefined): PlaybookMode {
  if (name === "empty") return "empty";
  if (name === "failed" || name === "reads-failed") return "failed";
  if (name === "unavailable") return "unavailable";
  return "ok";
}

export function playbookCapabilities(mode: PlaybookMode) {
  return PLAYBOOK_CAPABILITIES.map((name) =>
    mode === "unavailable"
      ? { name, version: "1", enabled: false, reason: "Fixture scenario: the playbook runtime is not configured" }
      : { name, version: "1", enabled: true },
  );
}

const NOW = Date.parse(SERVER_TIME);
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
const ARTIFACT = { recovery: sha("a81c9e"), report: sha("5e7a01"), integrate: sha("1c0de2"), route: sha("7a5c91"), validate: sha("b4d1d8") };
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
const receipt = (sequence: number, step: string, at_ms: number, kind: string, extra: Partial<Receipt> = {}): Receipt =>
  ({ sequence: String(sequence), step, at_ms, kind, operation: null, outcome: null, child: null, ...extra });

const RECEIPTS: Record<string, Receipt[]> = {
  [runId(280)]: [receipt(2801, "collect-status", minutesAgo(12), "command_result", { operation: "op-280-1", outcome: "ok" }), receipt(2802, "publish-report", minutesAgo(11), "command_result", { operation: "op-280-2", outcome: "ok" })],
  [runId(282)]: [receipt(2821, "prepare-change", minutesAgo(8), "command_result", { operation: "op-282-1", outcome: "ok" }), receipt(2822, "merge-check", minutesAgo(7), "command_result", { operation: "op-282-2", outcome: "conflict" })],
  [WAITING_RUN_ID]: [
    receipt(2841, "inspect-attempt", minutesAgo(18), "command_result", { operation: "op-284-1", outcome: "ok" }),
    receipt(2842, "retain-source", minutesAgo(17), "command_result", { operation: "op-284-2", outcome: "ok" }),
    receipt(2843, "retain-source", minutesAgo(16), "child_completed", { child: CHILD_RUN_ID, outcome: "ok" }),
    receipt(2844, "request-review", minutesAgo(16), "operation_accepted", { operation: "op-284-3" }),
  ],
  [CHILD_RUN_ID]: [receipt(2851, "report-inputs", minutesAgo(16), "command_result", { operation: "op-285-1", outcome: "ok" })],
  [runId(289)]: [receipt(2891, "prepare-candidate", minutesAgo(3), "command_result", { operation: "op-289-1", outcome: "ok" })],
  [runId(291)]: [],
};
const EFFECTS: Record<string, Effect[]> = {
  [WAITING_RUN_ID]: [{ id: "op-284-3", step: "request-review", command: "decision.request", status: "accepted", deadline_at_ms: null, cancel_requested: false }],
  [runId(289)]: [{ id: "op-289-2", step: "run-checks", command: "checks.run", status: "running", deadline_at_ms: NOW + 10 * 60_000, cancel_requested: false }],
  [runId(291)]: [{ id: "op-291-1", step: "choose-route", command: "route.select", status: "accepted", deadline_at_ms: null, cancel_requested: false }],
};

const ADMISSIONS = [{ request_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", status: "admitted", created_at_ms: minutesAgo(1, 5), run_id: runId(291), activation_revision: "3", catalog_revision: "5" }];

/** Current catalog: the waiting run's pinned definition and its activation, from the contract examples. */
const DEFINITION = (() => {
  const item = structuredClone(examples.definitions.items[0]!);
  Object.assign(item.record.metadata, {
    artifact: ARTIFACT.recovery, executable_fingerprint: sha("f1a9e2"), source_digest: sha("50c3e7"),
    name: "worker-recovery", purpose: "Fixture: recover a stalled worker attempt after a human review. Mock-mode data for design review, not an installed playbook.", entries: ["worker-recovery"],
  });
  item.key = ARTIFACT.recovery;
  return item;
})();
const ACTIVATION = (() => {
  const item = structuredClone(examples.activations.items[0]!);
  Object.assign(item.record.metadata, { binding: "worker-recovery", artifact: ARTIFACT.recovery });
  item.key = sha("ac7e01");
  return item;
})();

const inspectionPage = <T,>(items: T[], next_cursor: string | null = null) =>
  ({ api_version: "playbooks-inspection-1", namespace: PLAYBOOK_FIXTURE_NAMESPACE, server_time_ms: NOW, revision: REVISION, items, next_cursor });

function catalog(kind: "definitions" | "activations", items: unknown[]) {
  const source = examples[kind];
  return { ...structuredClone(source), namespace: PLAYBOOK_FIXTURE_NAMESPACE, server_time_ms: NOW, items, next_cursor: null };
}

export function playbookHandlers(mode: PlaybookMode) {
  const base = "/api/playbooks/inspection";
  const failure = (status: number, code: string, message: string) =>
    HttpResponse.json({ request_id: "fixture", code, message, retryable: status >= 500 }, { status });
  /** Shared guards: scenario failure, then a project scope that is not the fixture namespace's project. */
  const refuse = (url: URL) => {
    if (mode === "failed") return failure(503, "read_model_unavailable", "Playbook inspection is temporarily unavailable.");
    if (mode === "unavailable") return failure(404, "not_found", "Playbook inspection is not configured.");
    const project = url.searchParams.get("project_id");
    if (project && project !== PLAYBOOK_FIXTURE_NAMESPACE.project_id) return failure(404, "not_found", "No playbook namespace is configured for this project.");
    return null;
  };
  const limitOf = (url: URL) => Math.min(25, Math.max(1, Number(url.searchParams.get("limit")) || 25));
  const runs = mode === "empty" ? [] : FIXTURE_RUNS;

  return [
    http.get(`${base}/runs`, ({ request }) => {
      const url = new URL(request.url);
      const refused = refuse(url); if (refused) return refused;
      const after = url.searchParams.get("after"), limit = limitOf(url);
      const rest = runs.filter((r) => !after || r.id > after), items = rest.slice(0, limit);
      return HttpResponse.json(inspectionPage(items, rest.length > limit ? items.at(-1)!.id : null));
    }),
    http.get(`${base}/runs/:id`, ({ request, params }) => {
      const url = new URL(request.url);
      const refused = refuse(url); if (refused) return refused;
      const found = runs.find((r) => r.id === params.id);
      if (!found) return failure(404, "not_found", "This run does not exist or is not available to you.");
      const after = url.searchParams.get("after");
      const receipts = (RECEIPTS[found.id] ?? []).filter((r) => !after || BigInt(r.sequence) > BigInt(after));
      return HttpResponse.json({
        api_version: "playbooks-inspection-1", namespace: PLAYBOOK_FIXTURE_NAMESPACE, server_time_ms: NOW, observation_is_atomic: false,
        run: found, effects: inspectionPage(EFFECTS[found.id] ?? []), receipts: inspectionPage(receipts),
      });
    }),
    http.get(`${base}/admissions`, ({ request }) => {
      const refused = refuse(new URL(request.url)); if (refused) return refused;
      return HttpResponse.json(inspectionPage(mode === "empty" ? [] : ADMISSIONS));
    }),
    http.get(`${base}/catalog/:kind`, ({ request, params }) => {
      const url = new URL(request.url);
      const kind = params.kind === "definitions" || params.kind === "activations" ? params.kind : null;
      if (!kind) return failure(404, "not_found", "Unknown catalog.");
      const refused = refuse(url); if (refused) return refused;
      const source = examples[kind];
      const incarnation = url.searchParams.get("incarnation"), revision = url.searchParams.get("metadata_revision");
      if ((incarnation && incarnation !== source.incarnation) || (revision && revision !== source.metadata_revision)) return failure(409, "catalog_changed", "The catalog changed since it was observed.");
      const exact = url.searchParams.get("exact"), after = url.searchParams.get("after");
      const all = mode === "empty" ? [] : [kind === "definitions" ? DEFINITION : ACTIVATION];
      return HttpResponse.json(catalog(kind, all.filter((item) => (!exact || item.key === exact) && (!after || item.key > after))));
    }),
  ];
}

/**
 * Mock-mode `playbook.*` operations through the action union: admission is pending, the
 * first lookup confirms with a labelled fixture receipt. Other kinds fall through untouched.
 */
export function playbookActionHandlers() {
  const seen = new Map<string, { subject: unknown; project: string }>();
  const respond = (id: string, disposition: "pending" | "confirmed", entry: { subject: unknown; project: string }) =>
    HttpResponse.json({ ...operationFixture, data: { ...operationFixture.data, operation_id: id, disposition,
      scope: { kind: "project", project_id: entry.project }, subject_refs: [entry.subject],
      receipt_refs: disposition === "confirmed" ? [{ type: "playbook_operation", id }] : [], affected_entities: [],
      recovery: disposition === "confirmed" ? "none" : "lookup_original" } }, { status: disposition === "pending" ? 202 : 200 });
  return [
    http.post("/api/v1/actions", async ({ request }) => {
      const body = (await request.clone().json().catch(() => null)) as { operation_id?: string; kind?: string; subject?: unknown; payload?: { project_id?: string } } | null;
      if (!body?.kind?.startsWith("playbook.") || !body.operation_id) return undefined;
      const entry = seen.get(body.operation_id) ?? { subject: body.subject, project: body.payload?.project_id ?? "" };
      seen.set(body.operation_id, entry);
      return respond(body.operation_id, "pending", entry);
    }),
    http.get("/api/v1/operations/:id", ({ params }) => {
      const entry = seen.get(String(params.id));
      return entry ? respond(String(params.id), "confirmed", entry) : undefined;
    }),
  ];
}
