import type { Scope } from "./wire/proposed";

export type QueryContext = {
  principalId: string;
  authorizationRevision: string;
  contractVersion: string;
};

/**
 * Every protected query key starts with ["aq", principalId] so an identity
 * change can clear them all, and includes the authorization revision and
 * contract version so a role or contract change never reuses cached data.
 */
export function queryKey(ctx: QueryContext, resource: string, params: Record<string, unknown>) {
  return [
    "aq",
    ctx.principalId,
    ctx.authorizationRevision,
    ctx.contractVersion,
    resource,
    params,
  ] as const;
}

/** Key for a scoped read; the scope is its own element, never folded into params. */
export function scopedKey(
  ctx: QueryContext,
  scope: Scope,
  resource: string,
  params: Record<string, unknown>,
) {
  return [
    "aq",
    ctx.principalId,
    ctx.authorizationRevision,
    ctx.contractVersion,
    resource,
    scope,
    params,
  ] as const;
}
