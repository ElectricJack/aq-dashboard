/** Raised when a response does not match the contract the client was built against. */
export class ContractError extends Error {
  override name = "ContractError";
  constructor(message: string) {
    super(`Contract violation: ${message}`);
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Server time governs freshness; a local clock never decides staleness. */
export function isStale(serverTime: string, freshUntil: string): boolean {
  const now = Date.parse(serverTime);
  const until = Date.parse(freshUntil);
  if (Number.isNaN(now) || Number.isNaN(until)) return true;
  return now > until;
}

/** Bounds collection size before checking individual wire entries. */
export function boundedList(value: unknown, maximum: number, accept: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.length <= maximum && value.every(accept);
}

export function nullable<T>(value: unknown, accept: (item: unknown) => item is T): value is T | null;
export function nullable(value: unknown, accept: (item: unknown) => boolean): boolean;
export function nullable(value: unknown, accept: (item: unknown) => boolean): boolean {
  return value === null || accept(value);
}

export function optional<T>(value: unknown, accept: (item: unknown) => item is T): value is T | undefined;
export function optional(value: unknown, accept: (item: unknown) => boolean): boolean;
export function optional(value: unknown, accept: (item: unknown) => boolean): boolean {
  return value === undefined || accept(value);
}

/** Canonical lowercase UUID used by the result, project and decision contracts. */
export function canonicalUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value)
    && value !== "00000000-0000-0000-0000-000000000000";
}

export function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function timestampMs(value: unknown): value is number {
  return positiveInteger(value) && value <= 8640000000000000;
}

export function sameFields<T>(left: T, right: T, fields: readonly (keyof T)[]): boolean {
  return fields.every(field => left[field] === right[field]);
}

/** Enforce a byte limit without replacing malformed UTF-16 with a replacement character. */
export function boundedUtf8(value: unknown, maxBytes: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || value.length > 0)
    && !/\p{Cs}/u.test(value) && new TextEncoder().encode(value).length <= maxBytes;
}
