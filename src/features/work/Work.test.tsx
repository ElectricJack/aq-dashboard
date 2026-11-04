import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import task from "../../../contracts/live/human-graph/examples/task.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
const scope=`?scope=project:${task.project.id}`;
test("Work uses served project routes and pinned Graph fixtures",async()=>{
 const reads:string[]=[];server.events.on("request:start",({request})=>{if(new URL(request.url).pathname.includes("tasks"))reads.push(new URL(request.url).pathname);});
 renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});
 expect(within(list).getByText(task.data.title)).toBeVisible();expect(reads).toContain(`/api/human/projects/${task.project.id}/tasks`);expect(reads.some(p=>p.startsWith("/api/v1/tasks"))).toBe(false);server.events.removeAllListeners();
});
test("task selection preserves scope and opens requirements and acceptance",async()=>{
 const {router}=renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});await userEvent.click(within(list).getByRole("link",{name:new RegExp(task.data.title)}));
 const detail=await screen.findByRole("region",{name:task.data.title});expect(within(detail).getByRole("heading",{name:"Acceptance criteria"})).toBeVisible();expect(router.state.location.search).toContain(task.project.id);expect(within(detail).getByText(task.data.body)).toBeVisible();
});
test("task state chips filter loaded tasks and live in the URL",async()=>{
 const {router}=renderApp(`/work${scope}`);await screen.findByRole("list",{name:"Tasks"});const chip=within(screen.getByRole("group",{name:"Task state"})).getByRole("button",{name:"Canceled"});await userEvent.click(chip);expect(new URLSearchParams(router.state.location.search).get("state")).toBe("canceled");expect(chip).toHaveAttribute("aria-pressed","true");const list=screen.getByRole("list",{name:"Tasks"});await waitFor(()=>expect(within(list).getAllByRole("listitem")).toHaveLength(1));expect(list).toHaveTextContent("Fixture: Retire legacy lease path");expect(screen.getByRole("heading",{name:"1 tasks loaded"})).toBeVisible();
});
test("task search uses the project read and retains its URL",async()=>{
 const {router}=renderApp(`/work${scope}`);await screen.findByRole("list",{name:"Tasks"});await userEvent.type(screen.getByRole("searchbox",{name:"Search tasks"}),"No matching title{Enter}");await waitFor(()=>expect(router.state.location.search).toContain("q=No+matching+title"));expect(await screen.findByText("No records returned for this search.")).toBeVisible();
});
test("Work asks for a project rather than inventing all-project Graph data",async()=>{renderApp("/work");expect(await screen.findByRole("heading",{name:"Choose a project"})).toBeVisible();});
test("failed and empty Graph lists remain distinct",async()=>{server.use(...handlersFor("reads-failed"));renderApp(`/work${scope}`);expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load tasks");expect(screen.queryByText("No records returned for this search.")).not.toBeInTheDocument();});
test("successful empty Graph list says no records returned",async()=>{server.use(...handlersFor("empty"));renderApp(`/work${scope}`);expect(await screen.findByText("No records returned for this search.")).toBeVisible();});
test("missing task is neutral and never echoes an arbitrary route",async()=>{renderApp(`/work/secret-task-id${scope}`);expect(await screen.findByText("This item does not exist or is not available to you.")).toBeVisible();expect(screen.queryByText("secret-task-id")).not.toBeInTheDocument();});
test("literal task titles stay text on the served route",async()=>{
 server.use(http.get(`/api/human/projects/${task.project.id}/tasks`,()=>HttpResponse.json({...task,data:{items:[{...task.data,title:'<img src=x onerror="alert(1)">'}],next_cursor:null}})));
 renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});expect(within(list).getByText('<img src=x onerror="alert(1)">')).toBeVisible();expect(list.querySelector("img")).toBeNull();
});
test("task rows read state and revision once, without knowledge verification terms",async()=>{renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});for(const item of within(list).getAllByRole("listitem")){expect(item.textContent).not.toMatch(/(\w+) · \1/);expect(item.textContent).not.toMatch(/Unverified|Verified|Disputed/);}expect(within(list).getAllByText(/^Active · r1$/).length).toBeGreaterThan(0);expect(screen.getByText("Execution details unavailable")).toBeVisible();});
