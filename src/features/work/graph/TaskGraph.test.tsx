import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../../mocks/handlers";
import { fixtureProject, fixtureTasks } from "../../../mocks/humanGraph";
import { renderApp } from "../../../test/renderApp";
const server=setupServer(...handlersFor("default"));beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>{server.resetHandlers();vi.restoreAllMocks();});afterAll(()=>server.close());
const scope=`?scope=project:${fixtureProject.id}`,root=fixtureTasks[0]!.id;
test("switching to Graph roots the served neighborhood at the selection",async()=>{
 const {router}=renderApp(`/work/${root}${scope}`);await screen.findByRole("heading",{name:fixtureTasks[0]!.title});await userEvent.click(screen.getByRole("button",{name:"Graph"}));await screen.findByRole("region",{name:"Dependency graph"});expect(new URLSearchParams(router.state.location.search).get("root")).toBe(root);
});
test("Graph keeps a bounded navigation workspace and textual relationships",async()=>{
 renderApp(`/work/${root}${scope}&view=graph`);const region=await screen.findByRole("region",{name:"Dependency graph"});await within(region).findByRole("link",{name:new RegExp(fixtureTasks[1]!.title)});expect(within(region).getAllByRole("link").length).toBeGreaterThan(1);expect(region).toHaveTextContent("blocks");expect(within(region).getByRole("region",{name:"Scrollable task graph"})).toHaveAttribute("tabindex","0");
});
test("selecting a graph node retains root and stable node positions",async()=>{
 vi.spyOn(window,"matchMedia").mockReturnValue({matches:true,addEventListener:()=>{},removeEventListener:()=>{}} as unknown as MediaQueryList);
 const {router}=renderApp(`/work/${root}${scope}&view=graph&root=${root}`);const region=await screen.findByRole("region",{name:"Dependency graph"});const link=await within(region).findByRole("link",{name:new RegExp(fixtureTasks[1]!.title)});const position=link.getAttribute("style");await userEvent.click(link);await waitFor(()=>expect(router.state.location.pathname).toBe(`/work/${fixtureTasks[1]!.id}`));expect(new URLSearchParams(router.state.location.search).get("root")).toBe(root);expect(within(await screen.findByRole("region",{name:"Dependency graph"})).getAllByRole("link",{name:new RegExp(fixtureTasks[1]!.title)})[0]).toHaveAttribute("style",position!);
});
test("truncated served neighborhood is explicit",async()=>{server.use(...handlersFor("partial"));renderApp(`/work/${root}${scope}&view=graph`);expect(await screen.findByText(/Some relationships omitted/)).toBeVisible();});
test("graph without a selection roots on the first loaded task and keeps a way back to the list",async()=>{renderApp(`/work${scope}&view=graph`);const canvas=await screen.findByRole("region",{name:"Scrollable task graph"});expect(within(canvas).getAllByRole("link").length).toBeGreaterThan(0);expect(screen.queryByText(/Select a task from the list/)).not.toBeInTheDocument();expect(screen.getByRole("button",{name:"List"})).toHaveAttribute("aria-pressed","false");});
