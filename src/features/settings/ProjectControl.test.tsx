import {webcrypto} from "node:crypto";
import {screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {http,HttpResponse} from "msw";
import {setupServer} from "msw/node";
import {vi} from "vitest";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import {handlersFor} from "../../mocks/handlers";
import {projectRecord} from "../../test/projectBindings";
import {renderApp} from "../../test/renderApp";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal("crypto",webcrypto);});
afterEach(()=>{server.resetHandlers();vi.unstubAllGlobals();});afterAll(()=>server.close());
function fixture(enabled:boolean,configured=true){
 let record=projectRecord();record.binding.enabled=enabled;
 const id=record.binding.project_id;
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>c.name!=="projects.read"),{name:"projects.read",version:"1",enabled:true}]}})),http.get("/api/projects",()=>HttpResponse.json({items:[record],next_cursor:null,execution:configured?{[id]:true}:{}})));
 return {id,get:()=>record,set:(enabled:boolean)=>{record={...record,revision:record.revision+1,binding:{...record.binding,enabled}};return record;}};
}
test("started projects expose Stop and stopped projects can be started without editing configuration",async()=>{
 const f=fixture(true);const bodies:Record<string,unknown>[]=[];
 server.use(http.post(`/api/projects/${f.id}/disable`,async({request})=>{const b=await request.json() as Record<string,unknown>;bodies.push(b);return HttpResponse.json({operation_id:b.operation_id,record:f.set(false),disposition:"disabled"});}),http.post(`/api/projects/${f.id}`,async({request})=>{const b=await request.json() as Record<string,unknown>;bodies.push(b);return HttpResponse.json({operation_id:b.operation_id,record:f.set(true),disposition:"bound"});}));
 renderApp("/settings?tab=projects");
 await userEvent.dblClick(await screen.findByRole("button",{name:"Stop project"}));
 expect(await screen.findByRole("button",{name:"Start project"})).toBeEnabled();expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({expected_revision:2});
 await userEvent.click(screen.getByRole("button",{name:"Start project"}));
 await screen.findByRole("button",{name:"Stop project"});expect(bodies).toHaveLength(2);
 expect(bodies[1]).toMatchObject({expected_revision:3,binding:{...projectRecord().binding,enabled:true}});
 expect(screen.getByText(/running agents may stop at their next policy check/)).toBeVisible();
});
test("projects needing setup remain visible with a reason beside Start",async()=>{
 fixture(false,false);renderApp("/settings?tab=projects");
 expect(await screen.findByRole("button",{name:"Start project"})).toBeDisabled();
 expect(screen.getByText("Worker setup is incomplete for this project.")).toBeVisible();
 expect(screen.getByText("Stopped")).toBeVisible();
});
test("lost replies retain one operation and retry exactly the original change",async()=>{
 const f=fixture(true);const bytes:string[]=[];let receipt:{operation_id:string;record:ReturnType<typeof projectRecord>}|undefined;
 server.use(http.post(`/api/projects/${f.id}/disable`,async({request})=>{bytes.push(await request.text());const b=JSON.parse(bytes[0]!);if(bytes.length===1){receipt={operation_id:b.operation_id,record:f.set(false)};return HttpResponse.error();}return HttpResponse.json(receipt!);}));
 renderApp("/settings?tab=projects");await userEvent.click(await screen.findByRole("button",{name:"Stop project"}));
 await screen.findByText(/The outcome is uncertain/);
 expect(screen.queryByRole("button",{name:"Start project"})).not.toBeInTheDocument();
 await userEvent.click(screen.getByRole("button",{name:"Retry same stop"}));
 await screen.findByRole("button",{name:"Start project"});expect(bytes).toHaveLength(2);expect(bytes[1]).toBe(bytes[0]);expect(f.get().revision).toBe(3);
});
test("revision conflicts keep the current state and give the server explanation",async()=>{
 const f=fixture(true);server.use(http.post(`/api/projects/${f.id}/disable`,()=>HttpResponse.json({error:"conflict",message:"project revision changed"},{status:409})));
 renderApp("/settings?tab=projects");await userEvent.click(await screen.findByRole("button",{name:"Stop project"}));
 expect(await screen.findByText("project revision changed")).toBeVisible();
 expect(screen.getByRole("button",{name:"Stop project"})).toBeEnabled();
});
test("a mismatched response cannot claim that a project was stopped",async()=>{
 const f=fixture(true);server.use(http.post(`/api/projects/${f.id}/disable`,async({request})=>{const b=await request.json() as {operation_id:string};return HttpResponse.json({operation_id:b.operation_id,record:{...f.get(),revision:3}});}));
 renderApp("/settings?tab=projects");await userEvent.click(await screen.findByRole("button",{name:"Stop project"}));
 await waitFor(()=>expect(screen.getByRole("button",{name:"Retry same stop"})).toBeEnabled());
 expect(screen.queryByText("Stop request confirmed.")).not.toBeInTheDocument();
});
