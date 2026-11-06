import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import bootstrap from "../../../contracts/proposed/bootstrap.json";

// The shared default mock enables human.graph.read for Work and Knowledge, which
// routes test/mock Search to the legacy project-graph results. These cases cover
// the production /api/v1/search surface, so their bootstrap omits that capability.
const productionSearch = () => http.get("/api/v1/bootstrap", () => HttpResponse.json(bootstrap));
const server = setupServer(productionSearch(), ...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function openSearch() {
  await userEvent.click(await screen.findByRole("button", { name: "Search" }));
  return screen.getByRole("dialog", { name: "Search" });
}

test("the Search button opens the dialog with the input focused", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  expect(within(dialog).getByRole("searchbox", { name: "Search" })).toHaveFocus();
});

test("Ctrl+K opens the same dialog", async () => {
  renderApp("/overview");
  await screen.findByRole("button", { name: "Search" });
  await userEvent.keyboard("{Control>}k{/Control}");
  expect(screen.getByRole("dialog", { name: "Search" })).toBeVisible();
});

test("results are grouped by type and link to their subject", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const tasks = await within(dialog).findByRole("list", { name: "Tasks" });
  const link = within(tasks).getByRole("link", { name: /^Fixture: Approve recovery plan/ });
  // SO-05: with All projects selected, a task link carries the hit's project so Work can open it.
  expect(link).toHaveAttribute("href", "/work/00000000-0000-0000-0000-000000000104?scope=project%3Aagent-queue");
});

test("search is scoped to the selected project", async () => {
  let scopeSent: string | null = "unset";
  server.use(
    http.get("/api/v1/search", ({ request }) => {
      scopeSent = new URL(request.url).searchParams.get("scope");
      return HttpResponse.json({
        api_version: "proposed-0", request_id: "r", server_time: "2026-10-31T12:00:00.000Z",
        scope: { kind: "project", project_id: "matter-engine" },
        observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
        pending_operations: [], coverage: { state: "complete" }, data: { groups: [] },
      });
    }),
  );
  renderApp("/overview?scope=project:matter-engine");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "terrain");
  await within(dialog).findByText(/no matches/i);
  expect(scopeSent).toBe("project:matter-engine");
});

test("arrow keys move from the input through results", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const links = await within(dialog).findAllByRole("link");
  await userEvent.keyboard("{ArrowDown}");
  expect(links[0]).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(links[1]).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}{ArrowUp}");
  expect(within(dialog).getByRole("searchbox")).toHaveFocus();
});

test("choosing a result navigates and closes the dialog", async () => {
  const { router } = renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  await userEvent.click(await within(dialog).findByRole("link", { name: /^Fixture: Approve recovery plan/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/work/00000000-0000-0000-0000-000000000104"));
  expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
});

test("closing returns focus to the Search button", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close search" }));
  expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
});

test("short queries do not search", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "r");
  expect(within(dialog).getByText(/type at least 2 characters/i)).toBeInTheDocument();
});

test("a failed search shows an error, not 'no matches'", async () => {
  server.use(...handlersFor("reads-failed"));
  server.use(productionSearch());
  renderApp("/overview");
  await screen.findByRole("button", { name: "Search" });
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/couldn't load search results/i);
  expect(within(dialog).queryByText(/no matches/i)).not.toBeInTheDocument();
});

test("a malformed search response closes protected views with a compatibility gate", async () => {
  server.use(
    http.get("/api/v1/search", () =>
      HttpResponse.json({
        api_version: "proposed-0", request_id: "r", server_time: "2026-10-31T12:00:00.000Z",
        scope: { kind: "all_authorized" },
        observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
        pending_operations: [], coverage: { state: "complete" }, data: { nope: true },
      }),
    ),
  );
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  expect(await screen.findByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
});

test("results are announced as a count, not read out in full", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const tasks = await within(dialog).findByRole("list", { name: "Tasks" });
  expect(tasks.closest("[aria-live]")).toBeNull();
  expect(within(dialog).getByRole("status")).toHaveTextContent(/\d+ results?/);
});

