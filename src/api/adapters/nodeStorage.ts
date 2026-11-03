import { ContractError } from "./contract";

/**
 * SBX25 node storage facts (aq-server architecture 0005, storage budget amendment).
 * Every field is optional on the wire; an absent field stays null and is shown as
 * "Not reported", never as zero.
 */
export type NodeStorage = {
  total_bytes: number | null;
  used_bytes: number | null;
  free_bytes: number | null;
  reserved_bytes: number | null;
  preserved_count: number | null;
  preserved_bytes: number | null;
};

export type StorageLevel = "normal" | "warning" | "refusal" | "unknown";

/** Usage at which the server opens a `storage.pressure` episode. */
export const STORAGE_WARNING_PERCENT = 80;
/** Usage at which placement refuses with `node_disk_pressure`. */
export const STORAGE_REFUSAL_PERCENT = 85;

const FIELDS = {
  total_bytes: "disk_total_bytes",
  used_bytes: "disk_used_bytes",
  free_bytes: "disk_free_bytes",
  reserved_bytes: "disk_reserved_bytes",
  preserved_count: "preserved_count",
  preserved_bytes: "preserved_bytes",
} as const;

function optionalCount(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new ContractError(`Invalid ${field}`);
  return value;
}

export function adaptNodeStorage(row: Record<string, unknown>): NodeStorage {
  const out = {} as NodeStorage;
  for (const [key, field] of Object.entries(FIELDS)) out[key as keyof NodeStorage] = optionalCount(row, field);
  return out;
}

export const unreportedStorage: NodeStorage = { total_bytes: null, used_bytes: null, free_bytes: null, reserved_bytes: null, preserved_count: null, preserved_bytes: null };

/** Percent of the filesystem total, or null when either side is not reported. */
export function storagePercent(bytes: number | null, total: number | null): number | null {
  if (bytes === null || total === null || total === 0) return null;
  return (bytes / total) * 100;
}

export function storageLevel(usedPercent: number | null): StorageLevel {
  if (usedPercent === null) return "unknown";
  if (usedPercent >= STORAGE_REFUSAL_PERCENT) return "refusal";
  if (usedPercent >= STORAGE_WARNING_PERCENT) return "warning";
  return "normal";
}

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++; }
  return unit === 0 ? `${value} B` : `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`;
}

/** Floors so that 84.99% never displays as the refusal threshold. */
export function formatStoragePercent(percent: number): string {
  return `${Math.floor(percent)}%`;
}
