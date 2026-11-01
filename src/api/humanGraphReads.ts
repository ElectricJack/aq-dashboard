import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import { queryKey } from "./queryKeys";
import { useSession } from "../app/session";
import { adaptGraphDetail, adaptGraphNeighborhood, adaptGraphPage, GRAPH_MAX_PAGES, GRAPH_PAGE_SIZE, validGraphId, type GraphNode } from "./adapters/humanGraph";
export function graphPath(project:string,kind:GraphNode["kind"],id?:string) {
  return `/api/human/projects/${encodeURIComponent(project)}/${kind === "task" ? "tasks" : "knowledge"}${id ? `/${encodeURIComponent(id)}` : ""}`;
}
export function useGraphList(project:string,kind:GraphNode["kind"],q:string) {
  const {queryContext}=useSession();
  return useInfiniteQuery({
    queryKey:queryKey(queryContext,"human-graph-list",{project,kind,q}),enabled:validGraphId(project),initialPageParam:null as string|null,
    queryFn:async({pageParam,signal})=>{
      const params=new URLSearchParams({limit:String(GRAPH_PAGE_SIZE)});
      if(pageParam)params.set("cursor",pageParam);if(q)params.set("q",q);
      return adaptGraphPage(await apiGet<unknown>(`${graphPath(project,kind)}?${params}`,signal),project,kind);
    },
    getNextPageParam:(last,all)=>all.length<GRAPH_MAX_PAGES ? last.data.next_cursor ?? undefined : undefined,
    retry:false,refetchOnWindowFocus:false,refetchOnMount:false,
  });
}
export function useGraphDetail(project:string,kind:GraphNode["kind"],id:string,pinned?:string) {
  const {queryContext}=useSession();
  return useQuery({queryKey:queryKey(queryContext,"human-graph-detail",{project,kind,id,pinned}),enabled:validGraphId(project)&&validGraphId(id),retry:false,
    queryFn:async({signal})=>adaptGraphDetail(await apiGet<unknown>(`${graphPath(project,kind,id)}${pinned?`?revision=${encodeURIComponent(pinned)}`:""}`,signal),project,kind,id,pinned),
  });
}
export function useGraphNeighborhood(project:string,root:string) {
  const {queryContext}=useSession();
  return useQuery({queryKey:queryKey(queryContext,"human-graph-neighborhood",{project,root}),enabled:validGraphId(project)&&validGraphId(root),retry:false,
    queryFn:async({signal})=>adaptGraphNeighborhood(await apiGet<unknown>(`${graphPath(project,"task",root)}/graph`,signal),project,root),
  });
}
