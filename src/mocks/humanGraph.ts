import { http, HttpResponse } from "msw";
import fixture from "../../contracts/live/human-graph/examples/task.json";
import operationFixture from "../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
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
const zero={draft:"0",active:"0",completed:"0",canceled:"0",unknown:"0"};
const countStates=(nodes:GraphNode[])=>nodes.reduce((c,n)=>{const k=(n.task_state??"unknown") as keyof typeof zero;return {...c,[k]:String(Number(c[k])+1)};},{...zero});
function parentOf(id:string,tasks:GraphNode[],edges:GraphEdge[]){
  const e=edges.find(x=>x.edge_type==="parent-child"&&x.target===id);if(!e)return null;const p=tasks.find(t=>t.id===e.source);
  return {id:e.source,kind:p?"task":null,title:p?.title??null,task_state:p?.task_state??null,edge_id:e.id};
}
/** One-hop neighborhood of `root`, bounded by the adapter's node limit, with what it left out (X9, X10). */
function neighborhood(root:string,tasks:GraphNode[],edges:GraphEdge[]){
  const touching=edges.filter(e=>e.source===root||e.target===root);
  const near=[root,...new Set(touching.map(e=>e.source===root?e.target:e.source))];
  const kept=new Set(near.slice(0,MAX_NODES)),dropped=tasks.filter(t=>near.slice(MAX_NODES).includes(t.id));
  const keptEdges=edges.filter(e=>kept.has(e.source)&&kept.has(e.target));
  return {root_id:root,nodes:tasks.filter(t=>kept.has(t.id)),edges:keptEdges,truncated:near.length>MAX_NODES,parent:parentOf(root,tasks,edges),
    omitted:{tasks:String(dropped.length),tasks_by_state:countStates(dropped),other_nodes:"0",edges:String(touching.length-keptEdges.filter(e=>e.source===root||e.target===root).length),exact:true},expansion:null};
}
/** Fixture attempts: "Replay reconciliation" holds one and had a failed one; "Worker recovery" had one that ended. */
export const FIXTURE_ATTEMPTS:Record<string,{attempt_id:string;session_id:string;holds_task:boolean;status:string}[]>={
  [ID.replay]:[{attempt_id:id(0x301),session_id:id(0x302),holds_task:true,status:"running"},{attempt_id:id(0x305),session_id:id(0x306),holds_task:false,status:"failed"}],
  [ID.parent]:[{attempt_id:id(0x303),session_id:id(0x304),holds_task:false,status:"failed"}],
};
/** Labelled session details for the fixture attempts (`GET /api/v1/sessions/{id}`). */
export const FIXTURE_ATTEMPT_SESSIONS=[
  {sid:id(0x302),attempt:id(0x301),task:ID.replay,provider:"anthropic",model:"claude-opus-5-5",harness:"claude-code",started:"2026-10-31T11:40:00.000Z",stopped:null},
  {sid:id(0x306),attempt:id(0x305),task:ID.replay,provider:"openai",model:"gpt-5.3-codex",harness:"codex",started:"2026-10-31T10:05:00.000Z",stopped:"2026-10-31T10:31:00.000Z"},
  {sid:id(0x304),attempt:id(0x303),task:ID.parent,provider:"anthropic",model:"claude-opus-5-5",harness:"claude-code",started:"2026-10-31T09:00:00.000Z",stopped:"2026-10-31T09:20:00.000Z"},
].map(s=>({id:s.sid,label:`Fixture attempt session ${s.sid.slice(-4)}`,task:{type:"task",id:s.task,revision:"1",title:fixtureTasks.find(t=>t.id===s.task)!.title},attempt_id:s.attempt,
  project:{id:fixture.project.id,label:fixture.project.name},profile:{provider:s.provider,model:s.model,harness:s.harness},authority:"remote" as const,
  observation:{state:"unknown" as const,observed_at:"2026-10-31T12:00:00.000Z",fresh_until:"2026-10-31T12:01:00.000Z"},wait:null,controller:{state:"none" as const,label:null},terminal:null,
  lifecycle:{started_at:s.started,stopped_at:s.stopped},profile_revisions:[],permissions:[],last_activity_at:null}));
