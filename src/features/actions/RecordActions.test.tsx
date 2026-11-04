import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import confirmed from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { graphEnvelope, graphNode, graphProject, graphId } from "../../test/humanGraph";

const actions = [
  ["task.edit", "Edit task"], ["task.cancel", "Cancel task"], ["task.retry", "Retry task"],
  ["task.dependency.add", "Add dependency"], ["task.dependency.remove", "Remove dependency"],
  ["knowledge.author", "Add record"], ["knowledge.correct", "Correct record"],
  ["knowledge.verify", "Verify record"], ["knowledge.retire", "Retire record"],
] as const;
const taskCapabilities:Record<string,string>={"task.edit":"tasks.edit","task.cancel":"tasks.cancel","task.retry":"tasks.retry","task.dependency.add":"tasks.dependencies.add","task.dependency.remove":"tasks.dependencies.remove"};
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function setup(kind: string, disabled?: string, labels?:string[]) {
  const type = kind.startsWith("task.") ? "task" : "knowledge", node = {...graphNode(type),...(labels?{labels}:{})};
  let version = node.version, detailReads = 0;
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data,
    capabilities: [...bootstrap.data.capabilities.filter(c => !["human.graph.read", "tasks.read", "knowledge.read", "dashboard.actions", ...actions.map(a=>taskCapabilities[a[0]]??a[0])].includes(c.name)),
      ...["human.graph.read", "tasks.read", "knowledge.read", "dashboard.actions", ...actions.map(a=>taskCapabilities[a[0]]??a[0])].map(name=>({name,version:"1",enabled:name!==disabled,...(name===disabled?{reason:"Administrator required for verified records"}:{})}))],
  }})));
  const base = `/api/human/projects/${graphProject}/${type==="task"?"tasks":"knowledge"}`;
  server.use(http.get(base, () => HttpResponse.json(graphEnvelope({items:[{...node,version}],next_cursor:null}))),
    http.get(`${base}/${node.id}`, () => { detailReads++; return HttpResponse.json(graphEnvelope({...node,version})); }),
    http.get(`${base}/${node.id}/graph`, () => HttpResponse.json(graphEnvelope({root_id:node.id,nodes:[node,graphNode("task",11)],edges:[{id:graphId(50),source:graphId(11),target:node.id,edge_type:"blocks",description:"must precede",version:"2",source_revision:null,target_revision:null}],truncated:false}))));
  return {node, changeVersion: (v:string)=>{version=v;}, reads:()=>detailReads};
}
function operation(id:string, disposition="confirmed", extra={}) {
 return {...confirmed, data:{...confirmed.data, operation_id:id, disposition,
   subject_refs:[], receipt_refs:disposition==="confirmed"?[{type:"graph_change_set",id:graphId(99)}]:[],
   affected_entities:disposition==="confirmed"?[{type:"knowledge",id:graphId(10),revision:"5"}]:[],...extra}};
}
// Work's compact inspector shows one primary action; the rest live in the "More actions" menu.
async function launch(label:string,task:boolean){
 if(task){await screen.findByRole("button",{name:"More actions"});const direct=screen.queryByRole("button",{name:label});if(direct)return userEvent.click(direct);await userEvent.click(screen.getByRole("button",{name:"More actions"}));return userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem",{name:label}));}
 await userEvent.click(await screen.findByRole("button",{name:label}));
}
async function open(kind:string,label:string,labels?:string[]){
 const {node,...state}=setup(kind,undefined,labels);
 renderApp(`/${kind.startsWith("task.")?"work":"knowledge"}/${node.id}?scope=project:${graphProject}`);
 await launch(label,kind.startsWith("task."));
 const dialog=screen.getByRole("dialog",{name:label});
 if(["task.edit","knowledge.author","knowledge.correct"].includes(kind)){
  const title=within(dialog).getByLabelText("Title"); await userEvent.clear(title);await userEvent.type(title,"A revised title");
 }
 if(["task.cancel","knowledge.verify","knowledge.retire"].includes(kind))await userEvent.type(within(dialog).getByLabelText("Reason"),"Checked the source");
 if(kind==="task.dependency.add")await userEvent.type(within(dialog).getByLabelText("Blocker task ID"),graphId(11));
 if(kind==="task.dependency.remove")await userEvent.selectOptions(within(dialog).getByLabelText("Dependency"),graphId(50));
 if(kind==="knowledge.verify")await userEvent.type(within(dialog).getByLabelText("Evidence URL"),"https://example.org/runbook");
 if(["task.cancel","knowledge.retire"].includes(kind))await userEvent.click(within(dialog).getByRole("checkbox"));
 return {node,dialog,...state};
}

test.each(actions)("%s submits a version-bound typed action and refreshes confirmed effects", async(kind,label)=>{
 const requests:Record<string,unknown>[]=[];
 server.use(http.post("/api/v1/actions",async({request})=>{
  expect(request.headers.get("X-AQ-Request")).toBe("1");const body=await request.json() as Record<string,unknown>;requests.push(body);
  return HttpResponse.json(operation(String(body.operation_id)));
 }));
 const {node,dialog,reads}=await open(kind,label);const before=reads();
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 expect(await within(dialog).findByText(kind==="task.cancel"?"Cancellation requested":"Action confirmed",{exact:true})).toBeVisible();
 expect(requests).toHaveLength(1);
 const body=requests[0]!,payload=body.payload as Record<string,unknown>;
 expect(body.kind).toBe(kind);expect(payload.operation_id).toBe(body.operation_id);expect(payload.project_id).toBe(graphProject);
 expect(body.subject).toEqual({type:kind==="knowledge.author"?"project":node.kind,id:kind==="knowledge.author"?graphProject:node.id,revision:kind==="knowledge.author"?"1":"9007199254740993"});
 expect(body.expected_versions).toEqual(kind==="knowledge.author"?{project:"1"}:{[node.kind]:"9007199254740993"});
 if(kind==="task.dependency.remove")expect(payload).toMatchObject({edge_id:graphId(50),edge_version:"2"});
 if(kind==="knowledge.verify")expect(payload).toMatchObject({verification:"verified",evidence:[{kind:"url",url:"https://example.org/runbook",retained:false}]});
 await waitFor(()=>expect(reads()).toBeGreaterThan(before));
});

test.each(actions)("%s preserves an unknown effect and retries identical bytes",async(kind,label)=>{
 const bytes:string[]=[];let lookups=0;
 server.use(http.post("/api/v1/actions",async({request})=>{bytes.push(await request.text());return bytes.length===1?HttpResponse.error():HttpResponse.json(operation(JSON.parse(bytes[0]!).operation_id));}),
  http.get("/api/v1/operations/:id",()=>{lookups++;return HttpResponse.json({request_id:"lookup",code:"not_found",message:"Not available",retryable:false},{status:404});}));
 const {dialog}=await open(kind,label);
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 expect(await within(dialog).findByText(/Outcome unknown/)).toBeVisible();
 await waitFor(()=>expect(lookups).toBeGreaterThan(0));
 expect(within(dialog).queryByText("Action confirmed",{exact:true})).not.toBeInTheDocument();
 await userEvent.click(within(dialog).getByRole("button",{name:"Retry exact submission"}));
 await within(dialog).findByText(kind==="task.cancel"?"Cancellation requested":"Action confirmed",{exact:true});
 expect(bytes).toHaveLength(2);expect(bytes[1]).toBe(bytes[0]);
});

test("work_task_edit_handles_unknown_effect",async()=>{
 let id="",posts=0;
 server.use(http.post("/api/v1/actions",async({request})=>{const body=await request.json() as {operation_id:string};id=body.operation_id;posts++;return HttpResponse.error();}),
 http.get("/api/v1/operations/:id",({params})=>HttpResponse.json(operation(String(params.id)))));
 const {dialog}=await open("task.edit","Edit task");
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 await within(dialog).findByText("Action confirmed",{exact:true});expect(id).not.toBe("");expect(posts).toBe(1);
});

test("knowledge_correct_conflict_offers_reload",async()=>{
 const requests:{operation_id:string;expected_versions:unknown}[]=[];
 server.use(http.post("/api/v1/actions",async({request})=>{const body=await request.json() as typeof requests[number];requests.push(body);return HttpResponse.json(operation(body.operation_id,requests.length===1?"conflict":"confirmed",{current_versions:{knowledge:"9007199254740994"}}));}));
 const {dialog,changeVersion}=await open("knowledge.correct","Correct record");
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 expect(await within(dialog).findByText(/Conflict/)).toBeVisible();expect(within(dialog).getByText(/knowledge: 9007199254740994/)).toBeVisible();
 expect(within(dialog).getByLabelText("Title")).toHaveValue("A revised title");
 changeVersion("9007199254740994");
 await userEvent.click(within(dialog).getByRole("button",{name:"Reload current versions"}));
 await waitFor(()=>expect(within(dialog).getByRole("button",{name:"Submit"})).toBeEnabled());
 expect(within(dialog).getByLabelText("Title")).toHaveValue("A revised title");
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));await within(dialog).findByText("Action confirmed",{exact:true});
 expect(requests[1]!.operation_id).not.toBe(requests[0]!.operation_id);expect(requests[1]!.expected_versions).toEqual({knowledge:"9007199254740994"});
});