test('G4 continuation preserves group/query/scope and deduplicates replayed references',async()=>{
 const {g4Handlers}=await import('../../test/g4');server.use(...g4Handlers());
 const source=(await import('../../../contracts/pinned/dashboard-read/v1/fixtures/search-nonempty.json')).default;
 const fixture={...source,scope:{kind:'all_authorized'}};
 const requests:URLSearchParams[]=[];
 server.use(http.get('/api/v1/search',({request})=>{
  const p=new URL(request.url).searchParams;requests.push(p);
  const group=fixture.data.groups[0]!;
  return HttpResponse.json(p.has('cursor')?{...fixture,data:{...fixture.data,groups:[{...group,has_more:false,next_cursor:null,hits:[...group.hits,{...group.hits[0]!,ref:{...group.hits[0]!.ref,id:'another'},title:'Next task'}]}]}}:fixture);
 }));
 renderApp('/overview');const dialog=await openSearch();await userEvent.type(within(dialog).getByRole('searchbox'),'example');
 await userEvent.click(await within(dialog).findByRole('button',{name:'More tasks'}));
 expect(await within(dialog).findByRole('link',{name:/Next task/})).toBeVisible();
 expect(within(dialog).getAllByRole('link',{name:/example task 1/})).toHaveLength(1);
 const p=requests.find(p=>p.has('cursor'))!;expect(p.get('types')).toBe('task');expect(p.get('q')).toBe('example');expect(p.get('cursor')).toBe(fixture.data.groups[0]!.next_cursor);expect(p.get('scope')).toBeNull();
 expect(within(dialog).getByRole('heading',{name:'Knowledge'})).toBeInTheDocument();
 // SO-18: groups without hits are not rendered as bare headings.
 expect(within(dialog).queryByRole('heading',{name:'Sessions'})).toBeNull();
 expect(within(dialog).queryByRole('heading',{name:'Playbooks'})).toBeNull();
});
test('expired G4 cursor requires explicit restart; authorization failure clears results',async()=>{
 const {g4Handlers}=await import('../../test/g4');server.use(...g4Handlers());
 const source=(await import('../../../contracts/pinned/dashboard-read/v1/fixtures/search-nonempty.json')).default;
 const fixture={...source,scope:{kind:'all_authorized'}};
 let forbidden=false;let firstReads=0;
 server.use(http.get('/api/v1/search',({request})=>{
  if(new URL(request.url).searchParams.has('cursor'))return HttpResponse.json({}, {status:forbidden?403:410});
  firstReads++;return HttpResponse.json(fixture);
 }));
 renderApp('/overview');let dialog=await openSearch();await userEvent.type(within(dialog).getByRole('searchbox'),'example');
 await userEvent.click(await within(dialog).findByRole('button',{name:'More tasks'}));
 const restart=await within(dialog).findByRole('button',{name:'Restart search'});expect(firstReads).toBe(1);
 await userEvent.click(restart);await waitFor(()=>expect(firstReads).toBe(2));forbidden=true;
 await userEvent.click(await within(dialog).findByRole('button',{name:'More tasks'}));
 expect(await screen.findByRole('heading',{name:/access denied/i})).toBeVisible();expect(screen.queryByRole('dialog',{name:'Search'})).toBeNull();
});

/* ----- QA 2026-11-06 shell-overview regressions ----- */

test("SO-05: a task hit in a project scope keeps that scope", async () => {
  renderApp("/overview?scope=project:agent-queue");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const tasks = await within(dialog).findByRole("list", { name: "Tasks" });
  expect(within(tasks).getByRole("link", { name: /^Fixture: Approve recovery plan/ })).toHaveAttribute("href", "/work/00000000-0000-0000-0000-000000000104?scope=project%3Aagent-queue");
});

test("SO-05: only routes that need a project switch scope", async () => {
  const { hitScope } = await import("./SearchDialog");
  const all = { kind: "all_authorized" } as const;
  const project = { id: "p1", label: "P1" };
  expect(hitScope({ ref: { type: "task" }, project }, all)).toEqual({ kind: "project", project_id: "p1" });
  expect(hitScope({ ref: { type: "knowledge" }, project }, all)).toEqual({ kind: "project", project_id: "p1" });
  expect(hitScope({ ref: { type: "result" }, project }, all)).toEqual(all);
  expect(hitScope({ ref: { type: "task" } }, all)).toEqual(all);
  const scoped = { kind: "project", project_id: "p2" } as const;
  expect(hitScope({ ref: { type: "task" }, project }, scoped)).toEqual(scoped);
});

test("SO-19: a query over the server limit is explained and never sent", async () => {
  let requests = 0;
  server.use(http.get("/api/v1/search", () => { requests++; return HttpResponse.json({}, { status: 422 }); }));
  renderApp("/overview");
  const dialog = await openSearch();
  const box = within(dialog).getByRole("searchbox");
  await userEvent.click(box);
  await userEvent.paste("x".repeat(600));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Search is limited to 256 characters");
  expect(box).toHaveAttribute("aria-invalid", "true");
  await new Promise((r) => setTimeout(r, 400));
  expect(requests).toBe(0);
  expect(within(dialog).queryByText(/couldn't load/i)).toBeNull();
});

test("SO-19: the limit counts UTF-8 bytes like the server and ignores control characters", async () => {
  const { queryTooLong, normalizeQuery } = await import("./SearchDialog");
  expect(queryTooLong("a".repeat(256))).toBe(false);
  expect(queryTooLong("a".repeat(257))).toBe(true);
  expect(queryTooLong("é".repeat(129))).toBe(true);
  expect(normalizeQuery(" step\t2\n ")).toBe("step 2");
});

test("SO-18: placeholder names more than tasks and sessions; cut titles end at a word", async () => {
  const { displayTitle } = await import("./SearchDialog");
  renderApp("/overview");
  const dialog = await openSearch();
  expect(within(dialog).getByRole("searchbox")).toHaveAttribute("placeholder", expect.stringMatching(/results, knowledge/));
  const cut = `${"word ".repeat(50)}plus a unit test, and a .`.slice(0, 256);
  expect(Array.from(cut)).toHaveLength(256);
  expect(displayTitle(cut)).toMatch(/[a-z]…$/);
  expect(displayTitle(cut)).not.toMatch(/ \.…$/);
  expect(displayTitle("Short title")).toBe("Short title");
});

test("SO-18: a group without hits is hidden", async () => {
  server.use(http.get("/api/v1/search", () => HttpResponse.json({
    api_version: "proposed-0", request_id: "r", server_time: "2026-10-31T12:00:00.000Z", scope: { kind: "all_authorized" },
    observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
    pending_operations: [], coverage: { state: "complete" },
    data: { groups: [
      { type: "task", hits: [{ ref: { type: "task", id: "t1" }, title: "Only task", project: { id: "p1", label: "P1" } }], has_more: false },
      { type: "session", hits: [], has_more: false },
    ] },
  })));
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "only");
  expect(await within(dialog).findByRole("link", { name: /Only task/ })).toBeVisible();
  expect(within(dialog).queryByRole("heading", { name: "Sessions" })).toBeNull();
});
