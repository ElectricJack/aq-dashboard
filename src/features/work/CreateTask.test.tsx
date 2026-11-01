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
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));
beforeEach(()=>vi.stubGlobal("crypto",webcrypto));
afterEach(()=>{server.resetHandlers();vi.unstubAllGlobals();});afterAll(()=>server.close());
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
