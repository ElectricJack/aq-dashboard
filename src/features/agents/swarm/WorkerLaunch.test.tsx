import {createHash,webcrypto} from "node:crypto";
import {screen,within,waitFor,fireEvent} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {http,HttpResponse} from "msw";
import {setupServer} from "msw/node";
import {vi} from "vitest";
import bootstrap from "../../../../contracts/proposed/bootstrap.json";
import {handlersFor} from "../../../mocks/handlers";
import {renderApp} from "../../../test/renderApp";
import {stubReactFlowDom} from "../../../test/reactFlow";
import {SWARM_MOCKUP,swarmEnvelope} from "../../../mocks/swarm";
import {graphProject,graphId} from "../../../test/humanGraph";
import {confirmedTaskOperation,taskActor} from "../../../test/taskCreate";
const server=setupServer(...handlersFor("default",{fixtures:true}));
let restore:()=>void;
beforeAll(()=>{restore=stubReactFlowDom();server.listen({onUnhandledFrame:"error"});});
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal("crypto",webcrypto);});
afterEach(()=>{server.resetHandlers();vi.unstubAllGlobals();});afterAll(()=>{server.close();restore();});
const node=SWARM_MOCKUP.machines[0]!.nodes[0]!;
function enable(allowed=true){
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,principal:{...bootstrap.data.principal,id:taskActor},capabilities:[...bootstrap.data.capabilities.filter(c=>!["tasks.create","swarm.read","terminal.watch","terminal.control"].includes(c.name)),{name:"tasks.create",version:"1",enabled:allowed,reason:"Owner required"},{name:"swarm.read",version:"1",enabled:true},{name:"terminal.watch",version:"1",enabled:true},{name:"terminal.control",version:"1",enabled:false,reason:"Watch only"}]}})));
 server.use(http.get("/api/human/workers/:node/launch-projects",()=>HttpResponse.json({projects:[{id:graphProject,revision:"9007199254740993"}]})));
}
function receipt(bytes:string){const id=JSON.parse(bytes).operation_id as string;return confirmedTaskOperation({operation_id:id,task_id:id,request_digest:`sha256:${createHash("sha256").update(bytes).digest("hex")}`,receipt:{...confirmedTaskOperation().receipt!,task_id:id}});}
async function open(){await userEvent.click(await screen.findByRole("button",{name:"Launch agent"}));return screen.getByRole("dialog",{name:"Launch agent"});}
test("launch targets the selected worker once, then offers its actual terminal",async()=>{
 enable();let bytes="";let posts=0;
 server.use(http.post(`/api/human/projects/${graphProject}/workers/${node.node.id}/launch`,async({request})=>{posts++;bytes=await request.text();return HttpResponse.json(receipt(bytes));}));
 const {queryClient}=renderApp(`/agents?select=node:${node.node.id}`);const modal=await open();
 await userEvent.type(within(modal).getByRole("textbox"),"Inspect the scratch project");
 await waitFor(()=>expect(within(modal).getByRole("button",{name:`Launch on ${node.name}`})).toBeEnabled());
 await userEvent.dblClick(within(modal).getByRole("button",{name:`Launch on ${node.name}`}));
 await within(modal).findByText(/Launch queued on this worker/);expect(posts).toBe(1);
 expect(JSON.parse(bytes)).toMatchObject({expected_project_revision:"9007199254740993",task_state:"active",body:"Inspect the scratch project"});
 const started={...node.agents[0]!,session_id:graphId(99),task:{id:JSON.parse(bytes).operation_id,title:"Inspect the scratch project"}};
 server.use(http.get("/api/v1/swarm",()=>HttpResponse.json(swarmEnvelope({...SWARM_MOCKUP,machines:SWARM_MOCKUP.machines.map(m=>({...m,nodes:m.nodes.map(n=>n.node.id===node.node.id?{...n,agents:[started]}:n)}))}))));
 await queryClient.invalidateQueries({predicate:q=>JSON.stringify(q.queryKey).includes('swarm')});
 const terminal=await within(modal).findByRole("link",{name:"Open agent terminal"});
 expect(terminal).toHaveAttribute("href",`/agents?select=agent%3A${graphId(99)}`);
 await userEvent.click(terminal);
 expect(await screen.findByRole("region",{name:"Agent terminal"})).toBeInTheDocument();
});
test("lost response retains exact intent across closing the pane and never silently resubmits",async()=>{
 enable();const sent:string[]=[];
 server.use(http.post(`/api/human/projects/${graphProject}/workers/${node.node.id}/launch`,async({request})=>{sent.push(await request.text());return HttpResponse.error();}),http.get("/api/human/operations/:id",()=>HttpResponse.json(receipt(sent[0]!))));
 renderApp(`/agents?select=node:${node.node.id}`);let modal=await open();
 await userEvent.type(within(modal).getByRole("textbox"),"Inspect only");
 await waitFor(()=>expect(within(modal).getByRole("button",{name:`Launch on ${node.name}`})).toBeEnabled());
 fireEvent.click(within(modal).getByRole("button",{name:`Launch on ${node.name}`}));
 await within(modal).findByText(/Launch outcome is uncertain/);
 await userEvent.click(within(modal).getByRole("button",{name:"Close"}));modal=await open();
 await userEvent.click(within(modal).getByRole("button",{name:"Check status"}));
 await within(modal).findByText(/Launch queued on this worker/);expect(sent).toHaveLength(1);
});
test("owners cannot submit through a disabled capability",async()=>{
 enable(false);renderApp(`/agents?select=node:${node.node.id}`);
 expect(await screen.findByRole("button",{name:"Launch agent"})).toBeDisabled();
});
