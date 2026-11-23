import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { validGraphId, type GraphEnvelope } from "../../api/adapters/humanGraph";
import { apiGet } from "../../api/client";
import { graphPath } from "../../api/humanGraphReads";
import { queryKey } from "../../api/queryKeys";
import { readRetry } from "../../api/retry";
import { PANEL_READ, useSession } from "../../app/session";

export type TaskRef = { project: string; id: string };
type TaskPanel<T> = {
  key: string;
  enabled: boolean;
  section: "work" | "history" | "summary" | "comments";
  adapt: (raw: unknown, project: string, id: string) => GraphEnvelope<T>;
};

export function validTaskRef(task: TaskRef) {
  return validGraphId(task.project) && validGraphId(task.id);
}

async function readPanel<T>(task: TaskRef, panel: TaskPanel<T>, signal: AbortSignal, search = "") {
  const path = graphPath(task.project, "task", task.id);
  const raw = await apiGet<unknown>(`${path}/${panel.section}${search}`, signal);
  return panel.adapt(raw, task.project, task.id);
}

function usePanelOptions<T>(task: TaskRef, panel: TaskPanel<T>) {
  const { queryContext } = useSession();
  return {
    queryKey: queryKey(queryContext, panel.key, task), enabled: panel.enabled && validTaskRef(task),
    refetchOnWindowFocus: false, meta: PANEL_READ, ...readRetry,
  };
}

export function useTaskPanel<T>(task: TaskRef, panel: TaskPanel<T> & { refetchInterval?: number }) {
  const options = usePanelOptions(task, panel);
  return useQuery({
    ...options, refetchInterval: panel.refetchInterval,
    queryFn: ({ signal }) => readPanel(task, panel, signal),
  });
}

type TaskPageRequest = { cursor: string | null; pageSize?: number };

function pageSearch({ cursor, pageSize }: TaskPageRequest) {
  const params = new URLSearchParams();
  if (pageSize) params.set("limit", String(pageSize));
  if (cursor) params.set("cursor", cursor);
  return params.size ? `?${params}` : "";
}

export function useTaskPages<T extends { next_cursor: string | null }>(
  task: TaskRef, panel: TaskPanel<T> & { pageSize?: number; maxPages?: number },
) {
  const options = usePanelOptions(task, panel);
  const max = panel.maxPages ?? Infinity;
  return useInfiniteQuery({
    ...options, initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => readPanel(task, panel, signal, pageSearch({ cursor: pageParam, pageSize: panel.pageSize })),
    getNextPageParam: (last, pages) => pages.length < max ? last.data.next_cursor ?? undefined : undefined,
  });
}
