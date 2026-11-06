import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { feedbackDetail, feedbackComment, feedbackEnvelope, feedbackOperation, feedbackId } from "../../test/resultsFeedback";
import { graphEnvelope } from "../../test/humanGraph";
const server=setupServer(...handlersFor("default"));
beforeAll(()=>server.listen({onUnhandledFrame:"error"}));afterEach(()=>server.resetHandlers());afterAll(()=>server.close());
const detail=feedbackDetail(), project=detail.result.project_id;
function fixtures(enabled=true) {
 server.use(http.get("/api/v1/bootstrap",()=>HttpResponse.json({...bootstrap,data:{...bootstrap.data,capabilities:[...bootstrap.data.capabilities.filter(c=>!["results.read","tasks.read","results.media.read"].includes(c.name)),...["results.read","results.comment","results.feedback"].map(name=>({name,version:"1",enabled,reason:"Results require Owner access"}))]}})),
 http.get("/api/v1/results",()=>HttpResponse.json(feedbackEnvelope({items:[detail],next_cursor:null}))),
 http.get("/api/v1/results/:id/revisions/:revision",()=>HttpResponse.json(feedbackEnvelope(detail))),
 http.get("/api/v1/results/:id/revisions/:revision/comments",()=>HttpResponse.json(feedbackEnvelope({items:[feedbackComment()],next_cursor:null},project))),
 http.get(`/api/human/projects/${project}/tasks`,()=>HttpResponse.json({...graphEnvelope({items:[],next_cursor:null}),project:{...graphEnvelope(null).project,id:project}})));
}
test("disabled results capability makes no data request",async()=>{
 fixtures(false);let calls=0;server.use(http.get("/api/v1/results",()=>{calls++;return HttpResponse.json(feedbackEnvelope({items:[]}));}));renderApp("/results");await screen.findByText("Results require Owner access");expect(calls).toBe(0);
});
test("pinned feed renders text safely and keeps source base separate from acceptance",async()=>{
 fixtures();server.use(http.get("/api/v1/results",()=>HttpResponse.json(feedbackEnvelope({items:[{...detail,revision:{...detail.revision,summary:"<script>worker text</script>"}}]}))));renderApp("/results");
 const list=await screen.findByRole("list",{name:"Results feed"});expect(within(list).getByText("<script>worker text</script>")).toBeInTheDocument();expect(list.querySelector("script")).toBeNull();
 expect(within(list).getByRole("link",{name:"Exact revision"})).toHaveAttribute("href",`/results/${detail.result.id}/revisions/${detail.revision.revision}`);expect(list).toHaveTextContent("Acceptance: Unreviewed");expect(within(list).queryByRole("button",{name:"Create feedback task"})).toBeNull();expect(within(list).queryByRole("link",{name:/review result/i})).toBeNull();expect(within(list).getByText("Source base")).toBeInTheDocument();
});
test("feed filters use G6 modes; paging is explicit and new arrivals do not replace cards",async()=>{
 fixtures();const urls:URL[]=[];let fresh=false;
 server.use(http.get("/api/v1/results",({request})=>{const url=new URL(request.url);urls.push(url);const second={...detail,result:{...detail.result,id:feedbackId(30)},revision:{...detail.revision,report_id:feedbackId(30),summary:"Older result",submitted_at_ms:1}};return HttpResponse.json(feedbackEnvelope({items:url.searchParams.has("cursor")?[second]:[{...detail,revision:{...detail.revision,revision:fresh?"b".repeat(64):detail.revision.revision,summary:fresh?"New arrival":"Original result"},assessment:{...detail.assessment,result_revision:fresh?"b".repeat(64):detail.revision.revision}}],next_cursor:url.searchParams.has("cursor")?null:"next"}));}));
 renderApp("/results");await screen.findByText("Original result");expect(urls).toHaveLength(1);await userEvent.click(screen.getByRole("button",{name:"Load more"}));await screen.findByText("Older result");expect(urls[1]!.searchParams.get("cursor")).toBe("next");
 fresh=true;await userEvent.click(screen.getByRole("button",{name:"Check for new results"}));await screen.findByRole("button",{name:"New results available"});expect(screen.getByText("Original result")).toBeInTheDocument();
 await userEvent.click(screen.getByRole("tab",{name:"Following"}));await waitFor(()=>expect(urls.at(-1)!.searchParams.get("mode")).toBe("following"));
});
test("results_feedback_creates_linked_task",async()=>{
 fixtures();const payloads:Record<string,unknown>[]=[];
 server.use(http.post("/api/v1/feedback-tasks",async({request})=>{expect(request.headers.get("X-AQ-Request")).toBe("1");const body=await request.json() as Record<string,unknown>;payloads.push(body);return HttpResponse.json(feedbackOperation(String(body.operation_id)));}),
 http.get("/api/v1/feedback-tasks/:id",({params})=>HttpResponse.json(feedbackEnvelope({operation_id:params.id,task_id:params.id,creation_disposition:"confirmed",link_confirmed:true,result_id:detail.result.id,revision:detail.revision.revision,origin:payloads[0]},project))));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);
 const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.clear(within(draft).getByLabelText("Title"));await userEvent.type(within(draft).getByLabelText("Title"),"Repair caption wrapping");
 await userEvent.type(within(draft).getByLabelText("Acceptance criteria"),"Caption remains readable at 320 px.");await userEvent.dblClick(within(draft).getByRole("button",{name:"Create linked task"}));
 await within(draft).findByText("Feedback task created and linked. Thread remains open.");expect(payloads).toHaveLength(1);expect(payloads[0]).toMatchObject({title:"Repair caption wrapping",comment_id:feedbackComment().id,comment_revision:"1",result_id:detail.result.id,revision:detail.revision.revision,project_id:project});
 expect(within(draft).getByRole("link",{name:"Open feedback task"})).toHaveAttribute("href",`/work/${payloads[0]!.operation_id}?scope=project%3A${project}`);expect(screen.queryByText("Fix submitted")).toBeNull();
});
test("results_mobile_review_flow_completes",async()=>{
 fixtures();let comments=[feedbackComment()];let writes=0;let created:Record<string,unknown>|undefined;
 server.use(http.post("/api/v1/feedback-tasks",async({request})=>{created=await request.json() as Record<string,unknown>;return HttpResponse.json(feedbackOperation(String(created.operation_id)));}),http.get("/api/v1/feedback-tasks/:id",({params})=>HttpResponse.json(feedbackEnvelope({operation_id:params.id,task_id:params.id,creation_disposition:"confirmed",link_confirmed:true,result_id:detail.result.id,revision:detail.revision.revision,origin:created},project))));
 server.use(http.get("/api/v1/results/:id/revisions/:revision/comments",()=>HttpResponse.json(feedbackEnvelope({items:comments,next_cursor:null},project))),http.post("/api/v1/results/:id/revisions/:revision/comments",async({request})=>{writes++;const body=await request.json() as {operation_id:string;body:string;anchor:unknown};expect(body).not.toHaveProperty("result_id");expect(body).not.toHaveProperty("revision");comments=[...comments,{...feedbackComment(),id:feedbackId(23),position:"2",body:body.body}];return HttpResponse.json(feedbackOperation(body.operation_id));}));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click(await screen.findByRole("button",{name:"Comments 1"}));const sheet=await screen.findByRole("dialog",{name:"Result comments"});
 await userEvent.type(within(sheet).getByLabelText("Comment"),"Please fix this caption.");await userEvent.click(within(sheet).getByRole("button",{name:"Post comment"}));await within(sheet).findByText("Please fix this caption.");expect(writes).toBe(1);expect(created).toBeUndefined();
 await userEvent.click(within(sheet).getAllByRole("button",{name:"Create feedback task"}).at(-1)!);const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.type(within(draft).getByLabelText("Acceptance criteria"),"Caption readable at 320 px.");await userEvent.click(within(draft).getByRole("button",{name:"Create linked task"}));await within(draft).findByText("Feedback task created and linked. Thread remains open.");expect(created).toMatchObject({comment_id:feedbackId(23),revision:detail.revision.revision});await userEvent.click(within(draft).getByRole("button",{name:"Close draft"}));
 await userEvent.click(within(sheet).getByRole("button",{name:"Close comments"}));expect(screen.getByText(/^Acceptance:/)).toBeVisible();expect(screen.queryByRole("dialog",{name:"Result comments"})).toBeNull();
});
test("uncertain feedback retains the original operation and recovers without a second create",async()=>{
 fixtures();let creates=0,recoveries=0;let draft:Record<string,unknown>={};let id="";
 server.use(http.post("/api/v1/feedback-tasks",async({request})=>{creates++;draft=await request.json() as Record<string,unknown>;id=String(draft.operation_id);return HttpResponse.error();}),http.get("/api/v1/operations/:id",()=>HttpResponse.json(feedbackOperation(id,"unknown"))),http.post("/api/v1/feedback-tasks/:id/recover",({params})=>{expect(params.id).toBe(id);recoveries++;return HttpResponse.json(feedbackOperation(id));}),http.get("/api/v1/feedback-tasks/:id",()=>HttpResponse.json(feedbackEnvelope({operation_id:id,task_id:id,creation_disposition:recoveries?"confirmed":"unknown",link_confirmed:!!recoveries,result_id:detail.result.id,revision:detail.revision.revision,origin:draft},project))));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);const modal=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.type(within(modal).getByLabelText("Acceptance criteria"),"Readable caption.");await userEvent.click(within(modal).getByRole("button",{name:"Create linked task"}));await within(modal).findByText(/outcome is unknown/i);expect(within(modal).queryByRole("button",{name:"Create linked task"})).toBeNull();await userEvent.click(within(modal).getByRole("button",{name:"Recover original request"}));await within(modal).findByText("Feedback task created and linked. Thread remains open.");expect(creates).toBe(1);expect(recoveries).toBe(1);
});
test("link existing task submits exact project and comment pins without creating a task",async()=>{
 fixtures();let links=0;server.use(http.post("/api/v1/feedback-links",async({request})=>{links++;const body=await request.json() as Record<string,unknown>;expect(body).toMatchObject({project_id:project,task_id:feedbackId(70),comment_id:feedbackComment().id,revision:detail.revision.revision});return HttpResponse.json(feedbackOperation(String(body.operation_id)));}));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);const modal=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.selectOptions(within(modal).getByLabelText("Action"),"link");await userEvent.type(within(modal).getByLabelText("Existing task ID"),feedbackId(70));await userEvent.click(within(modal).getByRole("button",{name:"Link existing task"}));await within(modal).findByText("Existing task linked. Thread remains open.");expect(links).toBe(1);
});
test("closing and reopening an uncertain feedback draft retains its operation and prevents another create",async()=>{
 fixtures();let creates=0;server.use(http.post("/api/v1/feedback-tasks",()=>{creates++;return HttpResponse.error();}));renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);let modal=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.type(within(modal).getByLabelText("Acceptance criteria"),"Readable at 320 px.");await userEvent.click(within(modal).getByRole("button",{name:"Create linked task"}));await within(modal).findByText(/outcome is unknown/i);const reference=within(within(modal).getByRole("region",{name:"Operation status"})).getByText(/^[0-9a-f]{8}-[0-9a-f-]{27}$/).textContent;await userEvent.click(within(modal).getByRole("button",{name:"Close draft"}));await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);modal=await screen.findByRole("dialog",{name:"Create feedback task"});expect(within(modal).getByText(reference!)).toBeInTheDocument();expect(within(modal).queryByRole("button",{name:"Create linked task"})).toBeNull();expect(creates).toBe(1);
});
test("follow then unfollow uses fresh versions and independent request digests",async()=>{
 fixtures();const desired:boolean[]=[];server.use(http.put("/api/v1/results/:id/follow",async({request})=>{const body=await request.json() as {operation_id:string;following:boolean;expected_version:string};expect(body.expected_version).toBe(String(desired.length+1));desired.push(body.following);const response=feedbackOperation(body.operation_id);response.data.request_digest=`sha256:${String(desired.length).repeat(64)}`;response.data.affected_entities=[{type:"result",id:detail.result.id,revision:String(desired.length+1)}];return HttpResponse.json(response);}));renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click(screen.getByRole("button",{name:"Apply follow preference"}));await userEvent.click(await screen.findByRole("button",{name:"Unfollow"}));await screen.findByRole("button",{name:"Follow"});expect(screen.queryByText(/outcome is unknown/i)).toBeNull();expect(desired).toEqual([true,false]);
});

