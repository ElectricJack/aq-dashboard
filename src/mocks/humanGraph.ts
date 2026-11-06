import { http, HttpResponse } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import { GRAPH_PAGE_SIZE, type GraphEdge, type GraphNode } from "../api/adapters/humanGraph";

// Explicitly labelled sample records derived from the pinned owner example.
// Titles mirror design reference 02 (Work explorer); bodies say they are fixtures.
export const fixtureProject=fixture.project;
const base=fixture.data as GraphNode;
const FIXTURE_NOTE="Mock-mode fixture mirroring design reference 02 (Work explorer). Not live AQ data.";
const id=(n:number)=>`00000000-0000-0000-0000-${n.toString(16).padStart(12,"0")}`;
const task=(n:number,title:string,task_state:string,extra:Partial<GraphNode>={}):GraphNode=>({...base,...extra,id:id(n),title,task_state,body:`${FIXTURE_NOTE}\n\n${extra.body??""}`.trim(),kind:"task"} as GraphNode);
const ID={parent:id(0x101),lease:id(0x102),fixtures:id(0x103),approve:id(0x104),replay:id(0x105),implement:id(0x106),validate:id(0x107),legacy:id(0x108)};
export const FIXTURE_IDS=ID;

/** Ten tasks covering draft, active, completed and canceled states. Index 0/1 stay the original pinned pair. */
export const fixtureTasks:GraphNode[]=[
  base,
  {...base,id:id(4),title:"Fixture: verify recovery",body:"Deterministic fixture for dependency navigation.",kind:"task"} as GraphNode,
  task(0x101,"Fixture: Worker recovery","active",{body:"Parent fixture task grouping the recovery work."}),
  task(0x102,"Fixture: Define lease contract","completed",{acceptance_criteria:"Lease fields and expiry rules are written down."}),
  task(0x103,"Fixture: Recovery test fixtures","completed",{acceptance_criteria:"Crash and replay fixtures exist."}),
  task(0x104,"Fixture: Approve recovery plan","active",{acceptance_criteria:"An operator approves the recovery plan."}),
  task(0x105,"Fixture: Replay reconciliation","active",{acceptance_criteria:"Replayed events reconcile with recorded state."}),
  task(0x106,"Fixture: Implement safe recovery","draft",{acceptance_criteria:"Recovery never runs two current executions."}),
  task(0x107,"Fixture: Validate crash recovery","draft",{acceptance_criteria:"Crash tests pass against the approved plan."}),
  task(0x108,"Fixture: Retire legacy lease path","canceled",{body:"Canceled: superseded by the safe recovery implementation."}),
];
const edge=(n:number,source:string,target:string,edge_type:string,description:string|null):GraphEdge=>({id:id(0x200+n),source,target,edge_type,description,version:"1",source_revision:"1",target_revision:"1"});
const children=fixtureTasks.filter(t=>t.id!==ID.parent);
export const fixtureEdges:GraphEdge[]=[
  {...edge(0,fixtureTasks[0]!.id,fixtureTasks[1]!.id,"blocks","Fixture dependency"),id:id(6)},
  ...children.map((t,i)=>edge(1+i,ID.parent,t.id,"parent-child",null)),
  edge(20,ID.lease,ID.approve,"blocks","Lease contract precedes plan approval"),
  edge(21,ID.approve,ID.implement,"blocks","Plan approval precedes implementation"),
  edge(22,ID.implement,ID.validate,"blocks","Implementation precedes validation"),
  edge(23,ID.fixtures,ID.replay,"blocks","Fixtures precede replay"),
  edge(24,ID.replay,ID.approve,"references","Reconciliation findings inform the plan"),
  edge(25,ID.implement,ID.legacy,"supersedes","Safe recovery replaces the legacy path"),
  edge(26,ID.validate,fixtureTasks[0]!.id,"references","Validation uses the inspection contract"),
];
/** Large scenario: 120 generated children of the parent, for omitted-count states. */
const generated=Array.from({length:120},(_,i)=>task(0x10000+i,`Fixture (large): generated task ${String(i+1).padStart(3,"0")}`,"draft"));
const largeTasks=[...fixtureTasks,...generated];
const largeEdges=[...fixtureEdges,...generated.map((t,i)=>edge(0x1000+i,ID.parent,t.id,"parent-child",null))];

