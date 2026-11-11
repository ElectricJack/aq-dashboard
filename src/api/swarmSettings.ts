import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession, PANEL_READ } from "../app/session";
import { ContractError, isRecord } from "./adapters/contract";
import { apiGet, apiSend, ApiError } from "./client";
import { queryKey } from "./queryKeys";
import { pollUnlessSettled } from "./retry";

export type SwarmMode = "normal" | "reduced";
export type SwarmCellLimit = { provider: string; intelligence_class: string; limit: number };
export type SwarmCell = { provider: string; intelligence_class: string; display_name: string; normal_limit: number | null; reduced_limit: number | null; effective_limit: number | null; running: number | null; waiting: number | null };
export type SwarmUnclassified = { provider: string; running: number; waiting: number };
export type SwarmSettings = { unclassified: SwarmUnclassified[]; revision: string; catalog_revision: string; active_mode: SwarmMode; normal: SwarmCellLimit[] | null; reduced: SwarmCellLimit[] | null; cells: SwarmCell[] };
export type SaveSwarmSettings = { operation_id: string; expected_revision: string; expected_catalog_revision: string; normal: SwarmCellLimit[]; reduced: SwarmCellLimit[] | null };
export type SetSwarmMode = { operation_id: string; expected_revision: string; active_mode: SwarmMode };
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 512;
const revision = (v: unknown): v is string => typeof v === "string" && v.length <= 128 && /^(0|[1-9]\d*)$/.test(v);
const uint = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const nullableUint = (v: unknown): v is number | null => v === null || uint(v);
const mode = (v: unknown): v is SwarmMode => v === "normal" || v === "reduced";
function ensure(condition: unknown): asserts condition { if (!condition) throw new ContractError("Invalid swarm settings response"); }
function limits(v: unknown): SwarmCellLimit[] | null {
  if (v === null) return null;
  ensure(Array.isArray(v) && v.length <= 4096);
  const seen = new Set<string>();
  return v.map((x: unknown) => {
    ensure(isRecord(x) && text(x.provider) && text(x.intelligence_class) && uint(x.limit));
    const key = JSON.stringify([x.provider, x.intelligence_class]); ensure(!seen.has(key)); seen.add(key);
    return { provider: x.provider, intelligence_class: x.intelligence_class, limit: x.limit };
  });
}
export function adaptSwarmSettings(v: unknown): SwarmSettings {
  ensure(isRecord(v) && revision(v.revision) && revision(v.catalog_revision) && mode(v.active_mode) && Array.isArray(v.cells) && v.cells.length <= 4096 && Array.isArray(v.unclassified) && v.unclassified.length <= 4096);
  const normal = limits(v.normal), reduced = limits(v.reduced);
  const seen = new Set<string>();
  const cells = v.cells.map((x: unknown): SwarmCell => {
    ensure(isRecord(x) && text(x.provider) && text(x.intelligence_class) && text(x.display_name) && nullableUint(x.normal_limit) && nullableUint(x.reduced_limit) && nullableUint(x.effective_limit) && nullableUint(x.running) && nullableUint(x.waiting));
    const key = JSON.stringify([x.provider, x.intelligence_class]); ensure(!seen.has(key)); seen.add(key);
    return { provider: x.provider, intelligence_class: x.intelligence_class, display_name: x.display_name, normal_limit: x.normal_limit, reduced_limit: x.reduced_limit, effective_limit: x.effective_limit, running: x.running, waiting: x.waiting };
  });
  const providers = new Set<string>();
  const unclassified = v.unclassified.map((x: unknown): SwarmUnclassified => {
    ensure(isRecord(x) && text(x.provider) && uint(x.running) && uint(x.waiting) && !providers.has(x.provider));
    providers.add(x.provider);
    return { provider: x.provider, running: x.running, waiting: x.waiting };
  });
  // Matrices can contain pairs removed from the current catalog; cells represent
  // only the current catalog and may have null limits after catalog drift.
  ensure(v.active_mode !== "reduced" || reduced !== null);
  const asMap = (items: SwarmCellLimit[] | null) => new Map(items?.map(x => [JSON.stringify([x.provider, x.intelligence_class]), x.limit]) ?? []);
  const normalByCell = asMap(normal), reducedByCell = asMap(reduced);
  for (const [key, limit] of reducedByCell) {
    const normalLimit = normalByCell.get(key);
    ensure(normalLimit === undefined || limit <= normalLimit);
  }
  for (const cell of cells) {
    const key = JSON.stringify([cell.provider, cell.intelligence_class]);
    const normalLimit = normalByCell.get(key) ?? null, reducedLimit = reducedByCell.get(key) ?? null;
    ensure(cell.normal_limit === normalLimit && cell.reduced_limit === reducedLimit && cell.effective_limit === (v.active_mode === "normal" ? normalLimit : reducedLimit));
  }
  return { revision: v.revision, catalog_revision: v.catalog_revision, active_mode: v.active_mode, normal, reduced, cells, unclassified };
}
export async function readSwarmSettings(signal?: AbortSignal) { return adaptSwarmSettings(await apiGet<unknown>("/api/settings/swarm", signal)); }
export async function saveSwarmSettings(request: SaveSwarmSettings) { return adaptSwarmSettings(await apiSend<unknown>("POST", "/api/settings/swarm", request)); }
export async function setSwarmMode(request: SetSwarmMode) { return adaptSwarmSettings(await apiSend<unknown>("POST", "/api/settings/swarm/mode", request)); }
export async function inspectSwarmOperation(id: string) { return adaptSwarmSettings(await apiGet<unknown>(`/api/settings/swarm/operations/${encodeURIComponent(id)}`)); }
export function useSwarmSettings(enabled = true) {
  const { queryContext } = useSession();
  return useQuery({ queryKey: queryKey(queryContext, "swarm-settings", {}), queryFn: ({ signal }) => readSwarmSettings(signal), enabled, retry: false, refetchInterval: pollUnlessSettled(10_000), meta: PANEL_READ });
}
function useSwarmMutation<T>(mutationFn: (request: T) => Promise<SwarmSettings>) {
  const { queryContext, reportAccessDenied } = useSession();
  const client = useQueryClient(), key = queryKey(queryContext, "swarm-settings", {});
  return useMutation({ mutationFn, retry: false,
    onSuccess: data => {
      client.setQueryData<SwarmSettings>(key, old => !old || BigInt(data.revision) >= BigInt(old.revision) ? data : old);
    },
    onError: error => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) reportAccessDenied(error);
    },
    onSettled: () => { void client.invalidateQueries({ queryKey: key }); },
  });
}
export function useSaveSwarmSettings() { return useSwarmMutation(saveSwarmSettings); }
export function useSetSwarmMode() { return useSwarmMutation(setSwarmMode); }
