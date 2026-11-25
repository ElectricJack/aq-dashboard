import { useInfiniteQuery } from "@tanstack/react-query";
import { scopedKey } from "../../api/queryKeys";
import { adaptResultComments, viewScoped, type ResultDetail } from "../../api/adapters/resultsFeedback";
import { apiGet } from "../../api/client";
import { useSession } from "../../app/session";
export function useComments(detail?: ResultDetail) {
  const { queryContext } = useSession();
  return useInfiniteQuery({
    queryKey: scopedKey(
      queryContext,
      detail ? { kind: "project", project_id: detail.result.project_id } : { kind: "all_authorized" },
      "result-comments",
      { id: detail?.result.id, revision: detail?.revision.revision },
    ),
    enabled: !!detail,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    queryFn: async ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: "20" });
      if (pageParam) p.set("cursor", pageParam);
      const raw = await apiGet<unknown>(
        `/api/v1/results/${detail!.result.id}/revisions/${detail!.revision.revision}/comments?${p}`,
        signal,
      );
      return viewScoped(() => adaptResultComments(raw, detail!.result.project_id));
    },
    getNextPageParam: (last, pages) => (pages.length < 4 ? (last.next_cursor ?? undefined) : undefined),
  });
}
