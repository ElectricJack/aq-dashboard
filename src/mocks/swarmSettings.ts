import { delay, http, HttpResponse } from "msw";
import type { SaveSwarmSettings, SwarmCellLimit, SwarmMode, SwarmSettings, SwarmProviderLimit, SwarmLimitOverride, UpdateSwarmLimits } from "../api/swarmSettings";

/** Labelled fixture settings; these are not observations of the connected system. */
export function swarmSettingsHandlers(scenario?: string | null) {
  const catalog = [
    { provider: "fixture-provider", intelligence_class: "fixture-standard", display_name: "Fixture standard" },
    { provider: "fixture-provider", intelligence_class: "fixture-advanced", display_name: "Fixture advanced" },
  ];
  if (scenario === "swarm-two-providers") catalog.push({ provider: "fixture-provider-two", intelligence_class: "fixture-standard-two", display_name: "Fixture second standard" });
  const operations = new Map<string, { request: string; response: SwarmSettings }>();
  let revision = 1;
  let activeMode: SwarmMode = "normal";
  let normal: SwarmCellLimit[] = catalog.map((c, i) => ({ provider: c.provider, intelligence_class: c.intelligence_class, limit: i ? 2 : 4 }));
  let reduced: SwarmCellLimit[] | null = catalog.map((c, i) => ({ provider: c.provider, intelligence_class: c.intelligence_class, limit: i ? 1 : 2 }));
  const providerLimits: SwarmProviderLimit[] = [];
  const cellLimits: SwarmLimitOverride[] = [];
  const result = (): SwarmSettings => ({ revision: String(revision), catalog_revision: "1", active_mode: activeMode, normal, reduced, unclassified: [], provider_limits: providerLimits, cell_limits: cellLimits,
    cells: catalog.map(c => {
      const find = (list: SwarmCellLimit[] | null) => list?.find(x => x.provider === c.provider && x.intelligence_class === c.intelligence_class)?.limit ?? null;
      const override = cellLimits.find(x => x.provider === c.provider && x.intelligence_class === c.intelligence_class);
      return { ...c, normal_limit: find(normal), reduced_limit: find(reduced), effective_limit: override ? override.limit : find(activeMode === "normal" ? normal : reduced), running: null, waiting: null };
    }),
  });
  const fail = (status: number, message: string) => HttpResponse.json({ error: "swarm_settings", message }, { status });
  const valid = (value: unknown): value is SwarmCellLimit[] => Array.isArray(value) && value.length === catalog.length && catalog.every(c => value.filter(x => x && x.provider === c.provider && x.intelligence_class === c.intelligence_class && Number.isSafeInteger(x.limit) && x.limit >= 0).length === 1);
  return [
    http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "1", active_digest: "a".repeat(64), profiles: catalog.map(c => ({ id: c.intelligence_class, version: 1, name: c.display_name, description: "Labelled fixture profile", candidates: [{ id: c.intelligence_class, provider: c.provider, model: "fixture-model", reasoning_configuration_reference: "fixture-balanced@1", harnesses: ["fixture-harness"] }], projects: [] })), model_choices: [{ provider: "fixture-provider", model: "fixture-model", reasoning_configuration_reference: "fixture-balanced@1", reasoning: "Fixture balanced", harness: "fixture-harness" }] })),
    http.get("/api/settings/swarm", () => HttpResponse.json(result())),
    http.get("/api/settings/swarm/operations/:id", ({ params }) => {
      const entry = operations.get(String(params.id));
      return entry ? HttpResponse.json(entry.response) : fail(404, "Operation not found.");
    }),
    http.post("/api/settings/swarm", async ({ request }) => {
      if (scenario === "swarm-settings-pending") await delay(3000);
      if (scenario === "swarm-settings-conflict") return fail(409, "Settings changed; reload and try again.");
      if (scenario === "swarm-settings-error") return fail(503, "Fixture service unavailable.");
      const body = await request.json().catch(() => null) as SaveSwarmSettings | null;
      if (!body || typeof body.operation_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operation_id)) return fail(400, "Invalid operation ID.");
      const previous = operations.get(body.operation_id), serialized = JSON.stringify(["save", body]);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
      if (body.expected_revision !== String(revision) || body.expected_catalog_revision !== "1") return fail(409, "Settings or catalog changed; reload and try again.");
      if (!valid(body.normal) || (body.reduced !== null && !valid(body.reduced)) || (activeMode === "reduced" && body.reduced === null) || body.reduced?.some(r => r.limit > body.normal.find(n => n.provider === r.provider && n.intelligence_class === r.intelligence_class)!.limit)) return fail(400, "Invalid settings matrix.");
      normal = body.normal; reduced = body.reduced; revision++;
      const response = structuredClone(result()); operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
    http.post("/api/settings/swarm/limits", async ({ request }) => {
      if (scenario === "swarm-settings-pending") await delay(3000);
      if (scenario === "swarm-settings-conflict") return fail(409, "Settings changed; reload and try again.");
      if (scenario === "swarm-settings-error") return fail(503, "Fixture service unavailable.");
      const body = await request.json() as UpdateSwarmLimits;
      const previous = operations.get(body.operation_id), serialized = JSON.stringify(["limits", body]);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
      if (body.expected_revision !== String(revision) || body.expected_catalog_revision !== "1") return fail(409, "Settings or catalog changed; reload and try again.");
      if (!body.provider && !body.cell) return fail(400, "Choose a limit.");
      for (const item of [body.provider, body.cell].filter(Boolean)) {
        if (item!.limit !== null && (!Number.isInteger(item!.limit) || item!.limit! < 0 || item!.limit! > 4294967295)) return fail(400, "Invalid limit.");
        if (!catalog.some(c => c.provider === item!.provider)) return fail(400, "Unknown provider.");
      }
      if (body.provider) {
        const index = providerLimits.findIndex(x => x.provider === body.provider!.provider);
        if (index >= 0) providerLimits[index] = body.provider; else providerLimits.push(body.provider);
      }
      if (body.cell) {
        if (!catalog.some(c => c.provider === body.cell!.provider && c.intelligence_class === body.cell!.intelligence_class)) return fail(400, "Unknown class.");
        const index = cellLimits.findIndex(x => x.provider === body.cell!.provider && x.intelligence_class === body.cell!.intelligence_class);
        if (index >= 0) cellLimits[index] = body.cell; else cellLimits.push(body.cell);
      }
      revision++;
      const response = structuredClone(result()); operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
    http.post("/api/settings/swarm/mode", async ({ request }) => {
      if (scenario === "swarm-settings-pending") await delay(3000);
      if (scenario === "swarm-settings-conflict") return fail(409, "Settings changed; reload and try again.");
      if (scenario === "swarm-settings-error") return fail(503, "Fixture service unavailable.");
      const body = await request.json().catch(() => null) as { operation_id?: string; expected_revision?: string; active_mode?: SwarmMode } | null;
      if (!body || typeof body.operation_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.operation_id)) return fail(400, "Invalid operation ID.");
      const previous = operations.get(body.operation_id), serialized = JSON.stringify(["mode", body]);
      if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
      if (body.expected_revision !== String(revision)) return fail(409, "Settings changed; reload and try again.");
      if ((body.active_mode !== "normal" && body.active_mode !== "reduced") || (body.active_mode === "reduced" && reduced === null)) return fail(400, "Invalid mode.");
      activeMode = body.active_mode; revision++;
      const response = structuredClone(result()); operations.set(body.operation_id, { request: serialized, response });
      return HttpResponse.json(response);
    }),
  ];
}