test("server action refusal reason stays visible",async()=>{
 const {node}=setup("knowledge.correct","knowledge.correct");renderApp(`/knowledge/${node.id}?scope=project:${graphProject}`);
 const control=await screen.findByRole("button",{name:"Correct record"});expect(control).toBeDisabled();expect(screen.getByText("Administrator required for verified records")).toBeVisible();
});

test("work inspector shows one shared reason when task actions are not offered",async()=>{
 const {node}=setup("task.edit");const missing=Object.values(taskCapabilities);
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>!["human.graph.read","tasks.read","dashboard.actions",...missing].includes(c.name)),...["human.graph.read","tasks.read","dashboard.actions"].map(name=>({name,version:"1",enabled:true}))]}})));
 renderApp(`/work/${node.id}?scope=project:${graphProject}`);
 expect(await screen.findByText("Task actions aren't offered by this AQ server")).toBeVisible();
 expect(screen.queryAllByText("Not offered by this AQ server").length).toBeLessThanOrEqual(1);
 expect(screen.queryByRole("button",{name:"More actions"})).toBeNull();
});

test("pending cancellation is an intent and polls without optimistic task lifecycle changes",async()=>{
 let id="",lookup=0;
 server.use(http.post("/api/v1/actions",async({request})=>{id=(await request.json() as {operation_id:string}).operation_id;return HttpResponse.json(operation(id,"pending"),{status:202});}),
  http.get("/api/v1/operations/:id",()=>{lookup++;return HttpResponse.json(operation(id));}));
 const {dialog}=await open("task.cancel","Cancel task");
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 await within(dialog).findByText("Cancellation requested",{exact:true});expect(lookup).toBeGreaterThan(0);expect(screen.getAllByText("Active",{exact:true}).length).toBeGreaterThan(0);
});

