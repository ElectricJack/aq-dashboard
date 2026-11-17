import { http, HttpResponse } from "msw";
import type { ActivePlaybook, LatestRun, PlaybookChange, SourceView } from "../api/playbookSources";
import { ROUTING_SOURCE_ID } from "../api/routing";

/** The source view as the server serializes it (`aq-playbook-authoring/src/view.rs`): a single-line sentence has no `end_line`, and `unable` is one object. */
type WireRun = Omit<LatestRun, "question" | "unable"> & {
  question: { question: string; sentences: { line: number; end_line?: number; text: string }[] } | null;
  unable: { reason: string; sentence: string; line: number } | { reason: string; sentence: string; host_fault: true } | null;
};
type WireActive = Omit<ActivePlaybook, "previous"> & { previous: { since_ms: number } | null };
type WireSource = Omit<SourceView, "active" | "latest"> & { active: WireActive | null; latest: WireRun | null };

/** The routing document as the server serves it (`/api/settings/routing-document`, aq-role-settings): the text and its revision. */
type Snapshot = { markdown: string; revision: string };
/** A save, and its receipt. The fixture's digest is a constant: saving the document compiles nothing. */
type Save = { markdown: string; expected_revision: string; operation_id: string };
type Receipt = { revision: string; digest: string };
const FIXTURE_DIGEST = `sha256:${"a".repeat(64)}`;

const initial = (): Snapshot => ({ revision: "1", markdown: "# Intelligence routing\n\nChoose the appropriate intelligence level for each task." });

/** How long a labelled fixture authoring run takes. */
const RUN_MS = 800;
const FIXTURE_CASES: ActivePlaybook["cases"] = [
  { name: "bug-fix-first-try", situation: "Fixture: a bug fix on its first attempt", result: "class: standard\neffort: high", passed: true },
  { name: "bug-fix-failed-once", situation: "Fixture: a bug fix that failed once", result: "class: complex\neffort: high\nharness: Claude or Codex", passed: true },
  { name: "docs", situation: "Fixture: a documentation fix", result: "class: simple\neffort: low", passed: true },
  { name: "research", situation: "Fixture: research that is not clearly harder than usual", result: "class: standard\neffort: high", passed: true },
  { name: "high-risk", situation: "Fixture: very high risk work, not covered by a test", result: "class: complex\neffort: high", passed: true },
  { name: "high-risk-covered", situation: "Fixture: very high risk work that is narrow and covered by a test", result: "class: standard\neffort: high", passed: true },
];
const DAY_MS = 86_400_000;
/** Forty labelled cases with four distinct results: the most the server sends, and enough to be grouped. */
const MANY_CASES: ActivePlaybook["cases"] = Array.from({ length: 40 }, (_, i) => ({
  name: `case-${i}`, situation: `Fixture: situation ${i + 1}, a ${["bug fix", "documentation fix", "research task", "risky change"][i % 4]} that arrives ${i % 3 === 0 ? "for the first time" : "after a failure"}`,
  result: ["class: simple\neffort: low", "class: standard\neffort: high", "class: complex\neffort: high\nharness: Claude or Codex", "class: deep\neffort: max"][i % 4]!, passed: i !== 5,
}));
/** With a change there is a previous playbook: the comparison is an object and a rollback is offered. */
const fixtureActive = (at: number, change: PlaybookChange | null, cases = FIXTURE_CASES, artifact = `sha256:${"f".repeat(64)}`): WireActive => ({
  artifact, since_ms: at, comparison: change ? { change } : null, can_rollback: change !== null,
  previous: change ? { since_ms: at - DAY_MS } : null, cases,
});
let runs = 0;
/** `elapsed_ms` is filled when the view is served, against the clock, as the server does. */
const fixtureRun = (status: LatestRun["status"], at: number, extra: Partial<WireRun> = {}): WireRun => ({
  run: String(++runs), status, question: null, unable: null, refusal: null, internal_task_id: null, created_at_ms: at, finished_at_ms: status === "running" ? null : at + RUN_MS, elapsed_ms: 0, ...extra,
});
const FIXTURE_QUESTION = { question: "Fixture: These two sentences ask for opposite things for research that is only a little harder than usual. Which one wins?", sentences: [
  { line: 3, text: "Fixture: Research is Standard, high effort, unless it is clearly harder." },
  { line: 9, end_line: 10, text: "Fixture: Research is always Complex,\nwhatever else is said." },
] };
const at0 = Date.UTC(2026, 10, 12, 9, 0, 0);
/** Labelled fixture sources by scenario (`running`, `saved`, `question`, `unable` and `refused` each stand for one state the owner can see); with none, nothing has been authored yet. */
function initialSource(scenario?: string | null): WireSource {
  const base = { id: ROUTING_SOURCE_ID, kind: "builtin", binding: "aq.routing", purpose: "Fixture: choose the intelligence level for each task", revision: 1 };
  const now = Date.now();
  switch (scenario) {
    case "playbook-running": return { ...base, active: null, latest: fixtureRun("running", now - 95_000) };
    case "playbook-saved": return { ...base, active: fixtureActive(at0, "behaviour"), latest: fixtureRun("saved", at0 - RUN_MS) };
    case "playbook-many": return { ...base, active: fixtureActive(at0, "behaviour", MANY_CASES), latest: fixtureRun("saved", at0 - RUN_MS) };
    case "playbook-question": return { ...base, active: fixtureActive(at0, "wording"), latest: fixtureRun("question", at0, { question: FIXTURE_QUESTION }) };
    case "playbook-unable": return { ...base, active: null, latest: fixtureRun("unable", at0, { unable: { reason: "Fixture: There is no plotter among the abilities this playbook can use.", line: 12, sentence: "Fixture: Art and visual design go to the plotter." } }) };
    case "playbook-failed": return { ...base, active: null, latest: fixtureRun("failed", at0, { refusal: "Fixture: The agent ran out of time before it finished. Author again, or make the document shorter." }) };
    case "playbook-refused": return { ...base, active: fixtureActive(at0, "none"), latest: fixtureRun("refused", at0, { refusal: "Fixture: The document asks to send task text to an outside address, which routing may not do." }) };
    default: return { ...base, active: null, latest: null };
  }
}

