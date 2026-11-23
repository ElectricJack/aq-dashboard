import { http, HttpResponse } from "msw";

/**
 * Labelled fixtures for supervisor controls and manual-session launch choices, in the shapes of aq-server 09ee5e98
 * (`aq-supervisor-control` `list`/`control`, `aq-manual-sessions` `intelligence::choices`): one entry per level
 * candidate a logged-in harness can run. A selection is exactly `{profile_id, candidate_id}`; the mock refuses
 * anything else, as the server does.
 */
const DIGEST = "sha256:fixture-role-snapshot";
type FixtureChoice = { provider: string; model: string; reasoning: string; harness: string };
const choice = (level: string, name: string, { provider, model, reasoning, harness }: FixtureChoice) =>
  ({ snapshot_digest: DIGEST, profile_id: level, candidate_id: `${provider}:${model}:${reasoning}`, name, provider, model, reasoning, harness });
export const FIXTURE_LAUNCH_PROFILES = [
  choice("standard-low", "Fixture standard, low", { provider: "openai", model: "fixture-codex-model", reasoning: "low", harness: "codex" }),
  choice("standard-low", "Fixture standard, low", { provider: "anthropic", model: "fixture-model", reasoning: "low", harness: "claude" }),
  choice("standard-high", "Fixture standard, high", { provider: "openai", model: "fixture-codex-model", reasoning: "high", harness: "codex" }),
  choice("standard-high", "Fixture standard, high", { provider: "anthropic", model: "fixture-model-large", reasoning: "high", harness: "claude" }),
];
const GLOBAL = "e0000000-0000-4000-8000-0000000000a1", ACTOR = "e0000000-0000-4000-8000-0000000000a2";
const stored = ({ snapshot_digest: _digest, ...rest }: (typeof FIXTURE_LAUNCH_PROFILES)[number]) => rest;

function selectedProfile(selected: Record<string, unknown> | undefined) {
  return selected ? FIXTURE_LAUNCH_PROFILES.find(p => p.harness === "codex" && p.profile_id === selected.profile_id && p.candidate_id === selected.candidate_id) : undefined;
}

function unknownControlField(body: Record<string, unknown>, selected: Record<string, unknown> | undefined) {
  return Object.keys(body).some(k => !["operation_id", "expected_revision", "enabled", "intelligence_profile"].includes(k))
        || selected && Object.keys(selected).some(k => !["profile_id", "candidate_id"].includes(k));
}

const refused = (status: number, message: string) => HttpResponse.json({ error: "refused", message }, { status });
type ControlRequest = { id: string | readonly string[] | undefined; body: Record<string, unknown>; selected: Record<string, unknown> | undefined };
function checkControl({ id, body, selected }: ControlRequest, listed: boolean, control: Record<string, unknown>) {
  if (unknownControlField(body, selected)) return refused(422, "unknown field");
  if (!listed || id !== GLOBAL) return refused(404, "Supervisor not found");
  if (body.expected_revision !== control.revision) return refused(409, "Supervisor settings changed; refresh before retrying");
  return null;
}

function selectControlProfile(body: Record<string, unknown>, selected: Record<string, unknown> | undefined, control: Record<string, unknown>) {
  const found = selectedProfile(selected);
  if (selected && !found) return { error: refused(409, "Intelligence profile changed or is unavailable; select it again") };
  const profile = found ? stored(found) : control.profile;
  if (body.enabled && !profile) return { error: refused(400, "Choose a supervisor intelligence profile") };
  return { found, profile };
}

function updatedControl(control: Record<string, unknown>, body: Record<string, unknown>, profile: unknown, found: boolean) {
  const { unavailable_reason: _reason, ...rest } = control;
  return { ...(found ? rest : control), enabled: body.enabled, revision: Number(control.revision) + 1, profile };
}

function initialControl(waiting: boolean): Record<string, unknown> {
  const identity = { id: GLOBAL, actor_id: ACTOR, project_id: null, label: "Global supervisor", generation: null, session_id: null, last_error: null };
  if (!waiting) return { ...identity, enabled: false, revision: 0, profile: null, phase: "unavailable", stage: "Supervisor service is unavailable", observed_at_ms: null };
  return {
    ...identity, enabled: true, revision: 3,
    profile: { ...stored(FIXTURE_LAUNCH_PROFILES[0]!), model: "fixture-retired-model", candidate_id: "openai:fixture-retired-model:low" },
    unavailable_reason: "its level `standard-low` no longer lists fixture-retired-model on codex; choose a level",
    phase: "stopped", stage: "Stopped", observed_at_ms: Date.now(),
  };
}

/**
 * The default scenario lists the choices and no control, as before (pages that inject a conversation rely on that).
 * `?scenario=supervisor-stopped` adds a global control that has never run; `?scenario=supervisor-waiting` one that is
 * enabled and waiting because its level no longer lists its model.
 */
export function supervisorHandlers(name: string | null | undefined) {
  const waiting = name === "supervisor-waiting", listed = waiting || name === "supervisor-stopped";
  let control = initialControl(waiting);
  const receipts = new Map<string, Record<string, unknown>>();

  return [
    http.get("/api/supervisors", () => HttpResponse.json({ supervisors: listed ? [control] : [], profiles: FIXTURE_LAUNCH_PROFILES.filter(p => p.harness === "codex"), server_time_ms: Date.now() })),
    http.post("/api/supervisors/:id/control", async ({ request, params }) => {
      const body = await request.json() as Record<string, unknown>;
      const selected = body.intelligence_profile as Record<string, unknown> | undefined;
      const refusedControl = checkControl({ id: params.id, body, selected }, listed, control);
      if (refusedControl) return refusedControl;
      const change = selectControlProfile(body, selected, control);
      if ("error" in change) return change.error;
      const { found, profile } = change;
      control = updatedControl(control, body, profile, Boolean(found));
      const receipt = { operation_id: body.operation_id, conversation_id: GLOBAL, revision: control.revision, enabled: body.enabled, profile };
      receipts.set(String(body.operation_id), receipt);
      return HttpResponse.json(receipt);
    }),
    http.get("/api/supervisors/:id/operations/:operation", ({ params }) => receipts.has(String(params.operation)) ? HttpResponse.json(receipts.get(String(params.operation))) : refused(404, "Supervisor not found")),
    // No worker reports interactive support in the fixtures, so nothing can be launched; the choices are listed as the server lists them.
    http.get("/api/manual-agents", () => HttpResponse.json({ launch_profiles: FIXTURE_LAUNCH_PROFILES, sessions: [], workers: [], slots: [], projects: [], server_time_ms: Date.now() })),
  ];
}
