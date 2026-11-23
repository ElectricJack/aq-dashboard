import { delay, http, HttpResponse } from "msw";
import type { SaveSwarmSettings, SetSwarmMode, SwarmCellLimit, SwarmMode, SwarmSettings, SwarmProviderLimit, SwarmLimitOverride, UpdateSwarmLimits } from "../api/swarmSettings";

type CellKey = Pick<SwarmCellLimit, "provider" | "intelligence_class">;
type ProviderKey = Pick<SwarmProviderLimit, "provider">;
const sameProvider = (a: ProviderKey, b: ProviderKey) => a.provider === b.provider;
const sameCell = (a: CellKey, b: CellKey) => sameProvider(a, b) && a.intelligence_class === b.intelligence_class;
const fail = (status: number, message: string) => HttpResponse.json({ error: "swarm_settings", message }, { status });
const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function catalogFor(scenario?: string | null) {
  const catalog = [
    { provider: "fixture-provider", intelligence_class: "fixture-standard", display_name: "Fixture standard" },
    { provider: "fixture-provider", intelligence_class: "fixture-advanced", display_name: "Fixture advanced" },
  ];
  // `level-limits`: the swarm also lists the labelled fixture levels of Settings → Intelligence (src/mocks/roleSettings.ts), so their Max agents can be set.
  if (scenario === "level-limits") catalog.push({ provider: "fixture-provider", intelligence_class: "standard-low", display_name: "Fixture standard, low" },
    { provider: "fixture-provider", intelligence_class: "standard-high", display_name: "Fixture standard, high" }, { provider: "anthropic", intelligence_class: "standard-high", display_name: "Fixture standard, high" });
  if (scenario === "swarm-two-providers") catalog.push({ provider: "fixture-provider-two", intelligence_class: "fixture-standard-two", display_name: "Fixture second standard" });
  return catalog;
}

function matrixMatches(rows: unknown, catalog: CellKey[]): rows is SwarmCellLimit[] {
  if (!Array.isArray(rows) || rows.length !== catalog.length) return false;
  const valid = rows.filter(row => row && Number.isSafeInteger(row.limit) && row.limit >= 0);
  return catalog.every(cell => valid.filter(row => sameCell(row, cell)).length === 1);
}

function validMatrix(body: SaveSwarmSettings, catalog: CellKey[], mode: SwarmMode) {
  if (!matrixMatches(body.normal, catalog)) return false;
  if (body.reduced === null) return mode !== "reduced";
  if (!matrixMatches(body.reduced, catalog)) return false;
  return body.reduced.every(row => row.limit <= body.normal.find(normal => sameCell(normal, row))!.limit);
}

function limitError(body: UpdateSwarmLimits, catalog: CellKey[]) {
  if (!body.provider && !body.cell) return "Choose a limit.";
  for (const item of [body.provider, body.cell].filter((value): value is SwarmProviderLimit => !!value)) {
    if (!validLimit(item.limit)) return "Invalid limit.";
    if (!catalog.some(cell => sameProvider(cell, item))) return "Unknown provider.";
  }
  const cell = body.cell;
  if (cell && !catalog.some(known => sameCell(known, cell))) return "Unknown class.";
  return null;
}

function validLimit(value: number | null) {
  if (value === null) return true;
  return Number.isInteger(value) && value >= 0 && value <= 4294967295;
}

function updateItem<T>(items: T[], next: T, matches: (a: T, b: T) => boolean) {
  const index = items.findIndex(item => matches(item, next));
  if (index < 0) items.push(next);
  else items[index] = next;
}

type Operation = { operation_id: string; expected_revision: string };

