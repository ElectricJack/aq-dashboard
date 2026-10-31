import { useCallback } from "react";
import { useSearchParams } from "react-router";
import type { Scope } from "../api/wire/proposed";

const PREFIX = "project:";

export function parseScope(value: string | null): Scope {
  if (value?.startsWith(PREFIX) && value.length > PREFIX.length) {
    return { kind: "project", project_id: value.slice(PREFIX.length) };
  }
  return { kind: "all_authorized" };
}

export function scopeParam(scope: Scope): string | null {
  return scope.kind === "project" ? `${PREFIX}${scope.project_id}` : null;
}

/** Search string that carries only the scope, for links to other destinations. */
export function scopeSearch(scope: Scope): string {
  const value = scopeParam(scope);
  return value ? `?${new URLSearchParams({ scope: value }).toString()}` : "";
}

export function useScope() {
  const [params, setParams] = useSearchParams();
  const scope = parseScope(params.get("scope"));
  const setScope = useCallback(
    (next: Scope) =>
      setParams((prev) => {
        const out = new URLSearchParams(prev);
        const value = scopeParam(next);
        if (value) out.set("scope", value);
        else out.delete("scope");
        return out;
      }),
    [setParams],
  );
  return [scope, setScope] as const;
}