/** Isolated fixture state survives a page reload in the same browser tab. */
export function routingDocumentHandlers(scenario?: string | null) {
  const key = "aq-mock-routing-document";
  let snapshot: Snapshot = (() => {
    try { return JSON.parse(sessionStorage.getItem(key) || "null") || initial(); } catch { return initial(); }
  })();
  const operations = new Map<string, { request: string; response: Receipt }>();
  const fail = (status: number, message: string) => HttpResponse.json({ error: status === 409 ? "conflict" : status === 404 ? "not_found" : "bad_request", message }, { status });
  let source: WireSource = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-source`) || "null") || initialSource(scenario); } catch { return initialSource(scenario); } })();
  let enabled: boolean = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-enabled`) || "false") === true; } catch { return false; } })();
  /** The playbook that was in effect before the newest one, kept so a rollback can put it back. */
  let previous: WireActive | null = (() => { try { return JSON.parse(sessionStorage.getItem(`${key}-previous`) || "null"); } catch { return null; } })();
  const keepSource = () => { sessionStorage.setItem(`${key}-source`, JSON.stringify(source)); sessionStorage.setItem(`${key}-enabled`, JSON.stringify(enabled)); sessionStorage.setItem(`${key}-previous`, JSON.stringify(previous)); };
  /** A fixture run finishes `RUN_MS` after it started and saves a playbook. */
  const settle = () => {
    const latest = source.latest, now = Date.now();
    if (latest?.status !== "running" || now - latest.created_at_ms < RUN_MS || scenario === "playbook-running") return;
    previous = source.active;
    source = { ...source, active: fixtureActive(now, source.active ? "behaviour" : null), latest: { ...latest, status: "saved", finished_at_ms: now } };
    changed = false;
    keepSource();
  };
  /** Whether the document was saved since the playbook in effect was written: only then does "author again" start a run. */
  let changed = false;
  const view = (): WireSource => source.latest ? { ...source, latest: { ...source.latest, elapsed_ms: Math.max(0, (source.latest.finished_at_ms ?? Date.now()) - source.latest.created_at_ms) } } : source;
  const routingView = () => { settle(); return { enabled, source: view() }; };
  return [
    http.get("/api/settings/routing-document", () => HttpResponse.json(snapshot)),
    http.get("/api/settings/routing", () => HttpResponse.json(routingView())),
    http.post("/api/settings/routing", async ({ request }) => {
      const body = await request.json().catch(() => null) as { enabled?: unknown } | null;
      if (!body || typeof body.enabled !== "boolean") return fail(400, "Invalid routing switch.");
      settle();
      if (body.enabled && !source.active) return fail(409, "Routing can be turned on once a routing playbook is active");
      enabled = body.enabled;
      keepSource();
      return HttpResponse.json(routingView());
    }),
    http.get("/api/playbooks/sources", () => { settle(); return HttpResponse.json({ items: [view()] }); }),
    http.get("/api/playbooks/sources/:id", ({ params }) => { settle(); return params.id === ROUTING_SOURCE_ID ? HttpResponse.json(view()) : fail(404, `There is no playbook source ${String(params.id)}`); }),
    http.post("/api/playbooks/sources/:id/rollback", ({ params }) => {
      settle();
      if (params.id !== ROUTING_SOURCE_ID || !source.active?.can_rollback) return fail(409, "There is no earlier playbook to go back to.");
      source = { ...source, active: { ...(previous ?? fixtureActive(source.active.since_ms - DAY_MS, null)), comparison: null, can_rollback: false, previous: null } };
      previous = null;
      keepSource();
      return HttpResponse.json(view());
    }),
    http.post("/api/playbooks/sources/:id/runs", ({ params }) => {
      if (params.id !== ROUTING_SOURCE_ID) return fail(404, `There is no playbook source ${String(params.id)}`);
      settle();
      // As the server: nothing starts while a run is going, or when the document is the one the playbook in effect was written from.
      if (source.latest?.status !== "running" && (changed || !source.active || source.latest?.status !== "saved")) {
        source = { ...source, latest: fixtureRun("running", Date.now()) };
        keepSource();
      }
      return HttpResponse.json(view());
    }),
    http.delete("/api/playbooks/sources/:id", () => fail(409, "The routing source cannot be deleted.")),
    // As the server: the same operation again answers as the first time; its id with another save is a conflict.
    http.put("/api/settings/routing-document", async ({ request }) => {
      const body = await request.json().catch(() => null) as Save | null;
      if (!body || typeof body.operation_id !== "string" || typeof body.markdown !== "string" || typeof body.expected_revision !== "string" || Object.keys(body).length !== 3) return fail(400, "Invalid settings request");
      const serialized = JSON.stringify(body), earlier = operations.get(body.operation_id);
      if (earlier) return earlier.request === serialized ? HttpResponse.json(earlier.response) : fail(409, "The operation id was used for another change");
      if (body.expected_revision !== snapshot.revision) return fail(409, "The settings changed; reload and try again");
      const compile = body.markdown !== snapshot.markdown;
      snapshot = { revision: String(Number(snapshot.revision) + 1), markdown: body.markdown };
      sessionStorage.setItem(key, JSON.stringify(snapshot));
      // An authoring run follows a changed document; a newer save replaces a run still in flight.
      if (compile) {
        changed = true;
        source = { ...source, revision: source.revision + 1, latest: fixtureRun("running", Date.now()) };
        keepSource();
      }
      const response = { revision: snapshot.revision, digest: FIXTURE_DIGEST };
      operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
