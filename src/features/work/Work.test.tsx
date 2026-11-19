import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import task from "../../../contracts/live/human-graph/examples/task.json";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
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
 const {router}=renderApp(`/work${scope}`);await screen.findByRole("list",{name:"Tasks"});const chip=within(screen.getByRole("group",{name:"Task state"})).getByRole("button",{name:"Canceled"});await userEvent.click(chip);expect(new URLSearchParams(router.state.location.search).get("state")).toBe("canceled");expect(chip).toHaveAttribute("aria-pressed","true");const list=screen.getByRole("list",{name:"Tasks"});await waitFor(()=>expect(within(list).getAllByRole("listitem")).toHaveLength(1));expect(list).toHaveTextContent("Fixture: Retire legacy lease path");expect(screen.getByRole("heading",{name:"1 task loaded"})).toBeVisible();
});
test("task search uses the project read and retains its URL",async()=>{
 const {router}=renderApp(`/work${scope}`);await screen.findByRole("list",{name:"Tasks"});await userEvent.type(screen.getByRole("searchbox",{name:"Search tasks"}),"No matching title{Enter}");await waitFor(()=>expect(router.state.location.search).toContain("q=No+matching+title"));expect(await screen.findByText("No records returned for this search.")).toBeVisible();
});
test("Work asks for a project on servers without the all-project capability",async()=>{renderApp("/work");expect(await screen.findByRole("heading",{name:"Choose a project"})).toBeVisible();});

function enableAllProjects() {
  const capabilities = [...bootstrap.data.capabilities,
    { name: "human.graph.read", version: "1", enabled: true },
    { name: "human.work.tasks.read", version: "1", enabled: true },
  ];
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities } })));
}