test("retained operation URL checks and recovers the original task without a create POST",async()=>{
 fixtures();const id=feedbackId(80),origin={operation_id:id,expected_version:"1",thread_id:feedbackComment().thread_id,comment_id:feedbackComment().id,comment_revision:"1",result_id:detail.result.id,revision:detail.revision.revision,artifacts:[],project_id:project,expected_project_revision:"1",title:"Retained feedback",description:"Pinned discussion",acceptance_criteria:"Readable caption"};let creates=0,recoveries=0;
 server.use(http.post("/api/v1/feedback-tasks",()=>{creates++;return HttpResponse.error();}),http.get("/api/v1/operations/:id",()=>HttpResponse.json(feedbackOperation(id,"unknown"))),http.get("/api/v1/feedback-tasks/:id",()=>HttpResponse.json(feedbackEnvelope({operation_id:id,task_id:id,creation_disposition:recoveries?"confirmed":"unknown",link_confirmed:!!recoveries,result_id:detail.result.id,revision:detail.revision.revision,origin},project))),http.post("/api/v1/feedback-tasks/:id/recover",({params})=>{expect(params.id).toBe(id);recoveries++;return HttpResponse.json(feedbackOperation(id));}));
 renderApp(`/results/${detail.result.id}/revisions/${detail.revision.revision}?feedback_operation=${id}&feedback_result=${detail.result.id}&feedback_revision=${detail.revision.revision}`);const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await waitFor(()=>expect(within(draft).getByLabelText("Title")).toHaveValue("Retained feedback"));await userEvent.click(within(draft).getByRole("button",{name:"Recover original request"}));await within(draft).findByText("Feedback task created and linked. Thread remains open.");expect(creates).toBe(0);expect(recoveries).toBe(1);
});
test("pending feedback freezes its draft and conflict requires explicit revision",async()=>{
 fixtures();let creates=0,id="";server.use(http.post("/api/v1/feedback-tasks",async({request})=>{creates++;id=String((await request.json() as Record<string,unknown>).operation_id);return HttpResponse.json(feedbackOperation(id,"pending"));}),http.get("/api/v1/operations/:id",()=>HttpResponse.json(feedbackOperation(id,"conflict"))),http.get("/api/v1/feedback-tasks/:id",()=>HttpResponse.error()));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.type(within(draft).getByLabelText("Acceptance criteria"),"Readable caption");await userEvent.click(within(draft).getByRole("button",{name:"Create linked task"}));await within(draft).findByText("Operation pending.");expect(within(draft).getByLabelText("Title")).toBeDisabled();expect(within(draft).queryByRole("button",{name:"Create linked task"})).toBeNull();await userEvent.click(within(draft).getByRole("button",{name:"Check status"}));await within(draft).findByText("Operation conflict.");expect(within(draft).getByLabelText("Title")).toBeDisabled();await userEvent.click(within(draft).getByRole("button",{name:"Revise draft"}));await waitFor(()=>expect(within(draft).getByLabelText("Title")).toBeEnabled());expect(creates).toBe(1);
});

