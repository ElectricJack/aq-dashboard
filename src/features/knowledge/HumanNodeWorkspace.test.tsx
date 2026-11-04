import {screen,within,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {http,HttpResponse} from "msw";
import {setupServer} from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import {handlersFor} from "../../mocks/handlers";
import {renderApp} from "../../test/renderApp";
import {graphEnvelope,graphNode,graphProject} from "../../test/humanGraph";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
function enable() {
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>!["human.graph.read","knowledge.read","projects.read"].includes(c.name)),{name:"human.graph.read",version:"1",enabled:true},{name:"knowledge.read",version:"1",enabled:true},{name:"projects.read",version:"1",enabled:true}]}})));
}
const scope=`?scope=project:${graphProject}`;
function handlers(kind:"task"|"knowledge"="knowledge") {
 const n=graphNode(kind);
 server.use(http.get(`/api/human/projects/${graphProject}/${kind==="task"?"tasks":"knowledge"}`,()=>HttpResponse.json(graphEnvelope({items:[n],next_cursor:null}))),http.get(`/api/human/projects/${graphProject}/${kind==="task"?"tasks":"knowledge"}/${n.id}`,()=>HttpResponse.json(graphEnvelope(n))));
 return n;
}
test("knowledge opens real-contract content, source descriptors and exact record version",async()=>{
 enable();const n=handlers();renderApp(`/knowledge/${n.id}${scope}`);
 expect(await screen.findByText(/Each attempt has one current execution authority/)).toBeInTheDocument();
 expect(screen.getByRole("region",{name:"Linked work"})).toHaveTextContent("not offered by this read contract");
 expect(screen.getByText(/applies to revision 4/)).toBeInTheDocument();expect(screen.getByText("Current revision 4 · Older revisions remain available")).toBeInTheDocument();
 const sources=screen.getByRole("tab",{name:/Sources/});expect(sources).toHaveTextContent("Sources1");expect(sources).toHaveAttribute("aria-selected","false");
 await userEvent.click(sources);expect(sources).toHaveAttribute("aria-selected","true");expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Sources/);
 expect(within(screen.getByRole("list",{name:"Recorded sources"})).getByRole("link",{name:/example\.org\/architecture/})).toHaveAttribute("href","https://example.org/architecture");
 expect(screen.getByText(/"kind"/)).not.toBeVisible();
 await userEvent.keyboard("{ArrowRight}");expect(screen.getByRole("tab",{name:"History"})).toHaveFocus();expect(screen.getByRole("tab",{name:/Relationships/})).toHaveAttribute("aria-disabled","true");await userEvent.click(screen.getByText("Record details",{exact:true}));expect(screen.getByText("9007199254740993")).toBeVisible();
});
test("all-project scope prompts a bounded choice and does not query Graph",async()=>{
 enable();let calls=0;server.use(http.get("/api/human/projects/:project/knowledge",()=>{calls++;return HttpResponse.json({});}));renderApp("/knowledge");
 expect(await screen.findByRole("heading",{name:"Choose a project"})).toBeInTheDocument();expect(calls).toBe(0);
});
test("filters only loaded records and retains task state without claiming readiness",async()=>{
 enable();const n=handlers("task");renderApp(`/work${scope}`);
 const list=await screen.findByRole("list",{name:"Tasks"});expect(within(list).getByRole("link",{name:/Implement recovery/})).toBeInTheDocument();
 await userEvent.click(within(list).getByRole("link",{name:/Implement recovery/}));expect(await screen.findByText("Recovery is verified by tests.")).toBeInTheDocument();expect(screen.queryByText("Ready")).not.toBeInTheDocument();expect(n.task_state).toBe("active");
});
test("exact historical revision uses the original string and labels the pinned response",async()=>{
 enable();const n=handlers();let sent:string|null=null;
 server.use(http.get(`/api/human/projects/${graphProject}/knowledge/${n.id}`,({request})=>{sent=new URL(request.url).searchParams.get("revision");return HttpResponse.json(graphEnvelope({...n,content_revision:sent??"4"}));}));
 renderApp(`/knowledge/${n.id}${scope}`);await screen.findByText(/Each attempt has/);await userEvent.click(screen.getByRole("tab",{name:"History"}));await userEvent.type(screen.getByLabelText("Exact content revision"),"9007199254740993");await userEvent.click(screen.getByRole("button",{name:"View revision"}));
 expect(await screen.findByText("Pinned revision 9007199254740993")).toBeInTheDocument();expect(sent).toBe("9007199254740993");
});
test("failed Graph read is an error and never an empty successful library",async()=>{
 enable();server.use(http.get(`/api/human/projects/${graphProject}/knowledge`,()=>HttpResponse.json({error:"unavailable"},{status:503})));renderApp(`/knowledge${scope}`);
 expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load knowledge records");expect(screen.queryByText("No records returned for this search.")).not.toBeInTheDocument();
});
test("unknown route identities do not issue arbitrary Graph paths",async()=>{
 enable();renderApp(`/knowledge/not-a-valid-id${scope}`);expect(await screen.findByText("This item does not exist or is not available to you.")).toBeInTheDocument();
});
test("literal malicious body stays text and lifecycle differs from verification",async()=>{
 enable();const n=handlers();server.use(http.get(`/api/human/projects/${graphProject}/knowledge/${n.id}`,()=>HttpResponse.json(graphEnvelope({...n,body:'<img src=x onerror="alert(1)">',retired:true,verification:"disputed"}))));
 renderApp(`/knowledge/${n.id}${scope}`);const literal=await screen.findByText('<img src=x onerror="alert(1)">');expect(literal.querySelector("img")).toBeNull();expect(screen.getByText("Retired",{exact:true})).toBeInTheDocument();expect(screen.getAllByText("Disputed").length).toBeGreaterThan(0);
});
test("load more preserves unique records and refuses binding changes",async()=>{
 enable();let requests=0;server.use(http.get(`/api/human/projects/${graphProject}/knowledge`,({request})=>{requests++;return HttpResponse.json(graphEnvelope({items:[graphNode("knowledge",requests===1?10:11)],next_cursor:new URL(request.url).searchParams.has("cursor")?null:"next"},requests===1?"1":"2"));}));
 renderApp(`/knowledge${scope}`);await screen.findByRole("list",{name:"Knowledge records"});await userEvent.click(screen.getByRole("button",{name:"Load more records"}));await waitFor(()=>expect(screen.getByRole("alert")).toBeInTheDocument());expect(screen.queryByRole("list",{name:"Knowledge records"})).not.toBeInTheDocument();
});