/** Labelled fixture settings; these are not observations of the connected system. */
export function swarmSettingsHandlers(scenario?: string | null) {
  const catalog = catalogFor(scenario);
  const storageKey = `aq-mock-swarm-settings:${scenario ?? "default"}`;
  const operations = new Map<string, { request: string; response: SwarmSettings }>();
  let revision = 1;
  let activeMode: SwarmMode = "normal";
  let normal: SwarmCellLimit[] = catalog.map((c, i) => ({ provider: c.provider, intelligence_class: c.intelligence_class, limit: i ? 2 : 4 }));
  let reduced: SwarmCellLimit[] | null = catalog.map((c, i) => ({ provider: c.provider, intelligence_class: c.intelligence_class, limit: i ? 1 : 2 }));
  const providerLimits: SwarmProviderLimit[] = [];
  const cellLimits: SwarmLimitOverride[] = [];
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as SwarmSettings | null;
    if (saved) {
      revision = Number(saved.revision); activeMode = saved.active_mode; normal = saved.normal ?? normal; reduced = saved.reduced;
      providerLimits.push(...(saved.provider_limits ?? [])); cellLimits.push(...(saved.cell_limits ?? []));
    }
  } catch { /* Fresh labelled fixture state. */ }
  const result = (): SwarmSettings => ({ revision: String(revision), active_mode: activeMode, normal, reduced, unclassified: [], provider_limits: providerLimits, cell_limits: cellLimits,
    cells: catalog.map(c => {
      const find = (list: SwarmCellLimit[] | null) => list?.find(x => sameCell(x, c))?.limit ?? null;
      const override = cellLimits.find(x => sameCell(x, c));
      return { ...c, normal_limit: find(normal), reduced_limit: find(reduced), effective_limit: override ? override.limit : find(activeMode === "normal" ? normal : reduced), running: null, waiting: null };
    }),
  });
  async function unavailable() {
    if (scenario === "swarm-settings-pending") await delay(3000);
    if (scenario === "swarm-settings-conflict") return fail(409, "Settings changed; reload and try again.");
    if (scenario === "swarm-settings-error") return fail(503, "Fixture service unavailable.");
  }

  function apply<T extends Operation>(kind: string, body: T, update: (body: T) => string | null) {
    const previous = operations.get(body.operation_id);
    const serialized = JSON.stringify([kind, body]);
    if (previous) return previous.request === serialized ? HttpResponse.json(previous.response) : fail(409, "Operation ID already used.");
    if (body.expected_revision !== String(revision)) return fail(409, "Settings changed; reload and try again.");
    const error = update(body);
    if (error) return fail(400, error);
    revision++;
    const response = structuredClone(result());
    operations.set(body.operation_id, { request: serialized, response });
    sessionStorage.setItem(storageKey, JSON.stringify(response));
    return HttpResponse.json(response);
  }

  function post<T extends Operation>(path: string, kind: string, update: (body: T) => string | null) {
    return http.post(path, async ({ request }) => {
      const failure = await unavailable();
      if (failure) return failure;
      if (kind === "limits") return apply(kind, await request.json() as T, update);
      const body = await request.json().catch(() => null) as T | null;
      if (!body || typeof body.operation_id !== "string") return fail(400, "Invalid operation ID.");
      if (!OPERATION_ID.test(body.operation_id)) return fail(400, "Invalid operation ID.");
      return apply(kind, body, update);
    });
  }

  return [
    http.get("/api/settings/swarm", () => HttpResponse.json(result())),
    http.get("/api/settings/swarm/operations/:id", ({ params }) => {
      const entry = operations.get(String(params.id));
      return entry ? HttpResponse.json(entry.response) : fail(404, "Operation not found.");
    }),
    post("/api/settings/swarm", "save", (body: SaveSwarmSettings) => {
      if (!validMatrix(body, catalog, activeMode)) return "Invalid settings matrix.";
      normal = body.normal;
      reduced = body.reduced;
      return null;
    }),
    post("/api/settings/swarm/limits", "limits", (body: UpdateSwarmLimits) => {
      const error = limitError(body, catalog);
      if (error) return error;
      if (body.provider) updateItem(providerLimits, body.provider, sameProvider);
      if (body.cell) updateItem(cellLimits, body.cell, sameCell);
      return null;
    }),
    post("/api/settings/swarm/mode", "mode", ({ active_mode }: SetSwarmMode) => {
      if (active_mode !== "normal" && active_mode !== "reduced") return "Invalid mode.";
      if (active_mode === "reduced" && reduced === null) return "Invalid mode.";
      activeMode = active_mode;
      return null;
    }),
  ];
}