test("All projects fetches a bounded page, loads more and uses the row's project for details", async () => {
  enableAllProjects();
  const otherProject = { id: "00000000-0000-0000-0000-000000000027", name: "Other project", workspace_id: "00000000-0000-0000-0000-000000000028" };
  const items = Array.from({ length: 50 }, (_, i) => ({
    id: `00000000-0000-0000-0000-${String(i + 1000).padStart(12, "0")}`,
    workspace_id: otherProject.workspace_id, title: `Other project task ${i + 1}`,
    task_state: "active", updated_at: "2026-11-01T12:00:00Z",
  }));
  const cursors: (string | null)[] = [];
  server.use(http.get("/api/human/work/tasks", ({ request }) => {
    const params = new URL(request.url).searchParams;
    expect(params.get("limit")).toBe("50");
    const cursor = params.get("cursor");
    cursors.push(cursor);
    return HttpResponse.json({ contract: "human-work-task-list-1", unavailable_projects: 1,
      items: cursor ? [{ ...task.data, workspace_id: task.project.workspace_id }] : items,
      projects: cursor ? [task.project] : [otherProject], next_cursor: cursor ? null : "next-page" });
  }));
  const { router } = renderApp("/work");
  const list = await screen.findByRole("list", { name: "Tasks" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(50);
  expect(cursors).toEqual([null]);
  expect(screen.getByText("Task records are unavailable for 1 project.")).toBeVisible();
  expect(within(list).getByRole("link", { name: /Other project task 1, Other project/ })).toHaveAttribute("href", expect.stringContaining(otherProject.id));
  await userEvent.click(screen.getByRole("button", { name: "Load more tasks" }));
  const link = await within(list).findByRole("link", { name: new RegExp(task.data.title) });
  expect(within(list).getAllByRole("listitem")).toHaveLength(51);
  expect(cursors).toEqual([null, "next-page"]);
  await userEvent.click(link);
  expect(await screen.findByRole("region", { name: task.data.title })).toBeVisible();
  expect(new URLSearchParams(router.state.location.search).get("scope")).toBe(`project:${task.project.id}`);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Scope" }), "all");
  expect(await screen.findByRole("heading", { name: "51 tasks loaded" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/work");
});

test("All projects forwards search and status together and starts a new cursor chain", async () => {
  enableAllProjects();
  const requests: URLSearchParams[] = [];
  server.use(http.get("/api/human/work/tasks", ({ request }) => {
    requests.push(new URL(request.url).searchParams);
    return HttpResponse.json({ contract: "human-work-task-list-1", items: [], projects: [], unavailable_projects: 0, next_cursor: null });
  }));
  const { router } = renderApp("/work?state=completed");
  await screen.findByText("No matching tasks across projects.");
  await userEvent.type(screen.getByRole("searchbox", { name: "Search tasks" }), "release gate{Enter}");
  await waitFor(() => expect(requests.at(-1)?.get("q")).toBe("release gate"));
  expect(requests.at(-1)?.get("state")).toBe("completed");
  expect(requests.at(-1)?.has("cursor")).toBe(false);
  expect(new URLSearchParams(router.state.location.search).get("q")).toBe("release gate");
});
test("failed and empty Graph lists remain distinct",async()=>{server.use(...handlersFor("reads-failed"));renderApp(`/work${scope}`);expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load tasks");expect(screen.queryByText("No records returned for this search.")).not.toBeInTheDocument();});
test("successful empty Graph list says no records returned",async()=>{server.use(...handlersFor("empty"));renderApp(`/work${scope}`);expect(await screen.findByText("No records returned for this search.")).toBeVisible();});
test("missing task is neutral and never echoes an arbitrary route",async()=>{renderApp(`/work/secret-task-id${scope}`);expect(await screen.findByText("This item does not exist or is not available to you.")).toBeVisible();expect(screen.queryByText("secret-task-id")).not.toBeInTheDocument();});
test("literal task titles stay text on the served route",async()=>{
 server.use(http.get(`/api/human/projects/${task.project.id}/tasks`,()=>HttpResponse.json({...task,data:{items:[{...task.data,title:'<img src=x onerror="alert(1)">'}],next_cursor:null}})));
 renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});expect(within(list).getByText('<img src=x onerror="alert(1)">')).toBeVisible();expect(list.querySelector("img")).toBeNull();
});
test("task rows are one line: a status icon with an accessible name, no status label or revision (item 16)",async()=>{
 renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});
 for(const item of within(list).getAllByRole("listitem")){expect(item.textContent).not.toMatch(/ · r\d|Unverified|Verified|Disputed/);const icon=within(item).getByRole("img");expect(icon).toHaveAttribute("title",icon.getAttribute("aria-label"));}
 // The list page's executions mark the replay task running; others show their lifecycle.
 const replay=within(list).getByRole("link",{name:/Fixture: Replay reconciliation/});expect(within(replay).getByRole("img",{name:"Running"})).toBeVisible();expect(replay).toHaveAttribute("title","Fixture: Replay reconciliation");
 expect(within(within(list).getByRole("link",{name:/Fixture: Define lease contract/})).getByRole("img",{name:"Complete"})).toBeVisible();
 expect(within(within(list).getByRole("link",{name:/Fixture: Implement safe recovery/})).getByRole("img",{name:"Draft"})).toBeVisible();
 expect(within(within(list).getByRole("link",{name:/Fixture: Retire legacy lease path/})).getByRole("img",{name:"Canceled"})).toBeVisible();
 expect(within(within(list).getByRole("link",{name:/Fixture: Approve recovery plan/})).getByRole("img",{name:"Active"})).toBeVisible();
 expect(within(list).queryByText(/^Active$|^Completed$/)).toBeNull();
});
test("list rows keep a short marker for retired and deleted records",async()=>{
 server.use(http.get(`/api/human/projects/${task.project.id}/tasks`,()=>HttpResponse.json({...task,data:{items:[{...task.data,retired:true}],next_cursor:null}})));
 renderApp(`/work${scope}`);const list=await screen.findByRole("list",{name:"Tasks"});expect(within(list).getByText("Retired")).toBeVisible();
});
test("legacy graph root clears on List and the selection carries into Gantt",async()=>{
 const tasks=`/work/00000000-0000-0000-0000-000000000104${scope}&view=graph&root=00000000-0000-0000-0000-000000000104`;
 const {router}=renderApp(tasks);const params=()=>new URLSearchParams(router.state.location.search);
 await userEvent.click(await screen.findByRole("button",{name:"List"}));
 await waitFor(()=>expect(params().get("view")).toBeNull());expect(params().get("root")).toBeNull();
 const list=await screen.findByRole("list",{name:"Tasks"});const row=within(list).getByRole("link",{name:/Fixture: Replay reconciliation/});
 expect(new URL(row.getAttribute("href")!,"http://x").searchParams.get("root")).toBeNull();await userEvent.click(row);
 await screen.findByRole("region",{name:"Fixture: Replay reconciliation"});
 await userEvent.click(screen.getByRole("button",{name:"Gantt"}));
 const tracks=await screen.findByRole("region",{name:"Scrollable dependency tracks"});
 expect(within(tracks).getByRole("link",{name:/Replay reconciliation/})).toHaveAttribute("aria-current","page");
 expect(params().get("view")).toBe("gantt");expect(params().get("root")).toBeNull();
});
test("the inspector is the single task view: full copyable task ID, no Open full task link (WD-02, WD-09)",async()=>{
 renderApp(`/work/00000000-0000-0000-0000-000000000105${scope}`);const detail=await screen.findByRole("region",{name:"Fixture: Replay reconciliation"});
 expect(within(detail).queryByRole("link",{name:"Open full task"})).toBeNull();
 expect(within(detail).getByText("00000000-0000-0000-0000-000000000105",{selector:"code"})).toBeVisible();
 expect(within(detail).getByRole("button",{name:"Copy task ID"})).toBeVisible();
 // The work read names the holding attempt; the mock fixture's replay task has one.
 expect(await within(detail).findByRole("link",{name:"Open terminal"})).toHaveAttribute("href",expect.stringContaining("/agents/00000000-0000-0000-0000-000000000302"));
});