test("rejection gives a definite safe explanation",async()=>{
 server.use(http.post("/api/v1/actions",async({request})=>HttpResponse.json(operation((await request.json() as {operation_id:string}).operation_id,"rejected"))));
 const {dialog}=await open("task.retry","Retry task");await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 expect(await within(dialog).findByText(/Rejected/)).toBeVisible();expect(within(dialog).queryByText("Action confirmed",{exact:true})).not.toBeInTheDocument();
});

test("duplicate submit and close/reopen retain one unresolved operation",async()=>{
 const bytes:string[]=[];let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 server.use(http.post("/api/v1/actions",async({request})=>{bytes.push(await request.text());await gate;return HttpResponse.error();}),http.get("/api/v1/operations/:id",()=>HttpResponse.json({request_id:"lookup",code:"not_found",message:"Not available",retryable:false},{status:404})));
 const {dialog}=await open("task.edit","Edit task");
 await userEvent.dblClick(within(dialog).getByRole("button",{name:"Submit"}));await waitFor(()=>expect(bytes).toHaveLength(1));
 await userEvent.click(within(dialog).getByRole("button",{name:"Close action"}));
 await userEvent.click(screen.getByRole("button",{name:"Edit task · operation"}));
 expect(within(screen.getByRole("dialog")).getByLabelText("Title")).toHaveValue("A revised title");
 release();await within(dialog).findByText(/Outcome unknown/);
 expect(bytes).toHaveLength(1);expect(within(dialog).queryByRole("button",{name:"Submit"})).not.toBeInTheDocument();
});

test("a late response cannot open an operation on a different subject",async()=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
 server.use(http.post("/api/v1/actions",async({request})=>{const body=await request.json() as {operation_id:string};await gate;return HttpResponse.json(operation(body.operation_id));}));
 const {node}=setup("task.edit");const {router}=renderApp(`/work/${node.id}?scope=project:${graphProject}`);
 await userEvent.click(await screen.findByRole("button",{name:"Edit task"}));
 await userEvent.click(within(screen.getByRole("dialog")).getByRole("button",{name:"Submit"}));
 await router.navigate(`/knowledge?scope=project:${graphProject}`);await screen.findByRole("heading",{name:"Knowledge",level:1});
 release();await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
 expect(screen.queryByText("Action confirmed",{exact:true})).not.toBeInTheDocument();
});

