import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function attention() {
  return screen.findByRole("region", { name: "Needs your attention" });
}

test("lists attention items with reason, impact, age and project", async () => {
  renderApp("/overview");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("Approve worker recovery plan");
  expect(rows[0]).toHaveTextContent("agent-queue");
  expect(rows[0]).toHaveTextContent("Review");
  expect(rows[0]).toHaveTextContent("waiting 18m");
  expect(rows[0]).toHaveTextContent("Unblocks 4 tasks");
});

test("the next-action link opens the exact subject", async () => {
  const { router } = renderApp("/overview");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  await userEvent.click(within(rows[2]!).getByRole("link", { name: /inspect.*resolve integration conflict/i }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/work/me-301"));
});

test("shows counts with unknown rendered as unknown, not zero", async () => {
  renderApp("/overview");
  const counts = await screen.findByRole("list", { name: "Work counts" });
  expect(within(counts).getByText("running").parentElement).toHaveTextContent(/\d+\s*running/);
  const recovering = within(counts).getByText("recovering").parentElement!;
  expect(recovering).not.toHaveTextContent(/0\s*recovering/);
  expect(within(recovering).getByLabelText("unknown")).toBeInTheDocument();
});

test("an empty complete read says nothing needs attention", async () => {
  server.use(...handlersFor("empty"));
  renderApp("/overview");
  const region = await attention();
  expect(await within(region).findByText("Nothing needs your attention")).toBeInTheDocument();
});

test("a partial read warns that the list may be incomplete", async () => {
  server.use(...handlersFor("partial"));
  renderApp("/overview");
  const region = await attention();
  expect(await within(region).findByText(/may be incomplete/i)).toBeInTheDocument();
  expect(within(region).queryByText("Nothing needs your attention")).not.toBeInTheDocument();
});

test("a failed read never looks like an empty queue", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/overview");
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/couldn't load/i);
  expect(screen.queryByText("Nothing needs your attention")).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Work counts" })).not.toBeInTheDocument();
});

test("project scope narrows attention to that project", async () => {
  renderApp("/overview?scope=project:quilt-trader");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("Choose retry policy");
});

test("shows work in motion and recent outcomes", async () => {
  renderApp("/overview");
  const motion = await screen.findByRole("table", { name: "Work in motion" });
  expect(within(motion).getAllByRole("row").length).toBeGreaterThan(1);
  const outcomes = screen.getByRole("region", { name: "Recent outcomes" });
  expect(within(outcomes).getByText("Renderer fix")).toBeInTheDocument();
  expect(within(outcomes).getByText(/merged/i)).toBeInTheDocument();
});

test("attention rows and counts carry decorative icons", async () => {
  renderApp("/overview");
  const rows = await within(await attention()).findAllByRole("listitem");
  for (const row of rows) expect(row.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  const counts = screen.getByRole("list", { name: "Work counts" });
  for (const item of within(counts).getAllByRole("listitem")) {
    expect(item.querySelector("svg[aria-hidden='true']")).not.toBeNull();
  }
});

test('overview_attention_renders_live_items',async()=>{
 const {g4Handlers}=await import('../../test/g4');server.use(...g4Handlers());
 renderApp('/overview');const region=await attention();
 expect(await within(region).findByText('Worker offline')).toBeVisible();
 expect(within(region).getByText('Waiting decision')).toBeVisible();
 expect(within(region).getByText('Failed process result')).toBeVisible();
 expect(within(region).getAllByText(/waiting age unknown/i)).toHaveLength(2);
 expect(within(region).getByRole('link',{name:/Inspect: Failed process result/})).toHaveAttribute('href',expect.stringMatching(/\/revisions\/[0-9a-f]{64}$/));
 expect(within(region).getByRole('button',{name:'Inspect: Worker offline, worker c46754c8'})).toBeVisible();
 expect(screen.getByRole('region',{name:'Recent outcomes'})).toHaveTextContent('Process failed');
 expect(screen.queryByText('Source coverage')).not.toBeInTheDocument();
 expect(screen.getByText(/Some overview information is unavailable or incomplete/)).toBeVisible();
 expect(screen.getByRole('link',{name:'View diagnostics'})).toHaveAttribute('href','/settings#overview-diagnostics');
 expect(screen.getByRole('table',{name:'Work in motion'})).toBeInTheDocument();
});
test('question and unsupported attention kinds have distinct controls',async()=>{
 const {http,HttpResponse}=await import('msw');const fixture=(await import('../../../contracts/proposed/bootstrap.json')).default;
 const raw=(await import('../../../contracts/pinned/dashboard-read/v1/fixtures/overview-nonempty.json')).default;
 server.use(http.get('/api/v1/overview',()=>HttpResponse.json({...raw,api_version:fixture.api_version,data:{...raw.data,attention:[{...raw.data.attention[1],id:'q',kind:'question',subject:{type:'decision',id:'q',revision:'1'},title:'Answer the question'},{...raw.data.attention[1],id:'u',kind:'future',title:'Future item'}]}})));
 renderApp('/overview');const region=await attention();expect(await within(region).findByRole('link',{name:'Answer: Answer the question'})).toBeVisible();expect(within(region).getByText('Unsupported item type')).toBeVisible();
});

test('failed refresh of an empty read never claims nothing needs attention',async()=>{
 server.use(...handlersFor('empty'));const {queryClient}=renderApp('/overview');
 expect(await within(await attention()).findByText('Nothing needs your attention')).toBeVisible();
 const {http,HttpResponse}=await import('msw');server.use(http.get('/api/v1/overview',()=>HttpResponse.json({},{status:503})));
 await queryClient.invalidateQueries({predicate:q=>q.queryKey.includes('overview')});
 await waitFor(()=>expect(screen.queryByText('Nothing needs your attention')).toBeNull());
 expect(within(await attention()).getByText(/may be incomplete/i)).toBeVisible();
});

/* ----- QA 2026-11-06 shell-overview regressions ----- */

async function liveOverview(patch: (data: Record<string, unknown>) => Record<string, unknown>, scope?: string) {
 const {g4Handlers}=await import('../../test/g4');const {http,HttpResponse}=await import('msw');
 const raw=(await import('../../../contracts/pinned/dashboard-read/v1/fixtures/overview-nonempty.json')).default;
 // The first handler in one server.use call wins, so the patched overview goes before the G4 set.
 server.use(http.get('/api/v1/overview',()=>HttpResponse.json({...raw,...(scope&&{scope:{kind:'project',project_id:scope}}),data:patch(structuredClone(raw.data) as unknown as Record<string, unknown>)})),...g4Handlers());
 return raw;
}

test('SO-04: successful outcomes are labelled and each outcome link has its own name',async()=>{
 await liveOverview(data=>{
  const [failed]=data.recent_outcomes as {subject:{id:string;revision:string}}[];
  return {...data,recent_outcomes:[
   {...failed,outcome:'process_success',subject:{...failed!.subject,id:'11111111-1111-4111-8111-111111111111',revision:'sha256:'+'a'.repeat(64)}},
   {...failed,outcome:'process_success',subject:{...failed!.subject,id:'22222222-2222-4222-8222-222222222222',revision:'sha256:'+'b'.repeat(64)}},
   failed,
  ]};
 });
 renderApp('/overview');
 const outcomes=await screen.findByRole('region',{name:'Recent outcomes'});
 await waitFor(()=>expect(within(outcomes).getAllByText(/Process succeeded/)).toHaveLength(2));
 expect(outcomes).not.toHaveTextContent('Unsupported outcome');
 const names=within(outcomes).getAllByRole('link').filter(l=>l.getAttribute('href')?.startsWith('/results/')).map(l=>l.getAttribute('aria-label'));
 expect(names).toHaveLength(3);
 expect(new Set(names).size).toBe(3);
 for(const name of names)expect(name).toMatch(/^Recorded process result [0-9a-f]{7}, Process (succeeded|failed), /);
});

test('SO-06: one Worker offline row per worker, not attributed to a project',async()=>{
 await liveOverview(data=>{
  const [worker,...rest]=data.attention as {id:string;project:unknown}[];
  return {...data,attention:[worker,{...worker,id:`${worker!.id}:other`,project:{id:'00000000-0000-0000-0000-000000000009',label:'Other project'}},...rest]};
 });
 renderApp('/overview');const region=await attention();
 await within(region).findByText('Worker offline');
 const rows=region.querySelectorAll("[data-kind='worker_offline']");
 expect(rows).toHaveLength(1);
 expect(rows[0]).toHaveTextContent('Installation-wide');
 expect(rows[0]).not.toHaveTextContent('Synthetic authority fixture');
 expect(within(region).getByText(/Worker nodes shows every heartbeat/)).toBeVisible();
});

test('SO-07: summary and counts never claim fewer items than the attention list shows',async()=>{
 await liveOverview(data=>({...data,counts:{...(data.counts as object),needs_you:{value:0,accuracy:'estimated'}}}));
 renderApp('/overview');const region=await attention();
 await within(region).findByText('Worker offline');
 expect(screen.getByTestId('overview-summary')).toHaveTextContent('At least 3 items need you. No work is running.');
 expect(screen.getByTestId('overview-summary')).not.toHaveTextContent(/Few or no|moving/);
 const counts=screen.getByRole('list',{name:'Work counts'});
 expect(within(counts).getByLabelText('at least 3')).toHaveTextContent('3+');
 expect(within(region).getByRole('link',{name:/view all/i})).toHaveTextContent('View all 3+');
});

test('SO-07: work is moving only when a project reports running work',async()=>{
 const {attentionSentence,motionSentence,reconcileNeedsYou}=await import('./Overview');
 const row=(value:number|null)=>({project:{id:'p',label:'P'},running:{value,accuracy:value===null?'unknown' as const:'exact' as const},nextConstraint:null,lastProgressAt:null});
 expect(motionSentence([row(0)],true)).toBe('No work is running.');
 expect(motionSentence([row(0),row(2)],true)).toBe('Work is moving in 1 project.');
 expect(motionSentence([row(null)],true)).toBe('Project movement is not reported.');
 expect(motionSentence([],true)).toBe('No work is in motion.');
 expect(attentionSentence(reconcileNeedsYou({value:3,accuracy:'exact'},2))).toBe('3 items need you.');
 expect(attentionSentence({value:1,accuracy:'exact'})).toBe('1 item needs you.');
 expect(attentionSentence({value:6,accuracy:'estimated'})).toBe('About 6 items need you.');
 expect(attentionSentence({value:0,accuracy:'exact'})).toBe('No items need you.');
 expect(attentionSentence(reconcileNeedsYou({value:null,accuracy:'unknown'},1))).toBe('At least 1 item needs you.');
 expect(attentionSentence(reconcileNeedsYou({value:null,accuracy:'unknown'},0))).toMatch(/unknown/);
});

test('SO-09: Inspect eligibility keeps the project scope',async()=>{
 renderApp('/overview?scope=project:quilt-trader');
 const link=await screen.findByRole('link',{name:/Inspect eligibility/});
 expect(link).toHaveAttribute('href','/settings?scope=project%3Aquilt-trader');
});

test('SO-11: an unknown project scope says the project is unavailable, with a way back',async()=>{
 const {http,HttpResponse}=await import('msw');
 server.use(http.get('/api/v1/overview',()=>HttpResponse.json({request_id:'r',code:'invalid_request',message:'Invalid request',retryable:false},{status:422})));
 renderApp('/overview?scope=project:bogus');
 expect(await screen.findByRole('heading',{name:'Project not available'},{timeout:15_000})).toBeVisible();
 expect(screen.getByTestId('overview-summary')).toHaveTextContent('This project is not available.');
 expect(screen.queryByText(/couldn't load/i)).toBeNull();
 expect(screen.queryByRole('region',{name:'Pinned sessions'})).toBeNull();
 expect(screen.getByRole('link',{name:/Show all projects/})).toHaveAttribute('href','/overview');
},20_000);

test('SO-16: Work in motion project rows open that project in Work',async()=>{
 renderApp('/overview');
 const motion=await screen.findByRole('table',{name:'Work in motion'});
 const link=await within(motion).findByRole('link',{name:'agent-queue'});
 expect(link).toHaveAttribute('href','/work?scope=project%3Aagent-queue');
});

test('SO-17: worker heartbeats read as ages, not raw timestamps',async()=>{
 const {http,HttpResponse}=await import('msw');
 await liveOverview(data=>data);
 server.use(http.get('/api/workers',()=>HttpResponse.json([{id:'w1',name:'worker-one',status:'offline',last_seen_at:'1970-01-01T00:06:40.000Z'}])));
 renderApp('/overview');
 await userEvent.click(await screen.findByText('More capacity'));
 await userEvent.click(await screen.findByText('Inspect heartbeat observations'));
 const time=await screen.findByText('10m ago');
 expect(time.tagName).toBe('TIME');
 expect(time).toHaveAttribute('dateTime','1970-01-01T00:06:40.000Z');
 expect(screen.queryByText('1970-01-01T00:06:40.000Z')).toBeNull();
});
