// Mutating qualification: use an explicitly designated disposable local E0 project.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
const origin=process.env.AQ_G3_ORIGIN,project=process.env.AQ_G3_PROJECT_ID,task=process.env.AQ_G3_TASK_ID;
assert(origin&&project&&task,"Set AQ_G3_ORIGIN, AQ_G3_PROJECT_ID and AQ_G3_TASK_ID to a disposable E0 fixture");
assert(["127.0.0.1","localhost","[::1]"].includes(new URL(origin).hostname),"Probe requires a local disposable origin");
const events=[];
async function get(path){const r=await fetch(new URL(path,origin));assert.equal(r.status,200,path);return r.json();}
async function send(bytes){const r=await fetch(new URL('/api/v1/actions',origin),{method:'POST',headers:{'Content-Type':'application/json','X-AQ-Request':'1'},body:bytes});return {status:r.status,body:await r.json()};}
async function action(kind,subject,fields={},reason){const id=randomUUID(),author=['knowledge.author','task.create'].includes(kind);const request={operation_id:id,kind,subject,expected_versions:{[subject.type]:subject.revision},...(reason?{reason}:{}),payload:{...fields,operation_id:id,...(kind==='task.create'?{}:{project_id:project}),[author?'expected_project_revision':'expected_version']:subject.revision}};const bytes=JSON.stringify(request);const result=await send(bytes);assert.equal(result.body.api_version,'dashboard-actions-1',JSON.stringify(result));const op=result.body.data;assert.equal(op.operation_id,id);assert(['confirmed','rejected','conflict','pending','unknown'].includes(op.disposition));events.push({kind,status:result.status,operation:op});const lookup=await get('/api/v1/operations/'+id);assert.equal(lookup.data.request_digest,op.request_digest);return {op,bytes,request};}
const base=`/api/human/projects/${project}`;
const record=await get(`${base}/tasks/${task}`),projectSubject={type:'project',id:project,revision:record.project.revision};
const subject=n=>({type:n.kind,id:n.id,revision:n.version});
const edit=await action('task.edit',subject(record.data),{title:'G3 qualification task '+randomUUID().slice(0,8),body:'Disposable G3 action qualification. No worker stop is implied.'});assert.equal(edit.op.disposition,'confirmed');
const replay=await send(edit.bytes);assert.deepEqual(replay.body.data,edit.op);
const changed=structuredClone(edit.request);changed.payload.title='Changed bytes must not replace intent';const conflict=await send(JSON.stringify(changed));assert.equal(conflict.status,409);events.push({kind:'changed-byte-replay',status:conflict.status,code:conflict.body.code});
const stale=await action('task.edit',subject(record.data),{title:'Stale must conflict'});assert.equal(stale.op.disposition,'conflict');
const fresh=await get(`${base}/tasks/${task}`);
const created=await action('task.create',projectSubject,{title:'G3 disposable dependency',body:'Dependency probe only.',acceptance_criteria:'Recorded dependency round trip.',labels:[],task_state:'draft'});assert.equal(created.op.disposition,'confirmed');
const blocker=created.op.affected_entities.find(r=>r.type==='task')?.id??created.op.operation_id;
const added=await action('task.dependency.add',subject(fresh.data),{blocker_id:blocker});assert.equal(added.op.disposition,'confirmed');
const graph=await get(`${base}/tasks/${task}/graph`);const edge=graph.data.edges.find(e=>e.source===blocker&&e.target===task);assert(edge,'Added dependency appears in Graph');
const afterAdd=await get(`${base}/tasks/${task}`);const removed=await action('task.dependency.remove',subject(afterAdd.data),{edge_id:edge.id,edge_version:edge.version});assert.equal(removed.op.disposition,'confirmed');
for(const kind of ['task.cancel','task.retry']){const current=await get(`${base}/tasks/${task}`);await action(kind,subject(current.data),{},kind==='task.cancel'?'Disposable intent probe':undefined);}
const authored=await action('knowledge.author',projectSubject,{title:'G3 qualification runbook',body:'# G3 qualification\n\nDisposable evidence for the nine typed actions.\n\n## Recovery\nKeep the original operation ID and bytes while the outcome is unknown.',labels:['G3'],content_type:'procedure'});assert.equal(authored.op.disposition,'confirmed');
const knowledge=authored.op.affected_entities.find(r=>r.type==='knowledge')?.id??authored.op.operation_id;
let current=await get(`${base}/knowledge/${knowledge}`);const corrected=await action('knowledge.correct',subject(current.data),{title:'G3 qualification runbook revised',body:current.data.body+'\n\nA correction creates a new revision.'});assert.equal(corrected.op.disposition,'confirmed');
current=await get(`${base}/knowledge/${knowledge}`);const verified=await action('knowledge.verify',subject(current.data),{verification:'verified',evidence:[{source_id:randomUUID(),kind:'url',url:'https://example.org/G3',observed_at:new Date().toISOString(),retained:false}]},'Observed the disposable qualification receipts');assert.equal(verified.op.disposition,'confirmed');
current=await get(`${base}/knowledge/${knowledge}`);const retired=await action('knowledge.retire',subject(current.data),{retirement_reason:'Qualification finished; retained history is evidence'});assert.equal(retired.op.disposition,'confirmed');
const report={origin,project,task,knowledge,blocker,events};writeFileSync(process.env.AQ_G3_OUTPUT??'/tmp/G3-live-probe.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({origin,knowledge,actions:events.map(e=>[e.kind,e.operation?.disposition??e.status])}));
