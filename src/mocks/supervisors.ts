import { http, HttpResponse } from "msw";

/**
 * Labelled fixtures for supervisor controls and manual-session launch choices, in the shapes of aq-server 09ee5e98
 * (`aq-supervisor-control` `list`/`control`, `aq-manual-sessions` `intelligence::choices`): one entry per level
 * candidate a logged-in harness can run. A selection is exactly `{profile_id, candidate_id}`; the mock refuses
 * anything else, as the server does.
 */
const DIGEST = "sha256:fixture-role-snapshot";
const choice = (level: string, name: string, provider: string, model: string, reasoning: string, harness: string) =>
  ({ snapshot_digest: DIGEST, profile_id: level, candidate_id: `${provider}:${model}:${reasoning}`, name, provider, model, reasoning, harness });
export const FIXTURE_LAUNCH_PROFILES = [
  choice("standard-low", "Fixture standard, low", "openai", "fixture-codex-model", "low", "codex"),
  choice("standard-low", "Fixture standard, low", "anthropic", "fixture-model", "low", "claude"),
  choice("standard-high", "Fixture standard, high", "openai", "fixture-codex-model", "high", "codex"),
  choice("standard-high", "Fixture standard, high", "anthropic", "fixture-model-large", "high", "claude"),
];
const GLOBAL = "e0000000-0000-4000-8000-0000000000a1", ACTOR = "e0000000-0000-4000-8000-0000000000a2";
const stored = ({ snapshot_digest: _digest, ...rest }: (typeof FIXTURE_LAUNCH_PROFILES)[number]) => rest;

/**
 * The default scenario lists the choices and no control, as before (pages that inject a conversation rely on that).
 * `?scenario=supervisor-stopped` adds a global control that has never run; `?scenario=supervisor-waiting` one that is
 * enabled and waiting because its level no longer lists its model.
 */
export function supervisorHandlers(name: string | null | undefined) {
  const waiting = name === "supervisor-waiting", listed = waiting || name === "supervisor-stopped";
  let control: Record<string, unknown> = {
    id: GLOBAL, actor_id: ACTOR, project_id: null, label: "Global supervisor", enabled: waiting, revision: waiting ? 3 : 0,
    profile: waiting ? { ...stored(FIXTURE_LAUNCH_PROFILES[0]!), model: "fixture-retired-model", candidate_id: "openai:fixture-retired-model:low" } : null,
    ...(waiting ? { unavailable_reason: "its level `standard-low` no longer lists fixture-retired-model on codex; choose a level" } : {}),
    phase: waiting ? "stopped" : "unavailable", stage: waiting ? "Stopped" : "Supervisor service is unavailable",
    observed_at_ms: waiting ? Date.now() : null, generation: null, session_id: null, last_error: null,
  };
  const receipts = new Map<string, Record<string, unknown>>();
  const refused = (status: number, message: string) => HttpResponse.json({ error: "refused", message }, { status });
  return [
    http.get("/api/supervisors", () => HttpResponse.json({ supervisors: listed ? [control] : [], profiles: FIXTURE_LAUNCH_PROFILES.filter(p => p.harness === "codex"), server_time_ms: Date.now() })),
    http.post("/api/supervisors/:id/control", async ({ request, params }) => {
      const body = await request.json() as Record<string, unknown>;
      const selected = body.intelligence_profile as Record<string, unknown> | undefined;
      if (Object.keys(body).some(k => !["operation_id", "expected_revision", "enabled", "intelligence_profile"].includes(k))
        || selected && Object.keys(selected).some(k => !["profile_id", "candidate_id"].includes(k))) return refused(422, "unknown field");
      if (!listed || params.id !== GLOBAL) return refused(404, "Supervisor not found");
      if (body.expected_revision !== control.revision) return refused(409, "Supervisor settings changed; refresh before retrying");
      const found = selected ? FIXTURE_LAUNCH_PROFILES.find(p => p.harness === "codex" && p.profile_id === selected.profile_id && p.candidate_id === selected.candidate_id) : undefined;
      if (selected && !found) return refused(409, "Intelligence profile changed or is unavailable; select it again");
      const profile = found ? stored(found) : control.profile;
      if (body.enabled && !profile) return refused(400, "Choose a supervisor intelligence profile");
      const { unavailable_reason: _reason, ...rest } = control;
      control = { ...(found ? rest : control), enabled: body.enabled, revision: Number(control.revision) + 1, profile };
      const receipt = { operation_id: body.operation_id, conversation_id: GLOBAL, revision: control.revision, enabled: body.enabled, profile };
      receipts.set(String(body.operation_id), receipt);
      return HttpResponse.json(receipt);
    }),
    http.get("/api/supervisors/:id/operations/:operation", ({ params }) => receipts.has(String(params.operation)) ? HttpResponse.json(receipts.get(String(params.operation))) : refused(404, "Supervisor not found")),
    // No worker reports interactive support in the fixtures, so nothing can be launched; the choices are listed as the server lists them.
    http.get("/api/manual-agents", () => HttpResponse.json({ launch_profiles: FIXTURE_LAUNCH_PROFILES, sessions: [], workers: [], slots: [], projects: [], server_time_ms: Date.now() })),
  ];
}
