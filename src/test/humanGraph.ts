import type { GraphNode } from "../api/adapters/humanGraph";
export const graphId=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const graphProject=graphId(1);
export function graphNode(kind:GraphNode["kind"]="knowledge", n=10):GraphNode {
  return {id:graphId(n),kind,title:kind === "task"?"Implement recovery":"Execution ownership model",body:"Each attempt has one current execution authority.\nProcess observations are recorded separately.",acceptance_criteria:kind === "task"?"Recovery is verified by tests.":"",labels:["architecture"],task_state:kind === "task"?"active":null,verification:"verified",content_type:"decision",retired:false,deleted:false,created_at:"2026-11-01T12:00:00.000Z",updated_at:"2026-11-01T12:01:00.000Z",version:"9007199254740993",content_revision:"4",created_by:"owner@localhost",provenance:[{kind:"url",source_id:"architecture",url:"https://example.org/architecture"}],last_verified_by:"reviewer",last_verified_at:"2026-11-01T12:01:00.000Z",retirement_reason:null,valid_from:null,valid_until:null,review_at:"2026-12-01T12:00:00.000Z",successor_id:null,summary:null,summary_of_revision:null};
}
export function graphEnvelope<T>(data:T,revision="1") {
  return {contract:"human-graph-1",project:{id:graphProject,name:"Agent Q",revision,workspace_id:graphId(2)},observed_at:"2026-11-01T12:02:00.000Z",data};
}
