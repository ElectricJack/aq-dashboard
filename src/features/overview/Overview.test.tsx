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
 expect(within(region).getByRole('link',{name:/Inspect: Failed process result/})).toHaveAttribute('href',expect.stringContaining('/revisions/sha256%3A'));
 expect(within(region).getByRole('button',{name:'Inspect: Worker offline'})).toBeVisible();
 expect(screen.getByRole('region',{name:'Recent outcomes'})).toHaveTextContent('Process failed');
 expect(screen.getByText('Source coverage')).toBeInTheDocument();
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