test("confirmed receipt survives a failed record refresh",async()=>{
 const {node}=setup("task.edit");let reads=0;
 server.use(http.get(`/api/human/projects/${graphProject}/tasks/${node.id}`,()=>++reads===1?HttpResponse.json(graphEnvelope(node)):HttpResponse.json({error:"identity_unavailable",message:"Graph read unavailable"},{status:503})),http.post("/api/v1/actions",async({request})=>HttpResponse.json(operation((await request.json() as {operation_id:string}).operation_id))));
 renderApp(`/work/${node.id}?scope=project:${graphProject}`);await userEvent.click(await screen.findByRole("button",{name:"Edit task"}));
 const dialog=screen.getByRole("dialog",{name:"Edit task"});await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 await waitFor(()=>expect(reads).toBeGreaterThan(1));expect(await within(dialog).findByText("Action confirmed",{exact:true})).toBeVisible();
 expect(screen.getByText(/Showing previously read revision/)).toBeInTheDocument();
});


test.each([["task.edit","Edit task"],["knowledge.correct","Correct record"]])("%s title-only patches preserve legal existing labels",async(kind,label)=>{
 let payload:Record<string,unknown>|undefined;
 server.use(http.post("/api/v1/actions",async({request})=>{const body=await request.json() as {operation_id:string;payload:Record<string,unknown>};payload=body.payload;return HttpResponse.json(operation(body.operation_id));}));
 const {dialog}=await open(kind,label,["ops,critical",...Array.from({length:16},(_,i)=>`label-${i}`)]);
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));await within(dialog).findByText("Action confirmed",{exact:true});
 expect(payload).not.toHaveProperty("labels");
});

test.each(actions.filter(([kind])=>!["task.edit","knowledge.author","knowledge.correct"].includes(kind)))("%s accepts records with 17 existing labels",async(kind,label)=>{
 let posts=0;server.use(http.post("/api/v1/actions",async({request})=>{posts++;return HttpResponse.json(operation((await request.json() as {operation_id:string}).operation_id));}));
 const {dialog}=await open(kind,label,Array.from({length:17},(_,i)=>`label-${i}`));
 await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));await within(dialog).findByText(kind==="task.cancel"?"Cancellation requested":"Action confirmed",{exact:true});expect(posts).toBe(1);
});

test.each(["lookup","exact retry"])("%s receipt retirement preserves uncertainty and the original identity",async(path)=>{
 let id="",posts=0,lookups=0;
 const retired=()=>HttpResponse.json({request_id:"retired",code:"operation_retired",message:"Receipt expired",retryable:false},{status:410});
 server.use(http.post("/api/v1/actions",async({request})=>{id=(await request.json() as {operation_id:string}).operation_id;return ++posts===1?HttpResponse.error():retired();}),http.get("/api/v1/operations/:id",()=>{lookups++;return path==="lookup"?retired():HttpResponse.json({request_id:"lookup",code:"not_found",message:"Not available",retryable:false},{status:404});}));
 const {dialog}=await open("task.edit","Edit task");await userEvent.click(within(dialog).getByRole("button",{name:"Submit"}));
 if(path==="exact retry"){await within(dialog).findByText(/Outcome unknown/);await waitFor(()=>expect(lookups).toBeGreaterThan(0));await userEvent.click(within(dialog).getByRole("button",{name:"Retry exact submission"}));}
 expect(await within(dialog).findByText(/Receipt details expired/)).toBeVisible();
 expect(within(dialog).queryByText(/Rejected/)).not.toBeInTheDocument();expect(within(dialog).queryByRole("button",{name:"Reload current versions"})).not.toBeInTheDocument();expect(within(dialog).queryByRole("button",{name:"Retry exact submission"})).not.toBeInTheDocument();
 await userEvent.click(within(dialog).getByText("Operation reference and receipts"));expect(within(dialog).getByText(id,{exact:true})).toBeVisible();
 await userEvent.click(within(dialog).getByRole("button",{name:"Close action"}));await userEvent.click(screen.getByRole("button",{name:"Edit task · operation"}));expect(within(dialog).queryByRole("button",{name:"Submit"})).not.toBeInTheDocument();
});
