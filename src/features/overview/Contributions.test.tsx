import userEvent from "@testing-library/user-event";
import { screen,within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http,HttpResponse } from "msw";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { overviewId,overviewTasks } from "../../test/overviewTasks";
const server=setupServer(...handlersFor("default"));beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
function capabilities(tasks=true,workers=false){server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>!["human.overview.tasks.read","workers.read"].includes(c.name)),{name:"human.overview.tasks.read",version:"1",enabled:tasks,reason:"Task summaries unavailable"},{name:"workers.read",version:"1",enabled:workers,reason:"Worker inspection unavailable"}]}})));}
test("actual task contribution creates project-scoped links without treating active as running",async()=>{
 capabilities();server.use(http.get("/api/human/overview/tasks",({request})=>{const params=new URL(request.url).searchParams;expect(params.get("project_limit")).toBe("4");expect(params.get("task_limit")).toBe("16");return HttpResponse.json(overviewTasks());}));renderApp("/overview");
 const region=await screen.findByRole("region",{name:"Recorded tasks"});const link=await within(region).findByRole("link",{name:"Recorded work item"});expect(link).toHaveAttribute("href",`/work/${overviewId(3)}?scope=project%3A${overviewId(1)}`);expect(region).toHaveTextContent("1 active");expect(region).toHaveTextContent("Active records do not establish running agents");
});
test("disabled summary capability performs no request",async()=>{
 capabilities(false);let calls=0;server.use(http.get("/api/human/overview/tasks",()=>{calls++;return HttpResponse.json(overviewTasks());}));renderApp("/overview");await screen.findByRole("region",{name:"Needs your attention"});expect(screen.queryByRole("region",{name:"Recorded tasks"})).toBeNull();expect(calls).toBe(0);
});
test("one unavailable project remains explicit while the other project is readable",async()=>{
 capabilities();const value=overviewTasks();value.coverage="partial";value.projects.push({...value.projects[0]!,project:{...value.projects[0]!.project,id:overviewId(8),name:"Unavailable project"},source_status:"unavailable",coverage:"unavailable",count_accuracy:"unknown",observed_at:null,task_counts:null,tasks:[],more_tasks:null,reason:"Graph source unavailable"});server.use(http.get("/api/human/overview/tasks",()=>HttpResponse.json(value)));renderApp("/overview");await screen.findByText("Graph source unavailable");expect(screen.getByRole("link",{name:"Recorded work item"})).toBeInTheDocument();expect(screen.getByText(/Partial coverage · More records/)).toBeInTheDocument();
});
test("heartbeat observations show real source status and no inferred slot capacity",async()=>{
 capabilities(false,true);server.use(http.get("/api/workers",()=>HttpResponse.json([{id:"worker1",name:"Actual worker",status:"online",last_seen_at:"2026-11-01T15:00:00.000Z"}])));renderApp("/overview");const region=await screen.findByRole("region",{name:"Worker nodes"});await within(region).findByText("Actual worker");await userEvent.click(within(region).getByText("Inspect heartbeat observations"));expect(within(region).getByText("Heartbeat online")).toBeVisible();const capacity=screen.getByRole("region",{name:"Capacity"});expect(capacity).toHaveTextContent("Slot capacity and project eligibility are not reported here.");expect(capacity).not.toHaveTextContent("slots occupied");
});
test("base overview failure does not hide available task contributions",async()=>{
 capabilities();server.use(http.get("/api/v1/overview",()=>HttpResponse.json({},{status:503})),http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");await screen.findByRole("link",{name:"Recorded work item"});expect((await screen.findAllByRole("alert"))[0]).toBeInTheDocument();expect(screen.queryByRole("list",{name:"Work counts"})).toBeNull();
});

test("live contribution shares the reference work/outcomes panel rather than duplicating project panes",async()=>{
 capabilities();server.use(http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");await screen.findByRole("link",{name:"Recorded work item"});const motion=screen.getByRole("region",{name:"Work in motion"});expect(within(motion).getByRole("region",{name:"Recorded tasks"})).toBeInTheDocument();expect(within(motion).getByRole("region",{name:"Recent outcomes"})).toBeInTheDocument();expect(screen.queryByRole("table",{name:"Work in motion"})).toBeNull();expect(screen.getByRole("region",{name:"Provider status"})).toHaveTextContent("Availability not reported");
});
test("task scope details remain accessible without crowding the core summary",async()=>{
 capabilities();server.use(http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");const region=await screen.findByRole("region",{name:"Recorded tasks"});await within(region).findByRole("link",{name:"Recorded work item"});const explanation=within(region).getByText(/Active records do not establish running agents/);expect(explanation).not.toBeVisible();await userEvent.click(within(region).getByText("About these records"));expect(explanation).toBeVisible();
});