test("uncertain existing-task linking confirms through lookup without another link request",async()=>{
 fixtures();let links=0,id="";server.use(http.post("/api/v1/feedback-links",async({request})=>{links++;id=String((await request.json() as Record<string,unknown>).operation_id);return HttpResponse.error();}),http.get("/api/v1/operations/:id",()=>HttpResponse.json(feedbackOperation(id))));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.selectOptions(within(draft).getByLabelText("Action"),"link");await userEvent.type(within(draft).getByLabelText("Existing task ID"),feedbackId(71));await userEvent.click(within(draft).getByRole("button",{name:"Link existing task"}));await within(draft).findByText(/outcome is unknown/i);await userEvent.click(within(draft).getByRole("button",{name:"Check status"}));await within(draft).findByText("Existing task linked. Thread remains open.");expect(within(draft).getByRole("link",{name:"Open feedback task"})).toHaveAttribute("href",expect.stringContaining(feedbackId(71)));expect(links).toBe(1);
});
test("revising conflicted feedback refreshes thread and project guards while preserving pins",async()=>{
 fixtures();let version="1";const bodies:Record<string,unknown>[]=[];
 server.use(http.get("/api/v1/results/:id/revisions/:revision/comments",()=>HttpResponse.json(feedbackEnvelope({items:[{...feedbackComment(),thread_version:version}]},project))),http.get(`/api/human/projects/${project}/tasks`,()=>HttpResponse.json({...graphEnvelope({items:[],next_cursor:null}),project:{...graphEnvelope(null).project,id:project,revision:version}})),http.post("/api/v1/feedback-tasks",async({request})=>{const body=await request.json() as Record<string,unknown>;bodies.push(body);version="2";return HttpResponse.json(feedbackOperation(String(body.operation_id),"conflict"));}));
 renderApp("/results");await screen.findByText(detail.revision.summary);await userEvent.click((await screen.findAllByRole("button",{name:"Create feedback task"}))[0]!);const draft=await screen.findByRole("dialog",{name:"Create feedback task"});await userEvent.type(within(draft).getByLabelText("Acceptance criteria"),"Readable caption");await userEvent.click(within(draft).getByRole("button",{name:"Create linked task"}));await within(draft).findByText("Operation conflict.");await userEvent.click(within(draft).getByRole("button",{name:"Revise draft"}));await waitFor(()=>expect(within(draft).getByLabelText("Title")).toBeEnabled());await userEvent.click(within(draft).getByRole("button",{name:"Create linked task"}));await waitFor(()=>expect(bodies).toHaveLength(2));expect(bodies[0]).toMatchObject({expected_version:"1",expected_project_revision:"1"});expect(bodies[1]).toMatchObject({expected_version:"2",expected_project_revision:"2",comment_id:feedbackComment().id,comment_revision:"1",revision:detail.revision.revision});expect(bodies[0]!.operation_id).not.toBe(bodies[1]!.operation_id);
});
test("empty Needs review and Following tabs explain what belongs there (RA-08)",async()=>{
 fixtures();server.use(http.get("/api/v1/results",()=>HttpResponse.json(feedbackEnvelope({items:[],next_cursor:null}))));
 renderApp("/results?mode=needs_review");expect(await screen.findByText(/Nothing needs review\. A result appears here while it has an open comment thread, a pending review decision, or required evidence/)).toBeVisible();
 await userEvent.click(screen.getByRole("tab",{name:"Following"}));expect(await screen.findByText(/You aren't following any results in this scope/)).toBeVisible();
});
test("feed tabs follow the ARIA tabs pattern and keep focus across a mode change (RA-06, RA-07)",async()=>{
 fixtures();const modes:string[]=[];server.use(http.get("/api/v1/results",({request})=>{modes.push(new URL(request.url).searchParams.get("mode")!);return HttpResponse.json(feedbackEnvelope({items:[detail],next_cursor:null}));}));
 renderApp("/results");await screen.findByText(detail.revision.summary);
 const tabs=screen.getAllByRole("tab");expect(tabs.map(t=>t.tabIndex)).toEqual([0,-1,-1]);
 expect(tabs[0]).toHaveAttribute("aria-controls","results-feed-panel");expect(screen.getByRole("tabpanel",{name:"Latest"})).toBeInTheDocument();
 tabs[0]!.focus();await userEvent.keyboard("{ArrowRight}");
 await waitFor(()=>expect(modes.at(-1)).toBe("needs_review"));await screen.findByText(detail.revision.summary);
 const selected=screen.getByRole("tab",{name:"Needs review"});expect(selected).toHaveAttribute("aria-selected","true");expect(selected).toHaveFocus();expect(selected.tabIndex).toBe(0);
 await userEvent.keyboard("{End}");await waitFor(()=>expect(screen.getByRole("tab",{name:"Following"})).toHaveFocus());
 await userEvent.selectOptions(screen.getByRole("combobox",{name:"Media type"}),"image");
 await waitFor(()=>expect(screen.getByRole("combobox",{name:"Media type"})).toHaveFocus());
});
test("follow control uses the server's directly_following (RA-09)",async()=>{
 fixtures();server.use(http.get("/api/v1/results",()=>HttpResponse.json(feedbackEnvelope({items:[{...detail,result:{...detail.result,directly_following:true}}],next_cursor:null}))));
 renderApp("/results");await userEvent.click(await screen.findByText("Result context and evidence"));
 expect(screen.getByRole("button",{name:"Unfollow"})).toHaveAttribute("aria-pressed","true");expect(screen.queryByText("Direct follow state unavailable")).toBeNull();
});
test("card meta names the result id and the revision separately (RA-11)",async()=>{
 fixtures();renderApp("/results");const card=await screen.findByRole("article",{name:`Result ${detail.result.id}`});
 expect(within(card).getByText(`Result ${detail.result.id.slice(-8)}`)).toHaveAttribute("title",detail.result.id);
 expect(within(card).getByText(`revision ${detail.revision.revision.slice(0,7)}`)).toHaveAttribute("title",detail.revision.revision);
});
test("long summaries are clamped with an expand control and wrap after path separators (RA-12)",async()=>{
 const summary=Array.from({length:30},(_,i)=>`target/debug/.fingerprint/notes/${i}.md`).join(", ");
 fixtures();server.use(http.get("/api/v1/results",()=>HttpResponse.json(feedbackEnvelope({items:[{...detail,revision:{...detail.revision,summary}}],next_cursor:null}))));
 renderApp("/results");const heading=await screen.findByRole("heading",{name:summary});
 expect(heading).toHaveAttribute("data-clamped","true");expect(heading.querySelectorAll("wbr").length).toBeGreaterThan(30);
 await userEvent.click(screen.getByRole("button",{name:"Show full summary"}));expect(heading).not.toHaveAttribute("data-clamped");
 expect(screen.getByRole("button",{name:"Show less"})).toHaveAttribute("aria-expanded","true");
});
test("Custom… without dates is not an active filter (RA-19)",async()=>{
 fixtures();const {router}=renderApp("/results");await screen.findByText(detail.revision.summary);
 await userEvent.selectOptions(screen.getByRole("combobox",{name:"Time range"}),"custom");
 await userEvent.click(await screen.findByRole("button",{name:"Apply filters"}));
 await waitFor(()=>expect(new URLSearchParams(router.state.location.search).get("range")).toBeNull());
 expect(screen.getByRole("button",{name:/More filters/})).not.toHaveTextContent("active");expect(screen.getByRole("combobox",{name:"Time range"})).toHaveValue("any");
});
test("a stale range=custom link without dates reads as Any time (RA-19)",async()=>{
 fixtures();renderApp("/results?range=custom");await screen.findByText(detail.revision.summary);
 expect(screen.getByRole("combobox",{name:"Time range"})).toHaveValue("any");expect(screen.getByRole("button",{name:/More filters/})).not.toHaveTextContent("active");
});
test.each([["malformed ids","/results/not-a-uuid/revisions/abc"],["an unknown result",`/results/${feedbackId(77)}/revisions/${"a".repeat(64)}`]])("result detail for %s is neutral and keeps Back to results (RA-20)",async(_,path)=>{
 fixtures();let reads=0;server.use(http.get("/api/v1/results/:id/revisions/:revision",()=>{reads++;return HttpResponse.json({request_id:"r",code:"not_found",message:"Resource not found",retryable:false},{status:404});}));
 renderApp(path);expect(await screen.findByText("This item does not exist or is not available to you.")).toBeVisible();
 expect(screen.getByRole("link",{name:"Back to results"})).toHaveAttribute("href","/results");expect(screen.queryByRole("button",{name:"Try again"})).toBeNull();
 if(path.includes("not-a-uuid"))expect(reads).toBe(0);
});
test("a result outside the selected project scope says so and keeps Back to results (RA-20)",async()=>{
 fixtures();renderApp(`/results/${detail.result.id}/revisions/${detail.revision.revision}?scope=project:${feedbackId(88)}`);
 expect(await screen.findByText(/This result is not in the selected project/)).toBeVisible();expect(screen.getByRole("link",{name:"Back to results"})).toBeVisible();
});
test("RA-05: a refused Task ID filter keeps the toolbar so it can be corrected, and is not retried",async()=>{
 fixtures();let reads=0;server.use(http.get("/api/v1/results",({request})=>{reads++;return new URL(request.url).searchParams.has("task_id")?HttpResponse.json({request_id:"r",code:"invalid_request",message:"task_id is invalid",retryable:false},{status:422}):HttpResponse.json(feedbackEnvelope({items:[detail],next_cursor:null}));}));
 renderApp("/results?task=not-a-task");
 expect(await screen.findByRole("alert")).toHaveTextContent("AQ can't read results with these settings. Check the address or filters.");
 expect(screen.queryByRole("button",{name:"Try again"})).toBeNull();expect(screen.getByRole("button",{name:/More filters/})).toBeInTheDocument();expect(screen.getByRole("tablist",{name:"Result feed mode"})).toBeInTheDocument();expect(reads).toBe(1);
});
test("RA-10: closing the desktop comments panel returns focus to the card's Comments button",async()=>{
 fixtures();const original=window.matchMedia;window.matchMedia=((query:string)=>({matches:query.includes("1200px"),media:query,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){},onchange:null,dispatchEvent:()=>false})) as typeof window.matchMedia;
 try{
  renderApp("/results");const open=await screen.findByRole("button",{name:"Comments 1"});await userEvent.click(open);
  await userEvent.click(await screen.findByRole("button",{name:"Close comments"}));
  await waitFor(()=>expect(open).toHaveFocus());
 }finally{window.matchMedia=original;}
});
