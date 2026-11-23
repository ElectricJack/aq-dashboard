import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ContractError } from "./adapters/contract";
import { apiGet } from "./client";
import { queryKey } from "./queryKeys";
import { useSession } from "../app/session";
import { adaptGraphDetail, adaptGraphNeighborhood, adaptGraphPage, GRAPH_MAX_PAGES, GRAPH_PAGE_SIZE, validGraphId, type GraphNode } from "./adapters/humanGraph";
export function graphPath(project:string,kind:GraphNode["kind"],id?:string) {
  return `/api/human/projects/${encodeURIComponent(project)}/${kind === "task" ? "tasks" : "knowledge"}${id ? `/${encodeURIComponent(id)}` : ""}`;
}
function graphListParams(search: string, cursor: string | null): URLSearchParams {
  const params = new URLSearchParams({ limit: String(GRAPH_PAGE_SIZE) });
  if (search) params.set("q", search);
  if (cursor) params.set("cursor", cursor);
  return params;
}
function isOpenTask(node: GraphNode): boolean { return node.task_state === "active" || node.task_state === "draft"; }

/** Graph reads use the app's read retry policy: 503 "Graph read unavailable" is capacity, not an answer (WD-07, §2B). */
export function useGraphList(project:string,kind:GraphNode["kind"],q:string,openOnly=false) {
  const {queryContext}=useSession();
  return useInfiniteQuery({
    queryKey:queryKey(queryContext,"human-graph-list",{project,kind,q,openOnly}),enabled:validGraphId(project),initialPageParam:null as string|null,
    queryFn:async({pageParam,signal})=>{
      let cursor = pageParam;
      const seen = new Set<string | null>();
      for (;;) {
        if (seen.has(cursor)) throw new ContractError("Repeated task list cursor");
        seen.add(cursor);
        const params = graphListParams(q, cursor);
        const page = adaptGraphPage(await apiGet<unknown>(`${graphPath(project,kind)}?${params}`,signal),project,kind);
        if (!openOnly) return page;
        const items = page.data.items.filter(isOpenTask);
        cursor = page.data.next_cursor;
        // Limit each read to four source pages even when a project has a long closed history.
        const reachedEnd = !cursor || seen.size === GRAPH_MAX_PAGES;
        if (items.length || reachedEnd) {
          return {...page, data:{...page.data, items}};
        }
      }
    },
    getNextPageParam:(last,all,_param,previous)=>{
      const count = all.reduce((total,p) => total + p.data.items.length, 0);
      const more = openOnly ? count < GRAPH_MAX_PAGES * GRAPH_PAGE_SIZE : all.length < GRAPH_MAX_PAGES;
      return more && last.data.next_cursor && !previous.includes(last.data.next_cursor) ? last.data.next_cursor : undefined;
    },
    refetchOnWindowFocus:false,refetchOnMount:false,
  });
}
export function useGraphDetail(project:string,kind:GraphNode["kind"],id:string,pinned?:string,refetchInterval?:number) {
  const {queryContext}=useSession();
  return useQuery({queryKey:queryKey(queryContext,"human-graph-detail",{project,kind,id,pinned}),enabled:validGraphId(project)&&validGraphId(id),refetchInterval,
    queryFn:async({signal})=>adaptGraphDetail(await apiGet<unknown>(`${graphPath(project,kind,id)}${pinned?`?revision=${encodeURIComponent(pinned)}`:""}`,signal),project,kind,id,pinned),
  });
}
export function useGraphNeighborhood(project:string,root:string) {
  const {queryContext}=useSession();
  return useQuery({queryKey:queryKey(queryContext,"human-graph-neighborhood",{project,root}),enabled:validGraphId(project)&&validGraphId(root),
    queryFn:async({signal})=>adaptGraphNeighborhood(await apiGet<unknown>(`${graphPath(project,"task",root)}/graph`,signal),project,root),
  });
}
