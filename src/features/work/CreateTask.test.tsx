import {createHash,webcrypto} from "node:crypto";
import {act,screen,within,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {http,HttpResponse} from "msw";
import {setupServer} from "msw/node";
import {vi} from "vitest";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import {handlersFor} from "../../mocks/handlers";
import {renderApp} from "../../test/renderApp";
import {graphEnvelope,graphId,graphNode,graphProject} from "../../test/humanGraph";
import {confirmedTaskOperation,taskActor,taskOperation,taskOperationId} from "../../test/taskCreate";
import type {TaskOperation} from "../../api/adapters/taskCreate";
import * as apiClient from "../../api/client";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));
afterEach(()=>{server.resetHandlers();vi.unstubAllGlobals();vi.restoreAllMocks();});afterAll(()=>server.close());
const scope=`?scope=project:${graphProject}`;
function enable(allowed=true){
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,principal:{...bootstrap.data.principal,id:taskActor},capabilities:[...bootstrap.data.capabilities.filter(c=>!["human.graph.read","tasks.create"].includes(c.name)),{name:"human.graph.read",version:"1",enabled:true},{name:"tasks.create",version:"1",enabled:allowed,reason:"Owner role required"}]}})));
 server.use(http.get(`/api/human/projects/${graphProject}/tasks`,()=>HttpResponse.json(graphEnvelope({items:[],next_cursor:null},"9007199254740993"))));
}
function forBytes(bytes:string,state:TaskOperation["state"]="confirmed"){
 const body=JSON.parse(bytes) as {operation_id:string};
 const common={operation_id:body.operation_id,task_id:body.operation_id,request_digest:`sha256:${createHash("sha256").update(bytes).digest("hex")}`};
 return state==="confirmed"?confirmedTaskOperation({...common,receipt:{...confirmedTaskOperation().receipt!,task_id:body.operation_id}}):taskOperation({...common,state,...(state==="conflict"?{effect:"not_dispatched" as const,recovery:{allowed:false,reason:"project_binding_changed_before_dispatch"}}:{})});
}
async function open(){await userEvent.click(await screen.findByRole("button",{name:"Create task"}));const modal=screen.getByRole("dialog",{name:"Create task"});await waitFor(()=>expect(within(modal).getByRole("button",{name:"Create task"})).toBeEnabled());return modal;}
async function fill(modal:HTMLElement,title="Create the recovery boundary"){
 await userEvent.type(within(modal).getByRole("textbox",{name:"Title"}),title);
 await userEvent.type(within(modal).getByRole("textbox",{name:"Description"}),"Keep the original request.");
 await userEvent.type(within(modal).getByRole("textbox",{name:"Acceptance criteria"}),"Lost responses must be recoverable.");
}
test("project scope and explicit Owner capability are required before any creation",async()=>{
 enable(false);let writes=0;server.use(http.post("/api/human/projects/:project/tasks",()=>{writes++;return HttpResponse.json({});}));
 renderApp(`/work${scope}`);expect(await screen.findByRole("button",{name:"Create task"})).toBeDisabled();expect(screen.getByText("Owner role required")).toBeInTheDocument();expect(writes).toBe(0);
});
test("all-project scope disables creation instead of guessing a project",async()=>{
 enable();renderApp("/work");expect(await screen.findByRole("button",{name:"Create task"})).toBeDisabled();expect(screen.getByText("Choose a project first")).toBeInTheDocument();
});
test("submits once with exact project revision and verifies receipt plus actual task read",async()=>{
 enable();const sent:string[]=[];let id="";
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{const bytes=await request.text();sent.push(bytes);const value=forBytes(bytes);id=value.task_id;return HttpResponse.json(value);}),http.get(`/api/human/projects/${graphProject}/tasks/:task`,({params})=>HttpResponse.json(graphEnvelope({...graphNode("task"),id:String(params.task),title:"Created recovery task"}))));
 const {router}=renderApp(`/work${scope}`);const modal=await open();await fill(modal);
 await userEvent.dblClick(within(modal).getByRole("button",{name:"Create task"}));
 expect(await within(modal).findByText("Task created and its record verified.")).toBeInTheDocument();expect(sent).toHaveLength(1);
 expect(JSON.stringify(sessionStorage)).not.toContain("Create the recovery boundary");
 expect(JSON.parse(sent[0]!)).toMatchObject({operation_id:id,expected_project_revision:"9007199254740993",title:"Create the recovery boundary",body:"Keep the original request.",acceptance_criteria:"Lost responses must be recoverable.",labels:[],task_state:"draft"});
 expect(new URLSearchParams(router.state.location.search).get("operation")).toBe(id);expect(router.state.location.search).not.toContain("recovery");
 expect(within(modal).getByRole("link",{name:"Open created task"})).toHaveAttribute("href",`/work/${id}?scope=project%3A${graphProject}`);
 await userEvent.click(within(modal).getByRole("button",{name:"Start another task"}));expect(within(modal).getByRole("textbox",{name:"Title"})).toHaveValue("");
});
test("typed revision conflict preserves draft and a deliberate revision allocates a new operation",async()=>{
 enable();const sent:string[]=[];
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{const bytes=await request.text();sent.push(bytes);return HttpResponse.json(forBytes(bytes,"conflict"),{status:409});}));
 renderApp(`/work${scope}`);const modal=await open();await fill(modal);await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));
 await within(modal).findByText("Task creation conflicted. Your draft is preserved.");expect(within(modal).getByRole("textbox",{name:"Title"})).toBeDisabled();expect(within(modal).getByRole("textbox",{name:"Title"})).toHaveValue("Create the recovery boundary");
 await userEvent.click(within(modal).getByRole("button",{name:"Revise draft"}));const title=within(modal).getByRole("textbox",{name:"Title"});expect(title).toHaveValue("Create the recovery boundary");await userEvent.type(title," revised");
 await waitFor(()=>expect(within(modal).getByRole("button",{name:"Create task"})).toBeEnabled());await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await waitFor(()=>expect(sent).toHaveLength(2));
 expect(JSON.parse(sent[0]!).operation_id).not.toBe(JSON.parse(sent[1]!).operation_id);
});
test("response loss and lookup404 keep the frozen request and only retry identical bytes",async()=>{
 enable();const sent:string[]=[];
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{sent.push(await request.text());return HttpResponse.error();}),http.get("/api/human/operations/:operation",()=>HttpResponse.json({error:"not_found"},{status:404})));
 renderApp(`/work${scope}`);const modal=await open();await fill(modal);await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await within(modal).findByRole("button",{name:"Retry exact submission"});
 expect(within(modal).queryByRole("button",{name:"Revise draft"})).not.toBeInTheDocument();await userEvent.click(within(modal).getByRole("button",{name:"Check status"}));await within(modal).findByText(/outcome is not confirmed/);
 await userEvent.click(within(modal).getByRole("button",{name:"Retry exact submission"}));await waitFor(()=>expect(sent).toHaveLength(2));expect(sent[1]).toBe(sent[0]);expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();
});
test("reload uses pure lookup and explicit retained-request recovery without reconstructing content",async()=>{
 enable();let creates=0,recoveries=0,lookups=0;
 server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>{lookups++;return HttpResponse.json(taskOperation({state:"unknown",effect:"possible"}));}),http.post(`/api/human/operations/${taskOperationId}/recover`,async({request})=>{recoveries++;expect(await request.text()).toBe("{}");return HttpResponse.json(confirmedTaskOperation());}),http.post(`/api/human/projects/${graphProject}/tasks`,()=>{creates++;return HttpResponse.json({});}),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>HttpResponse.json(graphEnvelope({...graphNode("task"),id:taskOperationId}))));
 renderApp(`/work${scope}&operation=${taskOperationId}`);const modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByRole("button",{name:"Recover retained request"});expect(lookups).toBe(1);expect(creates).toBe(0);expect(recoveries).toBe(0);expect(within(modal).queryByRole("textbox",{name:"Title"})).not.toBeInTheDocument();
 await userEvent.click(within(modal).getByRole("button",{name:"Recover retained request"}));await within(modal).findByText("Task created and its record verified.");expect(recoveries).toBe(1);expect(creates).toBe(0);
});
test("confirmed receipt survives unavailable current task view without claiming creation failed",async()=>{
 enable();server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>HttpResponse.json({error:"source_unavailable"},{status:503})));
 renderApp(`/work${scope}&operation=${taskOperationId}`);const modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByText(/creation receipt is confirmed, but the task record could not be read/);
 expect(within(modal).getByText("Task creation receipt confirmed.")).toBeInTheDocument();expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();expect(within(modal).queryByRole("button",{name:"Retry exact submission"})).not.toBeInTheDocument();expect(within(modal).queryByRole("button",{name:"Revise draft"})).not.toBeInTheDocument();
});
test("operation/request mismatch never unlocks a changed request under the same ID",async()=>{
 enable();server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{const value=forBytes(await request.text(),"conflict");return HttpResponse.json({...value,request_digest:`sha256:${"b".repeat(64)}`},{status:409});}));
 renderApp(`/work${scope}`);const modal=await open();await fill(modal);await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await within(modal).findByText(/outcome is not confirmed/);
 expect(within(modal).getByRole("textbox",{name:"Title"})).toBeDisabled();expect(within(modal).queryByRole("button",{name:"Revise draft"})).not.toBeInTheDocument();expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();
});
test("identity change removes private draft and ignores a delayed prior-owner result",async()=>{
 enable();let release=()=>{};let posted=false;const held=new Promise<void>(resolve=>{release=resolve;});
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{const bytes=await request.text();posted=true;await held;return HttpResponse.json(forBytes(bytes));}),http.get("/api/human/operations/:operation",()=>HttpResponse.json({error:"not_found"},{status:404})));
 const {queryClient}=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Private original-owner draft");await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await waitFor(()=>expect(posted).toBe(true));
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,principal:{...bootstrap.data.principal,id:graphId(93),authorization_revision:"2"},capabilities:[...bootstrap.data.capabilities,{name:"human.graph.read",version:"1",enabled:true},{name:"tasks.create",version:"1",enabled:true}]}})));
 await act(async()=>{await queryClient.invalidateQueries({queryKey:["bootstrap"]});});release();
 await waitFor(()=>expect(screen.queryByDisplayValue("Private original-owner draft")).not.toBeInTheDocument());const restored=await screen.findByRole("dialog",{name:"Task operation"});await within(restored).findByText(/outcome is not confirmed/);expect(within(restored).queryByRole("textbox",{name:"Title"})).not.toBeInTheDocument();expect(within(restored).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();
});
test("opening the confirmed task closes the modal and leaves a fresh composer",async()=>{
 enable();server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>HttpResponse.json(graphEnvelope({...graphNode("task"),id:taskOperationId,title:"Actual created record"}))));
 const {router}=renderApp(`/work${scope}&operation=${taskOperationId}`);const modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByText("Task created and its record verified.");await userEvent.click(within(modal).getByRole("link",{name:"Open created task"}));
 await screen.findByRole("heading",{name:"Actual created record"});expect(router.state.location.pathname).toBe(`/work/${taskOperationId}`);expect(screen.queryByRole("dialog")).not.toBeInTheDocument();const fresh=await open();expect(within(fresh).getByRole("textbox",{name:"Title"})).toHaveValue("");expect(within(fresh).queryByRole("region",{name:"Task creation status"})).not.toBeInTheDocument();
});
test("operation URL Back/Forward never combines confirmed A with unknown B",async()=>{
 enable();const other=graphId(94);let writes=0;
 server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/operations/${other}`,()=>HttpResponse.json(taskOperation({operation_id:other,task_id:other,state:"unknown",effect:"possible"}))),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>HttpResponse.json(graphEnvelope({...graphNode("task"),id:taskOperationId}))),http.post("/api/human/projects/:project/tasks",()=>{writes++;return HttpResponse.json({});}));
 const {router}=renderApp(`/work${scope}&operation=${taskOperationId}`);await screen.findByText("Task created and its record verified.");
 await act(async()=>{await router.navigate(`/work${scope}&operation=${other}`);});let modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByText("Task creation outcome is uncertain.");
 expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();expect(within(modal).queryByRole("button",{name:"Start another task"})).not.toBeInTheDocument();expect(within(modal).getByRole("button",{name:"Recover retained request"})).toBeInTheDocument();expect(within(modal).queryByText(taskOperationId,{exact:true})).not.toBeInTheDocument();
 await act(async()=>{await router.navigate(-1);});await screen.findByText("Task created and its record verified.");await act(async()=>{await router.navigate(1);});modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByText("Task creation outcome is uncertain.");expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();expect(writes).toBe(0);
});
test("external operation URL replaces frozen A without resubmitting or presenting its draft as B",async()=>{
 enable();const other=graphId(94);let writes=0;
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{writes++;return HttpResponse.json(forBytes(await request.text(),"pending"),{status:202});}),http.get(`/api/human/operations/${other}`,()=>HttpResponse.json(taskOperation({operation_id:other,task_id:other,state:"unknown",effect:"possible"}))));
 const {router}=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Frozen A private draft");await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await within(modal).findByText("Task creation is pending.");
 await act(async()=>{await router.navigate(`/work${scope}&operation=${other}`);});const current=await screen.findByRole("dialog",{name:"Task operation"});await within(current).findByText("Task creation outcome is uncertain.");expect(within(current).queryByRole("textbox",{name:"Title"})).not.toBeInTheDocument();expect(screen.queryByDisplayValue("Frozen A private draft")).not.toBeInTheDocument();expect(within(current).getByRole("button",{name:"Recover retained request"})).toBeInTheDocument();expect(writes).toBe(1);
});
test("late confirmed A task read cannot repopulate B or clear B busy state",async()=>{
 enable();const other=graphId(94);let releaseA:(v:unknown)=>void=()=>{},releaseB=()=>{};let aRead=false,bRead=false;
 const heldA=new Promise<unknown>(resolve=>{releaseA=resolve;}),heldB=new Promise<void>(resolve=>{releaseB=resolve;});const original=apiClient.apiGet;
 vi.spyOn(apiClient,"apiGet").mockImplementation((path,signal)=>{if(path===`/api/human/projects/${graphProject}/tasks/${taskOperationId}`){aRead=true;return heldA;}return original(path,signal);});
 server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/operations/${other}`,async()=>{bRead=true;await heldB;return HttpResponse.json(taskOperation({operation_id:other,task_id:other,state:"unknown",effect:"possible"}));}));
 const {router}=renderApp(`/work${scope}&operation=${taskOperationId}`);await waitFor(()=>expect(aRead).toBe(true));await act(async()=>{await router.navigate(`/work${scope}&operation=${other}`);});await waitFor(()=>expect(bRead).toBe(true));
 await act(async()=>{releaseA(graphEnvelope({...graphNode("task"),id:taskOperationId}));await heldA;});const modal=screen.getByRole("dialog",{name:"Task operation"});expect(within(modal).getByRole("button",{name:"Check status"})).toBeDisabled();expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();releaseB();await within(modal).findByText("Task creation outcome is uncertain.");expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();
});
test.each([401])("denied submission %i clears private state and stays latched when bootstrap is unreachable",async(code)=>{
 enable();let writes=0;
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,()=>{writes++;server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({error:"unreachable"},{status:503})));return HttpResponse.json({error:"denied"},{status:code});}));
 const {router,queryClient}=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Private denied draft");await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await screen.findByRole("heading",{name:code===401?"Sign in required":"Access denied"});await waitFor(()=>expect(queryClient.getQueryState(["bootstrap"])?.status).toBe("error"));
 expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(screen.queryByDisplayValue("Private denied draft")).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Retry exact submission"})).not.toBeInTheDocument();expect(new URLSearchParams(router.state.location.search).get("operation")).toBeTruthy();await act(async()=>{await router.navigate("/work");});expect(screen.getByRole("heading",{name:code===401?"Sign in required":"Access denied"})).toBeInTheDocument();expect(writes).toBe(1);
});
test("denied current-record read clears confirmed receipt even if bootstrap refresh fails",async()=>{
 enable();server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>{server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({error:"unreachable"},{status:503})));return HttpResponse.json({error:"denied"},{status:403});}));
 const {queryClient}=renderApp(`/work${scope}&operation=${taskOperationId}`);await screen.findByRole("heading",{name:"Access not confirmed"});await waitFor(()=>expect(queryClient.getQueryState(["bootstrap"])?.status).toBe("error"));expect(screen.queryByRole("dialog")).not.toBeInTheDocument();expect(screen.queryByText(confirmedTaskOperation().request_digest)).not.toBeInTheDocument();expect(screen.queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();expect(screen.queryByRole("button",{name:"Start another task"})).not.toBeInTheDocument();
});
test("WD-05: a 403 on Create task is refused in the dialog, keeps the draft and the shell, and allows a new submission",async()=>{
 enable();let writes=0;const ids:string[]=[];
 server.use(http.post(`/api/human/projects/${graphProject}/tasks`,async({request})=>{writes++;ids.push(String(((await request.json()) as {operation_id?:string}).operation_id));return HttpResponse.json({error:"csrf_rejected",message:"request origin is not allowed"},{status:403});}));
 const {router}=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Draft kept after a refusal");
 await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));
 expect(await within(modal).findByText(/AQ refused this request; no task was created\..*Your draft is preserved\./)).toBeInTheDocument();
 expect(screen.queryByRole("heading",{name:/Access denied|Access not confirmed/})).not.toBeInTheDocument();
 expect(screen.getByRole("navigation",{name:"Primary"})).toBeInTheDocument();
 expect(within(modal).getByDisplayValue("Draft kept after a refusal")).toBeInTheDocument();
 expect(new URLSearchParams(router.state.location.search).get("operation")).toBeNull();
 await waitFor(()=>expect(within(modal).getByRole("button",{name:"Create task"})).toBeEnabled());
 await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await waitFor(()=>expect(writes).toBe(2));
 expect(ids[0]).not.toBe(ids[1]);expect(JSON.stringify(sessionStorage)).toMatch(/Draft kept after a refusal/);
});
test("a 403 whose bootstrap re-check fails holds the app closed without erasing drafts",async()=>{
 enable();server.use(http.post(`/api/human/projects/${graphProject}/tasks`,()=>{server.use(http.get("/api/v1/bootstrap",()=>new HttpResponse(null,{status:503})));return new HttpResponse(null,{status:403});}));
 renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Current private task");
 await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));
 await screen.findByRole("heading",{name:"Access not confirmed"});expect(screen.queryByDisplayValue("Current private task")).not.toBeInTheDocument();
 expect(JSON.stringify(sessionStorage)).toMatch(/Current private task/);
});
test("a new unknown observation for the same operation clears its previously verified task",async()=>{
 enable();let unknown=false;server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(unknown?taskOperation({state:"unknown",effect:"possible"}):confirmedTaskOperation())),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>HttpResponse.json(graphEnvelope({...graphNode("task"),id:taskOperationId}))));
 renderApp(`/work${scope}&operation=${taskOperationId}`);const modal=await screen.findByRole("dialog",{name:"Task operation"});await within(modal).findByText("Task created and its record verified.");unknown=true;await userEvent.click(within(modal).getByRole("button",{name:"Check status"}));await within(modal).findByText("Task creation outcome is uncertain.");expect(within(modal).queryByRole("link",{name:"Open created task"})).not.toBeInTheDocument();expect(within(modal).queryByRole("button",{name:"Start another task"})).not.toBeInTheDocument();
});
test("426 task creation keeps the stored draft and blocks further creation without hiding navigation",async()=>{
 enable();let writes=0;server.use(http.post(`/api/human/projects/${graphProject}/tasks`,()=>{writes++;return new HttpResponse(null,{status:426});}));
 const app=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Upgrade-safe task draft");await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));
 await waitFor(()=>expect(screen.queryByRole("dialog")).not.toBeInTheDocument());expect(screen.getByRole("button",{name:"Create task"})).toBeDisabled();expect(screen.getByRole("navigation",{name:"Primary"})).toBeInTheDocument();
 expect(screen.getByRole("note",{name:"Dashboard version"})).toHaveTextContent("Install compatible versions, then reload.");expect(JSON.stringify(sessionStorage)).toContain("Upgrade-safe task draft");expect(writes).toBe(1);
 app.unmount();app.queryClient.clear();renderApp(`/work${scope}`);const restored=await open();expect(within(restored).getByRole("textbox",{name:"Title"})).toHaveValue("Upgrade-safe task draft");expect(writes).toBe(1);
});
test.each([401])("direct task %i erases every composer draft even when bootstrap fails",async code=>{
 enable();server.use(http.post(`/api/human/projects/${graphProject}/tasks`,()=>{server.use(http.get("/api/v1/bootstrap",()=>new HttpResponse(null,{status:503})));return new HttpResponse(null,{status:code});}));
 renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Current private task");
 sessionStorage.setItem('aq.dashboard.draft:["other-project","1","task-create:other"]','"Other private task"');sessionStorage.setItem('aq.dashboard.draft:["owner","1","supervisor-global"]','"Private supervisor draft"');
 await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await waitFor(()=>expect(JSON.stringify(sessionStorage)).not.toMatch(/private task|Private supervisor/));
});
test("task verification 426 disables the dependent creation workflow with upgrade guidance",async()=>{
 enable();server.use(http.get(`/api/human/operations/${taskOperationId}`,()=>HttpResponse.json(confirmedTaskOperation())),http.get(`/api/human/projects/${graphProject}/tasks/${taskOperationId}`,()=>new HttpResponse(null,{status:426})));
 renderApp(`/work${scope}&operation=${taskOperationId}`);expect(await screen.findByRole("note",{name:"Dashboard version"})).toHaveTextContent("Install compatible versions, then reload.");expect(screen.getByRole("button",{name:"Create task"})).toBeDisabled();expect(screen.getByRole("navigation",{name:"Primary"})).toBeInTheDocument();
});
test("uncertain operation reload exposes recovered local fields without replaying or enabling submission",async()=>{
 enable();let writes=0;server.use(http.post(`/api/human/projects/${graphProject}/tasks`,()=>{writes++;return HttpResponse.error();}),http.get("/api/human/operations/:operation",()=>HttpResponse.json({error:"not_found"},{status:404})));
 const app=renderApp(`/work${scope}`);const modal=await open();await fill(modal,"Recovered uncertain draft");await userEvent.click(within(modal).getByRole("button",{name:"Create task"}));await within(modal).findByRole("button",{name:"Retry exact submission"});const path=app.router.state.location.pathname+app.router.state.location.search;app.unmount();app.queryClient.clear();
 renderApp(path);const restored=await screen.findByRole("dialog",{name:"Task operation"});expect(await within(restored).findByRole("textbox",{name:"Title"})).toHaveValue("Recovered uncertain draft");expect(within(restored).getByRole("textbox",{name:"Title"})).toHaveAttribute("readonly");expect(within(restored).queryByRole("button",{name:"Retry exact submission"})).not.toBeInTheDocument();expect(writes).toBe(1);
});
