import { ContractError, isRecord } from "./contract";
import type { EntityRef } from "../wire/proposed";

const REFERENCE_REVISION = /^(?:[1-9][0-9]*|sha256:[0-9a-f]{64})$/;

function referenceRevision(value: unknown): Pick<EntityRef, "revision"> {
  if (value == null) return {};
  if (typeof value === "string" && REFERENCE_REVISION.test(value)) return { revision: value };
  throw new ContractError("Invalid entity reference or revision");
}

/** Digest revisions are valid only for references, never authorization/lifecycle versions. */
export function reference(raw: unknown): EntityRef {
  if (!isRecord(raw)) throw new ContractError("Invalid entity reference or revision");
  const { type, id, revision } = raw;
  const hasId = typeof id === "string" && id.length > 0;
  if (typeof type !== "string" || !hasId) {
    throw new ContractError("Invalid entity reference or revision");
  }
  return { type, id, ...referenceRevision(revision) };
}

export function timestamp(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== "string" || !Number.isFinite(Date.parse(raw))) throw new ContractError("Invalid observation timestamp");
  return raw;
}
