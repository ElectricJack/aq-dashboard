import { useInfiniteQuery } from "@tanstack/react-query";
import { adaptPage, type PageView } from "../api/adapters/inspection";
import { apiGet } from "../api/client";
import { scopedKey } from "../api/queryKeys";
import type { Coverage, Envelope, Page, Scope } from "../api/wire/proposed";
import { useSession } from "./session";
import { readUrl } from "./useRead";

export type PagedRead<V> = { page: PageView<V>; coverage: Coverage; serverTime: string };

/** Cursor-paged scoped read. Pages chain within one server snapshot. */
export function usePagedRead<W, V>(opts: {
  resource: string;
  path: string;
  scope: Scope;
  params: Record<string, string | number | undefined>;
  adapt(item: W, serverTime: string): V;
  pollMs?: number;
  /**
   * A list whose rows may reorder must never re-page itself under the reader
   * (D-A04): no refetch on focus or on returning to it; only explicit refresh.
   */
  stable?: boolean;
}) {
  const { queryContext } = useSession();
  return useInfiniteQuery({
    queryKey: scopedKey(queryContext, opts.scope, opts.resource, { path: opts.path, ...opts.params }),
    initialPageParam: undefined as string | undefined,
    queryFn: async ({ pageParam, signal }): Promise<PagedRead<V>> => {
      const env = await apiGet<Envelope<Page<W>>>(
        readUrl(opts.path, { ...opts.params, cursor: pageParam }, opts.scope),
        signal,
      );
      return {
        page: adaptPage(env.data, (w) => opts.adapt(w, env.server_time)),
        coverage: env.coverage,
        serverTime: env.server_time,
      };
    },
    getNextPageParam: (last) => (last.page.hasMore ? (last.page.nextCursor ?? undefined) : undefined),
    ...(opts.pollMs !== undefined && { refetchInterval: opts.pollMs }),
    ...(opts.stable && { refetchOnWindowFocus: false, refetchOnMount: false }),
  });
}