test("task graph renders actual typed relationships with truncation and links",async()=>{
 enable();const n=handlers("task"),other={...graphNode("task",11),title:"Verify recovery"};
 server.use(http.get(`/api/human/projects/${graphProject}/tasks/${n.id}/graph`,()=>HttpResponse.json(graphEnvelope({root_id:n.id,nodes:[n,other],edges:[{id:"00000000-0000-4000-8000-000000000050",source:n.id,target:other.id,edge_type:"blocks",description:"must precede",version:"1",source_revision:"4",target_revision:"4"}],truncated:true}))));
 renderApp(`/work/${n.id}${scope}&view=graph`);
 const graph=await screen.findByRole("region",{name:"Dependency graph"});expect(await within(graph).findByText(/Some relationships omitted/)).toBeInTheDocument();expect(within(graph).getByRole("link",{name:/Verify recovery/})).toHaveAttribute("href",`/work/${other.id}?scope=project%3A${graphProject}`);expect(graph).toHaveTextContent("blocks");
});
test("search uses project-scoped task and knowledge contracts without proposed search fallback",async()=>{
 enable();const task=handlers("task"),knowledge=handlers();let q:string|null=null;
 server.use(http.get(`/api/human/projects/${graphProject}/knowledge`,({request})=>{q=new URL(request.url).searchParams.get("q");return HttpResponse.json(graphEnvelope({items:[knowledge],next_cursor:null}));}));
 renderApp(`/knowledge${scope}`);await screen.findByRole("list",{name:"Knowledge records"});await userEvent.click(screen.getAllByRole("button",{name:"Search"})[0]!);const dialog=screen.getByRole("dialog",{name:"Search"});await userEvent.type(within(dialog).getByRole("searchbox"),"recovery");
 expect(await within(dialog).findByRole("link",{name:new RegExp(task.title)})).toHaveAttribute("href",`/work/${task.id}?scope=project%3A${graphProject}`);expect(await within(dialog).findByRole("link",{name:new RegExp(knowledge.title)})).toHaveAttribute("href",`/knowledge/${knowledge.id}?scope=project%3A${graphProject}`);expect(q).toBe("recovery");
});

test("project selection preserves an already linked task identity and graph context",async()=>{
 enable();const n=handlers("task");
 server.use(http.get("/api/v1/projects",()=>HttpResponse.json({...bootstrap,data:{items:[{id:graphProject,label:"Agent Q"}],next_cursor:null,has_more:false,snapshot_id:"projects",total:{value:1,accuracy:"exact"}}})));
 const {router}=renderApp(`/work/${n.id}?view=graph`);
 const choice=await screen.findByRole("link",{name:"Agent Q"});
 expect(choice).toHaveAttribute("href",`/work/${n.id}?view=graph&scope=project%3A${graphProject}`);
 await userEvent.click(choice);await screen.findByRole("heading",{name:n.title});
 expect(router.state.location.pathname).toBe(`/work/${n.id}`);expect(new URLSearchParams(router.state.location.search).get("view")).toBe("graph");
});
test("task inspector prioritizes acceptance and dependencies with verification in disclosure",async()=>{
 enable();const n=handlers("task");renderApp(`/work/${n.id}${scope}`);
 const region=await screen.findByRole("region",{name:n.title});
 expect(within(region).getByRole("heading",{name:"Acceptance criteria"})).toBeVisible();
 expect(within(region).getByRole("heading",{name:"Dependencies"})).toBeVisible();
 expect(within(region).getByText("Record details and verification")).toBeVisible();
 expect(within(region).queryByRole("heading",{name:"Verification"})).not.toBeInTheDocument();
});

test("a missing feature record stays scoped and keeps dashboard navigation available",async()=>{
 enable();const n=handlers();
 server.use(http.get(`/api/human/projects/${graphProject}/knowledge/${n.id}`,()=>HttpResponse.json({error:"not_found",message:"Not available"},{status:404})));
 renderApp(`/knowledge/${n.id}${scope}`);
 expect(await screen.findByText("This item does not exist or is not available to you.")).toBeInTheDocument();
 expect(screen.getByRole("navigation",{name:"Primary"})).toBeInTheDocument();
 expect(screen.queryByRole("heading",{name:"Dashboard update required"})).not.toBeInTheDocument();
 expect(screen.getByRole("heading",{name:"Knowledge",level:1})).toBeInTheDocument();
});