const knowledge:GraphNode={...base,id:id(5),kind:"knowledge",title:"Fixture: execution ownership",body:"# Decision\nEach attempt has one current execution authority.\n\n## Why this matters\nProcess observations are recorded separately.",task_state:null,content_type:"decision"} as GraphNode;
const MAX_NODES=64;
/** One-hop neighborhood of `root`, bounded by the adapter's node limit. */
function neighborhood(root:string,tasks:GraphNode[],edges:GraphEdge[]){
  const touching=edges.filter(e=>e.source===root||e.target===root);
  const near=[root,...new Set(touching.map(e=>e.source===root?e.target:e.source))];
  const kept=new Set(near.slice(0,MAX_NODES));
  return {root_id:root,nodes:tasks.filter(t=>kept.has(t.id)),edges:edges.filter(e=>kept.has(e.source)&&kept.has(e.target)),truncated:near.length>MAX_NODES};
}
export function humanGraphHandlers(reads:"ok"|"partial"|"empty"|"failed",graph:"standard"|"large"="standard"){
 const unavailable=()=>HttpResponse.json({request_id:"fixture",code:"unavailable",message:"Read unavailable",retryable:true},{status:503});
 const missing=()=>HttpResponse.json({request_id:"fixture",code:"not_found",message:"This item does not exist or is not available to you.",retryable:false},{status:404});
 const wrap=(data:unknown)=>({...fixture,data});
 const tasks=graph==="large"?largeTasks:fixtureTasks,edges=graph==="large"?largeEdges:fixtureEdges;
 const path="/api/human/projects/:project";
 return [http.get(`${path}/:collection`,({params,request})=>{
   if(!["tasks","knowledge"].includes(String(params.collection)))return missing();
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const url=new URL(request.url),q=url.searchParams.get("q")?.toLowerCase()??"";
   const limit=Math.min(GRAPH_PAGE_SIZE,Math.max(1,Number(url.searchParams.get("limit"))||GRAPH_PAGE_SIZE));
   const cursor=url.searchParams.get("cursor"),offset=cursor?Number(atob(cursor).split(":")[1])||0:0;
   const nodes=reads==="empty"?[]:(params.collection==="tasks"?tasks:[knowledge]).filter(n=>n.title.toLowerCase().includes(q));
   const next=offset+limit;
   return HttpResponse.json(wrap({items:nodes.slice(offset,next),next_cursor:next<nodes.length?btoa(`fixture:${next}`):null}));
 }),http.get(`${path}/tasks/:id/graph`,({params})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id||!tasks.some(n=>n.id===params.id))return missing();
   const result=neighborhood(String(params.id),tasks,edges);
   return HttpResponse.json(wrap({...result,truncated:result.truncated||reads==="partial"}));
 }),http.get(`${path}/tasks/:id/work`,({params})=>{
   // Work read: readiness blockers and the attempt holding the task. Only "Replay reconciliation" has one.
   if(reads==="failed")return unavailable();const node=tasks.find(n=>n.id===params.id);if(params.project!==fixture.project.id||!node)return missing();
   const blockers=edges.filter(e=>e.target===node.id&&e.edge_type==="blocks").map(e=>{const b=tasks.find(n=>n.id===e.source);return {edge_id:e.id,id:e.source,title:b?.title??null,task_state:b?.task_state??null,satisfied:b?b.task_state==="completed":null};});
   const execution=node.id===ID.replay?{task_id:node.id,attempt_id:id(0x301),session_id:id(0x302),status:"running"}:null;
   return HttpResponse.json(wrap({task_id:node.id,task_state:node.task_state,version:node.version,readiness:{state:node.task_state!=="active"?node.task_state:execution?"running":blockers.some(b=>!b.satisfied)?"waiting":"ready",blockers,complete:true},parent:null,execution}));
 }),http.get(`${path}/tasks/:id/history`,({params})=>{
   // Recorded attempts (history read): "Replay reconciliation" holds one; "Worker recovery" had one that ended; the rest never had one.
   if(reads==="failed")return unavailable();const node=tasks.find(n=>n.id===params.id);if(params.project!==fixture.project.id||!node)return missing();
   const attempts=node.id===ID.replay?[{attempt_id:id(0x301),session_id:id(0x302),holds_task:true,status:"running"}]:node.id===ID.parent?[{attempt_id:id(0x303),session_id:id(0x304),holds_task:false,status:"failed"}]:[];
   return HttpResponse.json(wrap({task_id:node.id,items:[],next_cursor:null,attempts,attempts_truncated:false}));
 }),http.get(`${path}/:collection/:id`,({params,request})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const node=(params.collection==="tasks"?tasks:params.collection==="knowledge"?[knowledge]:[]).find(n=>n.id===params.id);
   const revision=new URL(request.url).searchParams.get("revision");return node&&(!revision||revision===node.content_revision)?HttpResponse.json(wrap(node)):missing();
 })];
}
