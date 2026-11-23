import { ContractError, isRecord } from "../../api/adapters/contract";

export function check(value: unknown): asserts value {
  if (!value) throw new ContractError("Invalid task work read");
}

export function boundedString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

export function text(value: unknown, max: number): value is string {
  return boundedString(value, max) && value.length > 0;
}

export function boundedList(value: unknown, max: number): value is unknown[] {
  return Array.isArray(value) && value.length <= max;
}

export function time(value: unknown): value is string {
  return boundedString(value, 40) && Number.isFinite(Date.parse(value));
}

export function sequence(value: unknown): value is string {
  return typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value);
}

/** Open enum values allow newer servers to name a value this bundle cannot display yet. */
export function openEnumValue(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(value);
}

export function cursor(value: unknown): string | null {
  check(value === null || text(value, 4096));
  return value;
}

export function taskRecord(value: unknown, id: string) {
  check(isRecord(value));
  check(value.task_id === id);
  return value;
}
