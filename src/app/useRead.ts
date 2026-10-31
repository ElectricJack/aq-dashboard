import { useQuery } from "@tanstack/react-query";
import { apiGet } from "../api/client";
import { queryKey, scopedKey } from "../api/queryKeys";
import type { Coverage, Envelope, Scope } from "../api/wire/proposed";
import { scopeParam } from "./scope";
import { useSession } from "./session";

export type Read<V> = { view: V; serverTime: string; coverage: Coverage };

type Params = Record<string, string | number | undefined>;

function url(path: string, params: Params, scope?: Scope): string {
  const search = new URLSearchParams();
  const s = scope && scopeParam(scope);
  if (s) search.set("scope", s);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") search.set(k, String(v));
  const qs = search.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * Reads an envelope from AQ's human API and adapts it to a view model.
 * Scope, when given, is part of both the request and the query key.
 */
export function useRead<W, V>(opts: {
  resource: string;
  path: string;
  scope?: Scope;
  params?: Params;
  adapt(data: W, serverTime: string): V;
  pollMs?: number;
  enabled?: boolean;
}) {
  const { queryContext } = useSession();
  const params = opts.params ?? {};
  return useQuery({
    queryKey: opts.scope
      ? scopedKey(queryContext, opts.scope, opts.resource, params)
      : queryKey(queryContext, opts.resource, params),
    queryFn: async ({ signal }): Promise<Read<V>> => {
      const env = await apiGet<Envelope<W>>(url(opts.path, params, opts.scope), signal);
      return { view: opts.adapt(env.data, env.server_time), serverTime: env.server_time, coverage: env.coverage };
    },
    ...(opts.pollMs !== undefined && { refetchInterval: opts.pollMs }),
    ...(opts.enabled !== undefined && { enabled: opts.enabled }),
  });
}

export { url as readUrl };
