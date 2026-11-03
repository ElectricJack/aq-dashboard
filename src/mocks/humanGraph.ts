import { http, HttpResponse } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import type { GraphNode } from "../api/adapters/humanGraph";

// Explicitly labelled sample records derived from the pinned owner example.
export const fixtureProject=fixture.project;
export const fixtureTasks:GraphNode[]=[fixture.data as GraphNode,{...fixture.data,id:"00000000-0000-0000-0000-000000000004",title:"Fixture: verify recovery",body:"Deterministic fixture for dependency navigation.",kind:"task"} as GraphNode];
const knowledge:GraphNode={...fixture.data,id:"00000000-0000-0000-0000-000000000005",kind:"knowledge",title:"Fixture: execution ownership",body:"# Decision\nEach attempt has one current execution authority.\n\n## Why this matters\nProcess observations are recorded separately.",task_state:null,content_type:"decision"} as GraphNode;
export function humanGraphHandlers(reads:"ok"|"partial"|"empty"|"failed"){
 const unavailable=()=>HttpResponse.json({request_id:"fixture",code:"unavailable",message:"Read unavailable",retryable:true},{status:503});
 const missing=()=>HttpResponse.json({request_id:"fixture",code:"not_found",message:"This item does not exist or is not available to you.",retryable:false},{status:404});
 const wrap=(data:unknown)=>({...fixture,data});
 const base="/api/human/projects/:project";
 return [http.get(`${base}/:collection`,({params,request})=>{
   if(!["tasks","knowledge"].includes(String(params.collection)))return missing();
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const q=new URL(request.url).searchParams.get("q")?.toLowerCase()??"";
   const nodes=reads==="empty"?[]:(params.collection==="tasks"?fixtureTasks:[knowledge]).filter(n=>n.title.toLowerCase().includes(q));
   return HttpResponse.json(wrap({items:nodes,next_cursor:null}));
 }),http.get(`${base}/tasks/:id/graph`,({params})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id||!fixtureTasks.some(n=>n.id===params.id))return missing();
   return HttpResponse.json(wrap({root_id:params.id,nodes:fixtureTasks,edges:[{id:"00000000-0000-0000-0000-000000000006",source:fixtureTasks[0]!.id,target:fixtureTasks[1]!.id,edge_type:"blocks",description:"Fixture dependency",version:"1",source_revision:"1",target_revision:"1"}],truncated:reads==="partial"}));
 }),http.get(`${base}/:collection/:id`,({params,request})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const node=(params.collection==="tasks"?fixtureTasks:params.collection==="knowledge"?[knowledge]:[]).find(n=>n.id===params.id);
   const revision=new URL(request.url).searchParams.get("revision");return node&&(!revision||revision===node.content_revision)?HttpResponse.json(wrap(node)):missing();
 })];
}