/** Fixture change history: a create, edits and lifecycle changes, oldest first as Graph serves it. "Replay reconciliation" has 30 entries (two pages). */
function historyFor(node:GraphNode){
  const count=node.id===ID.replay?30:4,base=Date.parse("2026-10-30T09:00:00.000Z");
  return Array.from({length:count},(_,i)=>({sequence:String(1000+i),entry_id:id(0x400000+parseInt(node.id.slice(-6),16)*64+i),
    category:i===0?"revision":i%5===4?"lifecycle":i%3===2?"edge":"revision",operation:i===0?"create_node":i%5===4?"set_task_state":i%3===2?"add_edge":"update_node",
    actor_id:i%2?"fixture-agent-session":"owner@example.test",reason:i===0?"Fixture: created from the recovery plan":i%4===1?`Fixture edit ${i}: tightened the acceptance criteria`:null,
    created_at:new Date(base+i*37*60_000).toISOString(),change:historyChange(i)}));
}
/** What each fixture entry changed (aq-server #99 `change`): values only for state and priority; one partial, one undescribed. */
function historyChange(i:number){
  const c=(summary:string,fields:{field:string;from:string|null;to:string|null}[]=[],edge:unknown=null,complete=true)=>({summary,fields,edge,complete});
  if(i===0)return c("created");
  if(i===7)return null;
  if(i%5===4)return c("draft → active",[{field:"task_state",from:"draft",to:"active"}]);
  if(i%3===2)return c(`added blocks from ${ID.fixtures.slice(0,8)}`,[],{edge_type:"blocks",direction:"incoming",node_id:ID.fixtures});
  if(i===1)return c("revision changed",[],null,false);
  return i%2?c("acceptance criteria",[{field:"acceptance_criteria",from:null,to:null}]):c(`priority ${i-2} → ${i}; title`,[{field:"priority",from:String(i-2),to:String(i)},{field:"title",from:null,to:null}]);
}
/* Task comments (spec 0004 §4.1): "Replay reconciliation" has 57 (two pages of 50) from an agent, the supervisor,
 * the system and the owner, including a deleted one; "Approve recovery plan" has one owner comment. */
