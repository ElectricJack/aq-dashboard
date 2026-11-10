import {webcrypto} from "node:crypto";
import {screen,within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {http,HttpResponse} from "msw";
import {setupServer} from "msw/node";
import {vi} from "vitest";
import {handlersFor} from "../../mocks/handlers";
import {renderApp} from "../../test/renderApp";
import {projectRecord} from "../../test/projectBindings";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));
beforeEach(()=>{sessionStorage.clear();vi.stubGlobal("crypto",webcrypto);});
afterEach(()=>{server.resetHandlers();vi.unstubAllGlobals();});afterAll(()=>server.close());
test("all-project Overview has no project mutation controls or binding reads",async()=>{
 let reads=0;server.use(http.get("/api/projects",()=>{reads++;return HttpResponse.json({items:[],next_cursor:null});}));
 renderApp("/overview");await screen.findByRole("list",{name:"Work counts"});
 expect(screen.queryByRole("region",{name:"Selected project controls"})).not.toBeInTheDocument();expect(reads).toBe(0);
});
test("the selected project can be stopped from Overview using the shared exact request",async()=>{
 let record=projectRecord();const id=record.binding.project_id;const requests:unknown[]=[];
 server.use(http.get("/api/projects",()=>HttpResponse.json({items:[record],next_cursor:null,execution:{[id]:true}})),http.post(`/api/projects/${id}/disable`,async({request})=>{
   const body=await request.json() as {operation_id:string};requests.push(body);record={...record,revision:3,binding:{...record.binding,enabled:false}};
   return HttpResponse.json({operation_id:body.operation_id,record});
 }));
 renderApp(`/overview?scope=project:${id}`);const region=await screen.findByRole("region",{name:"Selected project controls"});
 await userEvent.dblClick(await within(region).findByRole("button",{name:"Stop project"}));
 expect(await within(region).findByRole("button",{name:"Start project"})).toBeEnabled();expect(requests).toHaveLength(1);
 expect(requests[0]).toMatchObject({expected_revision:2});expect(within(region).getByText("Stopped")).toBeVisible();
});
test("selected projects beyond the first page get their own controls",async()=>{
 const records=Array.from({length:26},(_,n)=>projectRecord(n+1));const target=records[25]!;target.binding.enabled=false;const afters:(string|null)[]=[];
 server.use(http.get("/api/projects",({request})=>{
  const after=new URL(request.url).searchParams.get("after");afters.push(after);
  return HttpResponse.json({items:after?[target]:records.slice(0,25),next_cursor:after?null:records[24]!.binding.project_id,execution:{[target.binding.project_id]:true}});
 }));
 renderApp(`/overview?scope=project:${target.binding.project_id}`);const region=await screen.findByRole("region",{name:"Selected project controls"});
 expect(await within(region).findByRole("button",{name:"Start project"})).toBeEnabled();
 expect(within(region).getByRole("heading",{name:/Project 26/})).toBeVisible();expect(afters).toEqual([null,records[24]!.binding.project_id]);
});
test("scope changes discard the former project's controls and explain missing setup",async()=>{
 const first=projectRecord(),second=projectRecord(2);second.binding.enabled=false;
 server.use(http.get("/api/projects",()=>HttpResponse.json({items:[first,second],next_cursor:null,execution:{[first.binding.project_id]:true}})));
 const {router}=renderApp(`/overview?scope=project:${first.binding.project_id}`);
 await screen.findByRole("button",{name:"Stop project"});
 await router.navigate(`/overview?scope=project:${second.binding.project_id}`);
 const region=await screen.findByRole("region",{name:"Selected project controls"});
 expect(await within(region).findByRole("button",{name:"Start project"})).toBeDisabled();
 expect(within(region).queryByRole("button",{name:"Stop project"})).not.toBeInTheDocument();
 expect(within(region).getByText("Worker setup is incomplete for this project.")).toBeVisible();
});
