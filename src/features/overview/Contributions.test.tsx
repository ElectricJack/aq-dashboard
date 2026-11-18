import userEvent from "@testing-library/user-event";
import { screen,within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http,HttpResponse } from "msw";
import { SWARM_MOCKUP, swarmEnvelope } from "../../mocks/swarm";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { overviewId,overviewTasks } from "../../test/overviewTasks";
const server=setupServer(...handlersFor("default"));beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
function capabilities(tasks=true,swarm=false){server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>!["human.overview.tasks.read","swarm.read"].includes(c.name)),{name:"human.overview.tasks.read",version:"1",enabled:tasks,reason:"Task summaries unavailable"},{name:"swarm.read",version:"1",enabled:swarm,reason:"Fleet capacity unavailable"}]}})));}
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

test("base overview failure does not hide available task contributions",async()=>{
 capabilities();server.use(http.get("/api/v1/overview",()=>HttpResponse.json({},{status:503})),http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");await screen.findByRole("link",{name:"Recorded work item"});expect((await screen.findAllByRole("alert"))[0]).toBeInTheDocument();expect(screen.queryByRole("list",{name:"Work counts"})).toBeNull();
});

test("live contribution shares the reference work/outcomes panel rather than duplicating project panes",async()=>{
 capabilities();server.use(http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");await screen.findByRole("link",{name:"Recorded work item"});const motion=screen.getByRole("region",{name:"Work in motion"});expect(within(motion).getByRole("region",{name:"Recorded tasks"})).toBeInTheDocument();expect(within(motion).getByRole("region",{name:"Recent outcomes"})).toBeInTheDocument();expect(screen.getByRole("table",{name:"Work in motion"})).toBeInTheDocument();
});
test("task scope details remain accessible without crowding the core summary",async()=>{
 // The contribution stays behind the work panel's explicit disclosure.
 capabilities();server.use(http.get("/api/human/overview/tasks",()=>HttpResponse.json(overviewTasks())));renderApp("/overview");await screen.findByText('Recorded task details');await userEvent.click(screen.getByText('Recorded task details'));const region=await screen.findByRole("region",{name:"Recorded tasks"});await within(region).findByRole("link",{name:"Recorded work item"});const explanation=within(region).getByText(/Active records do not establish running agents/);expect(explanation).not.toBeVisible();await userEvent.click(within(region).getByText("About these records"));expect(explanation).toBeVisible();
});
test("capacity uses Swarm slots and fresh headroom and omits retired workers", async () => {
  capabilities(false, true);
  const data = structuredClone(SWARM_MOCKUP);
  const desktop = data.machines[0]!;
  desktop.nodes.push({ ...desktop.nodes[0]!, health: "revoked", name: "Retired worker",
    slots: { total: 20, occupied: 0, idle: 20 } });
  const studio = data.machines[2]!;
  studio.load!.fresh = false;
  studio.hardware!.disk_free_bytes = 0;
  server.use(http.get("/api/v1/swarm", ({ request }) => {
    expect(new URL(request.url).searchParams.has("scope")).toBe(false);
    return HttpResponse.json(swarmEnvelope(data));
  }));
  renderApp("/overview");
  const capacity = await screen.findByRole("region", { name: "Capacity" });
  await within(capacity).findByText(/open agent slot/);
  expect(capacity).toHaveTextContent("1 open agent slot");
  expect(capacity).toHaveTextContent("4 in use");
  expect(capacity).toHaveTextContent("2 unavailable");
  const resources = within(capacity).getByRole("region", { name: "Tightest reported headroom" });
  expect(resources).toHaveTextContent("CPU39% free");
  expect(resources).toHaveTextContent("Memory42% free");
  expect(resources).toHaveTextContent("Disk14% free");
  expect(resources).toHaveTextContent("GPUNot reported");
  await userEvent.click(within(capacity).getByText(/By machine/));
  expect(within(capacity).getByText("Capability report expired")).toBeVisible();
  expect(capacity).not.toHaveTextContent(/Retired worker|laptop|boat vm-a/i);
});

test("a partial fleet with missing slot totals keeps open capacity unknown", async () => {
  capabilities(false, true);
  const desktop = structuredClone(SWARM_MOCKUP.machines[0]!);
  desktop.nodes = [desktop.nodes[0]!];
  desktop.nodes[0]!.slots = { total: null, occupied: 3, idle: null };
  const data = { ...SWARM_MOCKUP, machines: [desktop] };
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json({
    ...swarmEnvelope(data), coverage: { state: "partial", reason: "Some workers did not report" },
  })));
  renderApp("/overview");
  const capacity = await screen.findByRole("region", { name: "Capacity" });
  expect(await within(capacity).findByText("Open slots unknown")).toBeVisible();
  expect(capacity).toHaveTextContent("3 in use");
  expect(capacity).toHaveTextContent("Slot counts are incomplete");
});

test("capacity skips network reads when Swarm access is disabled", async () => {
  capabilities(false);
  let calls = 0;
  server.use(http.get("/api/v1/swarm", () => { calls++; return HttpResponse.json(swarmEnvelope(SWARM_MOCKUP)); }),
    http.get("/api/workers", () => { calls++; return HttpResponse.json([]); }));
  renderApp("/overview");
  const capacity = await screen.findByRole("region", { name: "Capacity" });
  expect(capacity).toHaveTextContent("Fleet capacity unavailable");
  expect(calls).toBe(0);
});

test("capacity respects a shared machine limit and an owner pause", async () => {
  capabilities(false, true);
  const desktop = structuredClone(SWARM_MOCKUP.machines[0]!);
  desktop.nodes[0]!.slots = { total: 6, occupied: 3, idle: 3 };
  const data = { ...SWARM_MOCKUP, machines: [desktop] };
  let paused = false;
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({
    ...data, server: {
      ...data.server, owner_availability: { state: paused ? "off" : "on", generation: "2", since: null },
    },
  }))));
  const { queryClient } = renderApp("/overview");
  const capacity = await screen.findByRole("region", { name: "Capacity" });
  expect(await within(capacity).findByText("3 unavailable")).toBeVisible();
  expect(capacity).toHaveTextContent("1 open agent slot");
  paused = true;
  await queryClient.refetchQueries({ predicate: query => query.queryKey.includes("swarm") });
  expect(await within(capacity).findByText("Owner availability is off.")).toBeVisible();
  expect(capacity).toHaveTextContent("0 open agent slots");
  expect(capacity).toHaveTextContent("4 unavailable");
});
