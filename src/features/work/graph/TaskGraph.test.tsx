import { render, screen, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../../mocks/handlers";
import { fixtureProject, fixtureTasks } from "../../../mocks/humanGraph";
import { renderApp } from "../../../test/renderApp";
import { TaskGraphCanvas } from "./HumanTaskGraph";
import { layoutGraph } from "./layout";
const server=setupServer(...handlersFor("default"));beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>{server.resetHandlers();vi.restoreAllMocks();});afterAll(()=>server.close());
const scope=`?scope=project:${fixtureProject.id}`,root=fixtureTasks[0]!.id;
test("switching to Graph roots the served neighborhood at the selection",async()=>{
 const {router}=renderApp(`/work/${root}${scope}`);await screen.findByRole("heading",{name:fixtureTasks[0]!.title});await userEvent.click(screen.getByRole("button",{name:"Graph"}));await screen.findByRole("region",{name:"Dependency graph"});expect(new URLSearchParams(router.state.location.search).get("root")).toBe(root);
});
test("Graph keeps a bounded navigation workspace and textual relationships",async()=>{
 renderApp(`/work/${root}${scope}&view=graph`);const region=await screen.findByRole("region",{name:"Dependency graph"});const canvas=await within(region).findByRole("region",{name:"Scrollable task graph"});await within(canvas).findByRole("link",{name:new RegExp(fixtureTasks[1]!.title)});expect(within(canvas).getAllByRole("link").length).toBeGreaterThan(1);expect(canvas).toHaveAttribute("tabindex","0");
 const relation=within(region).getByText((_,el)=>el?.tagName==="LI"&&el.textContent===`${fixtureTasks[0]!.title} must finish before ${fixtureTasks[1]!.title}`);expect(within(relation).getByRole("link",{name:fixtureTasks[1]!.title})).toHaveAttribute("href",expect.stringContaining(`/work/${fixtureTasks[1]!.id}`));
 expect(within(region).getByRole("list",{name:"Edge types"})).toHaveTextContent("prerequisite to dependent");
 for(const path of canvas.querySelectorAll("svg path[data-edge-type]"))expect(path.getAttribute("marker-end")).toMatch(/^url\(#.+\)$/);
});
test("selecting a graph node retains root and stable node positions",async()=>{
 vi.spyOn(window,"matchMedia").mockReturnValue({matches:true,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList);
 const {router}=renderApp(`/work/${root}${scope}&view=graph&root=${root}`);const canvas=await screen.findByRole("region",{name:"Scrollable task graph"});const link=await within(canvas).findByRole("link",{name:new RegExp(fixtureTasks[1]!.title)});const position=link.getAttribute("style");await userEvent.click(link);await waitFor(()=>expect(router.state.location.pathname).toBe(`/work/${fixtureTasks[1]!.id}`));expect(new URLSearchParams(router.state.location.search).get("root")).toBe(root);expect(within(await screen.findByRole("region",{name:"Scrollable task graph"})).getByRole("link",{name:new RegExp(fixtureTasks[1]!.title)})).toHaveAttribute("style",position!);
});
test("truncated served neighborhood is explicit",async()=>{server.use(...handlersFor("partial"));renderApp(`/work/${root}${scope}&view=graph`);expect(await screen.findByText(/More relationships exist on the server/)).toBeVisible();});
test("graph without a selection roots on the first loaded task and keeps a way back to the list",async()=>{renderApp(`/work${scope}&view=graph`);const canvas=await screen.findByRole("region",{name:"Scrollable task graph"});expect(within(canvas).getAllByRole("link").length).toBeGreaterThan(0);expect(screen.queryByText(/Select a task from the list/)).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"List"})).toHaveAttribute("aria-pressed","false");});
test("zoom buttons and keys change the canvas scale",async()=>{
 renderApp(`/work/${root}${scope}&view=graph&root=${root}`);const canvas=await screen.findByRole("region",{name:"Scrollable task graph"});const stage=()=>canvas.querySelector("[data-scale]")!;
 await within(canvas).findAllByRole("link");expect(stage()).toHaveStyle({transform:"scale(1)"});
 await userEvent.click(screen.getByRole("button",{name:"Zoom in"}));expect(stage()).toHaveStyle({transform:"scale(1.25)"});expect(screen.getByRole("status",{name:"Zoom level"})).toHaveTextContent("125%");
 await userEvent.click(screen.getByRole("button",{name:"Zoom out"}));await userEvent.click(screen.getByRole("button",{name:"Zoom out"}));expect(stage()).toHaveStyle({transform:"scale(0.75)"});
 canvas.focus();await userEvent.keyboard("0");expect(stage()).toHaveStyle({transform:"scale(1)"});await userEvent.keyboard("+");expect(stage()).toHaveStyle({transform:"scale(1.25)"});await userEvent.keyboard("-");expect(stage()).toHaveStyle({transform:"scale(1)"});
});
test("full screen falls back to an in-page view that Escape closes",async()=>{
 renderApp(`/work/${root}${scope}&view=graph&root=${root}`);const canvas=await screen.findByRole("region",{name:"Scrollable task graph"});await within(canvas).findAllByRole("link");
 await userEvent.click(screen.getByRole("button",{name:"Full screen"}));expect(canvas.parentElement).toHaveAttribute("data-fullscreen","page");
 await userEvent.keyboard("{Escape}");expect(canvas.parentElement).not.toHaveAttribute("data-fullscreen");expect(screen.getByRole("button",{name:"Full screen"})).toBeVisible();
});
test("a 120-node graph states the client cap, its hidden relationships and offers expansion",()=>{
 // The served neighborhood is bounded at 64 tasks (contracts/live/human-graph), so the 100-node client cap is exercised directly.
 const ids=Array.from({length:120},(_,i)=>`t${String(i).padStart(3,"0")}`);
 const edges=ids.slice(1).map((id,i)=>({id:`e${i}`,from:ids[0]!,to:id,type:"parent-child"}));
 const layout=layoutGraph({rootId:ids[0]!,nodes:ids.map(id=>({id,revision:"1",title:`Fixture task ${id}`,state:"active",readiness:{state:"unsupported",explanation:""}})),edges:edges.map(e=>({...e,category:"hierarchy"})),omitted:{nodes:0,edges:0,reason:null}});
 render(<MemoryRouter><TaskGraphCanvas layout={layout} tasks={ids.map(id=>({id,title:`Fixture task ${id}`,state:"active"}))} relations={edges} truncated root={ids[0]!} selected={ids[5]} linkTo={id=>`/work/${id}`} expandTo={`/work/${ids[5]}?root=${ids[5]}`}/></MemoryRouter>);
 expect(screen.getByText("100 of 120 tasks shown · 20 relationships hidden by the 100-node limit · More relationships exist on the server")).toBeVisible();
 expect(screen.getByRole("link",{name:"Expand around selected task"})).toHaveAttribute("href",`/work/${ids[5]}?root=${ids[5]}`);
 expect(screen.getByRole("list",{name:"Edge types"})).toHaveTextContent("parent to child task");
});