type FixtureComment={comment_id:string;task_id:string;author:{kind:string;user_id:string|null;display_name:string|null;session_id:string|null;attempt_id:string|null};body:string|null;created_at:string;edited_at:string|null;deleted_at:string|null;revision:string;can_edit:boolean};
const OWNER={kind:"owner",user_id:id(0xa1),display_name:"owner@example.test",session_id:null,attempt_id:null};
function fixtureComments():Map<string,FixtureComment[]>{
  const at=(minutesAgo:number)=>new Date(Date.parse("2026-10-31T12:00:00.000Z")-minutesAgo*60_000).toISOString();
  const c=(n:number,task:string,author:FixtureComment["author"],body:string|null,minutesAgo:number,extra:Partial<FixtureComment>={}):FixtureComment=>({comment_id:id(0x500+n),task_id:task,author,body,created_at:at(minutesAgo),edited_at:null,deleted_at:null,revision:"1",can_edit:author.kind==="owner"&&body!==null,...extra});
  const agent={kind:"agent",user_id:null,display_name:null,session_id:id(0x306),attempt_id:id(0x305)};
  const replay=[
    c(1,ID.replay,OWNER,"Fixture: please also check the **phone** layout before closing this.",4,{edited_at:at(2),revision:"2"}),
    c(2,ID.replay,{kind:"supervisor",user_id:null,display_name:null,session_id:id(0x302),attempt_id:null},"Fixture: retried after the first attempt failed on the ledger merge.",20),
    c(3,ID.replay,OWNER,null,35,{deleted_at:at(30),revision:"2",can_edit:false}),
    c(4,ID.replay,agent,"Fixture finding: the replay drops duplicate ledger entries.\n\n- see `ledger/merge.rs`\n- reproduced with the crash fixture",95),
    c(5,ID.replay,{kind:"system",user_id:null,display_name:"aq-scheduler",session_id:null,attempt_id:null},"Fixture: attempt 00000000…0305 ended: failed.",100),
    ...Array.from({length:52},(_,i)=>c(10+i,ID.replay,agent,`Fixture progress note ${52-i}.`,120+i*5)),
  ];
  return new Map([[ID.replay,replay],[ID.approve,[c(80,ID.approve,OWNER,"Fixture: waiting on the lease contract review.",60)]]]);
}
export function humanGraphHandlers(reads:"ok"|"partial"|"empty"|"failed",graph:"standard"|"large"="standard"){
 const comments=fixtureComments();
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
   const next=offset+limit,items=nodes.slice(offset,next);
   // List pages carry the holding executions for the listed tasks (X12).
   const executions=params.collection==="tasks"?items.filter(n=>FIXTURE_ATTEMPTS[n.id]?.some(a=>a.holds_task)).map(n=>{const a=FIXTURE_ATTEMPTS[n.id]!.find(x=>x.holds_task)!;return {task_id:n.id,attempt_id:a.attempt_id,session_id:a.session_id,status:a.status};}):undefined;
   return HttpResponse.json(wrap({items,next_cursor:next<nodes.length?btoa(`fixture:${next}`):null,...(executions?{executions}:{})}));
 }),http.get(`${path}/tasks/:id/graph`,({params})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id||!tasks.some(n=>n.id===params.id))return missing();
   const result=neighborhood(String(params.id),tasks,edges);
   return HttpResponse.json(wrap({...result,truncated:result.truncated||reads==="partial"}));
 }),http.get(`${path}/tasks/:id/work`,({params})=>{
   // Work read: readiness blockers and the attempt holding the task. Only "Replay reconciliation" has one.
   if(reads==="failed")return unavailable();const node=tasks.find(n=>n.id===params.id);if(params.project!==fixture.project.id||!node)return missing();
   const blockers=edges.filter(e=>e.target===node.id&&e.edge_type==="blocks").map(e=>{const b=tasks.find(n=>n.id===e.source);return {edge_id:e.id,id:e.source,title:b?.title??null,task_state:b?.task_state??null,satisfied:b?b.task_state==="completed":null};});
   const held=FIXTURE_ATTEMPTS[node.id]?.find(a=>a.holds_task),execution=held?{task_id:node.id,attempt_id:held.attempt_id,session_id:held.session_id,status:held.status}:null;
   // aq-server #99: an attempt that has finished but still holds the task makes it "held", with AQ's reason.
   const stopped=!!execution&&["finished","declined","never_granted"].includes(execution.status);
   const reasons=stopped?[{code:"attempt_stopped_not_released",attempt_id:execution!.attempt_id,status:execution!.status,message:"Fixture: the attempt finished and stopped; the claim stays until its result is settled, the task is retried or the attempt is abandoned."}]:[];
   return HttpResponse.json(wrap({task_id:node.id,task_state:node.task_state,version:node.version,readiness:{state:node.task_state!=="active"?node.task_state:stopped?"held":execution?"running":blockers.some(b=>!b.satisfied)?"waiting":"ready",blockers,complete:true,reasons},parent:parentOf(node.id,tasks,edges),execution}));
 }),http.get(`${path}/tasks/:id/history`,({params,request})=>{
   // Recorded attempts (history read): "Replay reconciliation" holds one; "Worker recovery" had one that ended; the rest never had one.
   if(reads==="failed")return unavailable();const node=tasks.find(n=>n.id===params.id);if(params.project!==fixture.project.id||!node)return missing();
   const all=historyFor(node),cursor=new URL(request.url).searchParams.get("cursor"),offset=cursor?Number(atob(cursor).split(":")[1])||0:0,next=offset+25;
   return HttpResponse.json(wrap({task_id:node.id,items:all.slice(offset,next),next_cursor:next<all.length?btoa(`history:${next}`):null,attempts:FIXTURE_ATTEMPTS[node.id]??[],attempts_truncated:false}));
 }),http.get(`${path}/tasks/:id/comments`,({params,request})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const url=new URL(request.url),limit=Number(url.searchParams.get("limit")??50),cursor=url.searchParams.get("cursor"),offset=cursor?Number(atob(cursor).split(":")[1])||0:0;
   if(!Number.isInteger(limit)||limit<1||limit>100)return HttpResponse.json({request_id:"fixture",code:"invalid",message:"Invalid limit",retryable:false},{status:400});
   const all=reads==="empty"?[]:comments.get(String(params.id))??[],next=offset+limit;
   return HttpResponse.json(wrap({task_id:params.id,items:all.slice(offset,next),next_cursor:next<all.length?btoa(`comments:${next}`):null}));
 }),http.post("/api/v1/actions",async({request})=>{
   // task.comment.add|edit|delete; other kinds fall through to their own fixtures.
   const body=(await request.clone().json().catch(()=>null)) as {operation_id:string;kind:string;subject:{type:string;id:string;revision?:string};payload:{project_id:string;body?:string;expected_revision?:string}}|null;
   if(!body?.kind?.startsWith("task.comment."))return undefined;
   const now=new Date().toISOString();
   const answer=(disposition:"confirmed"|"conflict",comment:FixtureComment,current?:string)=>HttpResponse.json({...operationFixture,scope:{kind:"project",project_id:body.payload.project_id},data:{...operationFixture.data,operation_id:body.operation_id,disposition,
     scope:{kind:"project",project_id:body.payload.project_id},subject_refs:[body.subject],created_at:now,updated_at:now,
     receipt_refs:disposition==="confirmed"?[{type:"task_comment",id:comment.comment_id,revision:comment.revision}]:[],
     affected_entities:disposition==="confirmed"?[{type:"task_comment",id:comment.comment_id,revision:comment.revision},{type:"task",id:comment.task_id}]:[],
     ...(current?{current_versions:{task_comment:current}}:{}),recovery:disposition==="confirmed"?"none":"refresh_and_review"}});
   if(body.kind==="task.comment.add"){
     const list=comments.get(body.subject.id)??[];const existing=list.find(c=>c.comment_id===body.operation_id);if(existing)return answer("confirmed",existing);
     const added:FixtureComment={comment_id:body.operation_id,task_id:body.subject.id,author:OWNER,body:body.payload.body!,created_at:now,edited_at:null,deleted_at:null,revision:"1",can_edit:true};
     comments.set(body.subject.id,[added,...list]);return answer("confirmed",added);
   }
   const target=[...comments.values()].flat().find(c=>c.comment_id===body.subject.id);
   if(!target)return missing();
   if(target.author.kind!=="owner")return HttpResponse.json({request_id:"fixture",code:"comment_not_author",message:"Only the owner who wrote a comment can edit or delete it",retryable:false},{status:403});
   if(target.deleted_at)return HttpResponse.json({request_id:"fixture",code:"comment_deleted",message:"This comment was deleted",retryable:false},{status:409});
   if(target.revision!==body.payload.expected_revision)return answer("conflict",target,target.revision);
   target.revision=String(Number(target.revision)+1);
   if(body.kind==="task.comment.edit"){target.body=body.payload.body!;target.edited_at=now;}else{target.body=null;target.deleted_at=now;target.can_edit=false;}
   return answer("confirmed",target);
 }),http.get(`${path}/tasks/:id/summary`,({params})=>{
   // Descendant counts (X11): the fixture tree is one level deep.
   if(reads==="failed")return unavailable();const node=tasks.find(n=>n.id===params.id);if(params.project!==fixture.project.id||!node)return missing();
   const kids=edges.filter(e=>e.edge_type==="parent-child"&&e.source===node.id).map(e=>tasks.find(t=>t.id===e.target)!).filter(Boolean);
   return HttpResponse.json(wrap({task_id:node.id,scope:"descendants",implementation:{total:String(kids.length),by_state:countStates(kids),complete:true},delivery:{state:"unavailable",owner:"D1"}}));
 }),http.get(`${path}/:collection/:id`,({params,request})=>{
   if(reads==="failed")return unavailable();if(params.project!==fixture.project.id)return missing();
   const node=(params.collection==="tasks"?tasks:params.collection==="knowledge"?[knowledge]:[]).find(n=>n.id===params.id);
   const revision=new URL(request.url).searchParams.get("revision");return node&&(!revision||revision===node.content_revision)?HttpResponse.json(wrap(node)):missing();
 })];
}
