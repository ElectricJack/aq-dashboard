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
