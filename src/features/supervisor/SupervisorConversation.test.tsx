import { webcrypto } from "node:crypto";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { supervisorActor, supervisorDiscovery as discovery, supervisorHistory, supervisorId, supervisorMessage, supervisorActionReceipt, supervisorReply } from "../../test/supervisor";
import { compareSupervisorCursors, type SupervisorMessage } from "../../api/adapters/supervisor";
import * as supervisorAdapters from "../../api/adapters/supervisor";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("matchMedia", (query: string) => Object.assign(new EventTarget(), { matches: query === "(pointer: fine)", media: query, onchange: null, addListener() {}, removeListener() {} })); });
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => server.close());
const base = `/api/human/conversations/${discovery.conversation.id}`;
function setup(options: { path?: string; history?: SupervisorMessage[]; enabled?: boolean; write?: boolean; limits?: Partial<typeof discovery.limits> } = {}) {
  const stored = [...(options.history ?? [supervisorMessage(1)])], posts: string[] = [], reads: string[] = [];
  let discoveries = 0;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, global_supervisor: { status: "available", conversation_id: discovery.conversation.id }, principal: { ...bootstrap.data.principal, id: supervisorActor }, capabilities: [
      ...bootstrap.data.capabilities.filter(cap => !["supervisor.history.read", "supervisor.message.enqueue", "supervisor.conversation"].includes(cap.name)),
      { name: "dashboard.actions", version: "1", enabled: true }, { name: "supervisor.conversation", version: "1", enabled: true }, { name: "supervisor.history.read", version: "1", enabled: options.enabled ?? true }, { name: "supervisor.message.enqueue", version: "1", enabled: options.write ?? true },
    ] } })),
    http.get("/api/human/conversations/global", () => { discoveries++; return HttpResponse.json({ ...discovery, limits: { ...discovery.limits, ...options.limits } }); }),
    http.get(`${base}/messages`, ({ request }) => {
      const url = new URL(request.url); reads.push(url.search);
      const before = url.searchParams.get("before"), after = url.searchParams.get("after"), limit = Number(url.searchParams.get("limit") ?? 16);
      let items = stored.filter(item => (!before || compareSupervisorCursors(item.cursor, before) < 0) && (after === null || compareSupervisorCursors(item.cursor, after) > 0));
      const hasMore = items.length > limit; items = after !== null ? items.slice(0, limit) : items.slice(-limit);
      return HttpResponse.json(supervisorHistory(items, { direction: after !== null ? "forward" : "backward", through_cursor: stored.at(-1)?.cursor.split(".")[0] ?? "0", has_more: hasMore, next_cursor: hasMore ? (after !== null ? items.at(-1)!.cursor : items[0]!.cursor) : null }));
    }),
    http.post("/api/v1/actions", async ({ request }) => {
      const bytes = await request.text(); posts.push(bytes); const body = JSON.parse(bytes).payload;
      const result = supervisorActionReceipt(bytes); const item = supervisorMessage(stored.length + 1, body.body); item.message_id = body.message_id; stored.push(item);
      return HttpResponse.json(result);
    }),
  );
  return { ...renderApp(options.path ?? "/supervisor"), posts, stored, reads, discoveries: () => discoveries };
}
const composer = () => screen.findByRole("textbox", { name: "Message the global supervisor" });
async function ready() {
  // Bootstrap mounts the workspace; discovery then enables history controls.
  // Give each async stage its normal deadline instead of timing the entire
  // initial request chain with the final history assertion's 1000 ms budget.
  await composer();
  await waitFor(() => expect(screen.queryByText("Loading conversation history…")).toBeNull());
  return screen.findByText("Retained human message 1");
}
async function send(text: string) { const input = await composer(); await userEvent.type(input, text); await userEvent.click(screen.getByRole("button", { name: "Send" })); }

test("a server that disables context refs and attachments (limits 0) still renders the text-only Supervisor workspace and bounds bodies by its limit", async () => {
  const app = setup({ limits: { context_refs: 0, attachments: 0, body_bytes: 32 } }); await ready();
  expect(screen.queryByText(/Dashboard update required/)).toBeNull();
  expect(screen.getAllByText(/Text only/).length).toBeGreaterThan(0);
  expect(screen.queryByRole("button", { name: /attach|add context/i })).toBeNull();
  await send("x".repeat(33));
  expect(await screen.findByText("Message exceeds 32 bytes.")).toBeInTheDocument(); expect(app.posts).toHaveLength(0);
  await userEvent.clear(await composer()); await send("Short enough");
  await waitFor(() => expect(app.posts).toHaveLength(1));
  expect(JSON.parse(app.posts[0]!).payload).toMatchObject({ body: "Short enough", context: [], attachments: [] });
});
test("granular history capability gates all mailbox requests independently of legacy runtime capability", async () => {
  const app = setup({ enabled: false });
  await screen.findByText(/Supervisor history is unavailable/); expect(app.discoveries()).toBe(0); expect(app.posts).toHaveLength(0);
});
test("keeps one global history and draft across project changes without scoped routing", async () => {
  const app = setup(); await ready(); await userEvent.type(await composer(), "Preserved global draft");
  await act(() => app.router.navigate("/supervisor?scope=project:other-project"));
  expect(await composer()).toHaveValue("Preserved global draft"); expect(screen.getByText("Retained human message 1")).toBeInTheDocument();
  expect(app.discoveries()).toBe(1); expect(app.reads.every(search => !search.includes("scope"))).toBe(true);
  expect(screen.getByText(/Global conversation · All projects/)).toBeInTheDocument();
});
test("sends one frozen text-only intent and renders actual queued history without inventing a reply", async () => {
  const app = setup(); await ready(); await userEvent.type(await composer(), "Inspect the retained boundary");
  await userEvent.dblClick(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Queued in the global mailbox. This acknowledgement does not confirm delivery or completed work.");
  expect(app.posts).toHaveLength(1); const body = JSON.parse(app.posts[0]!).payload;
  expect(body.context).toEqual([]); expect(body.attachments).toEqual([]); expect(body.expected_conversation_revision).toBe("1"); expect(body.message_id).not.toBe(body.operation_id);
  expect(new URLSearchParams(app.router.state.location.search).get("operation")).toBe(body.operation_id);
  expect(app.router.state.location.search).not.toContain("Inspect");
  expect(await within(screen.getByRole("list", { name: "Supervisor messages" })).findByText("Inspect the retained boundary")).toBeInTheDocument();
  expect(screen.queryByText(/typing|delivered|supervisor replied/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Compose another message" })).toBeEnabled();
});
test("lost response and missing lookup receipt keep exact intent; retry preserves every byte and both IDs", async () => {
  const app = setup(); await ready(); let writes = 0; const bytes: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { const value = await request.text(); bytes.push(value); return ++writes === 1 ? HttpResponse.error() : HttpResponse.json(supervisorActionReceipt(value)); }),
    http.get(`/api/v1/operations/:operation`, () => new HttpResponse(null, { status: 404 })));
  await send("Only the original request"); await screen.findByText(/Message status is unknown/);
  expect(await composer()).toHaveValue("Only the original request"); expect(await composer()).toHaveAttribute("readonly");
  await userEvent.click(screen.getByRole("button", { name: "Check message status" })); await screen.findByText(/No receipt is available yet/);
  expect(writes).toBe(1); expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry exact message" })); await screen.findByText("Queued in the global mailbox. This acknowledgement does not confirm delivery or completed work.");
  expect(bytes).toHaveLength(2); expect(bytes[0]).toBe(bytes[1]); expect(app.posts).toHaveLength(0);
});
test("401 after send clears private draft/history and fences later writes", async () => {
  const app = setup(); await ready(); let writes = 0;
  server.use(http.post("/api/v1/actions", () => { writes++; return new HttpResponse(null, { status: 401 }); }));
  await send("Private request to clear");
  await screen.findByRole("heading", { name: "Sign in required" });
  expect(screen.queryByText("Retained human message 1")).toBeNull(); expect(screen.queryByDisplayValue("Private request to clear")).toBeNull();
  expect(writes).toBe(1); expect(app.posts).toHaveLength(0);
});
test("403 after send is refused in the composer and keeps the draft (QA §2A)", async () => {
  const app = setup(); await ready(); let writes = 0;
  server.use(http.post("/api/v1/actions", () => { writes++; return HttpResponse.json({ request_id: "r", code: "forbidden", message: "This request is not available to your account", retryable: false }, { status: 403 }); }));
  await send("Draft kept after refusal");
  expect(await screen.findByText(/^Not sent: AQ refused this request\..*Your draft is preserved\.$/)).toBeInTheDocument();
  expect(screen.getByDisplayValue("Draft kept after refusal")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Access denied" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(writes).toBe(1); expect(app.posts).toHaveLength(0);
});
test("typed not-queued receipt allows deliberate revision, preserving the draft", async () => {
  setup(); await ready(); server.use(http.post("/api/v1/actions", async ({ request }) => HttpResponse.json(supervisorActionReceipt(await request.text(), "conflict"), { status: 409 })));
  await send("Revise only after retained refusal"); await screen.findByText(/Not queued: the conversation revision changed/);
  await userEvent.click(screen.getByRole("button", { name: "Revise message" }));
  expect(await composer()).toHaveValue("Revise only after retained refusal"); expect(await composer()).not.toHaveAttribute("readonly");
});
test("operation deep link only looks up its receipt and never reconstructs or sends a body", async () => {
  const operation = supervisorId(30), message = supervisorId(31);
  let lookups = 0; server.use(http.get(`/api/v1/operations/${operation}`, () => { lookups++; return new HttpResponse(null, { status: 404 }); }));
  const app = setup({ path: `/supervisor?operation=${operation}&message=${message}` });
  await screen.findByText(/No receipt is available yet/); await ready();
  expect(lookups).toBe(1); expect(app.posts).toHaveLength(0); expect(screen.queryByRole("button", { name: "Retry exact message" })).toBeNull();
  expect(await composer()).toHaveValue(""); expect(screen.getByText(/original request body is no longer held/)).toBeInTheDocument();
});
test("older pages prepend chronological messages with bounded explicit paging", async () => {
  setup({ history: Array.from({ length: 21 }, (_, i) => supervisorMessage(i + 1)) });
  await screen.findByText("Retained human message 21"); expect(screen.queryByText("Retained human message 1")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Load older messages" })); await ready();
  const rows = within(screen.getByRole("list", { name: "Supervisor messages" })).getAllByRole("listitem");
  expect(rows).toHaveLength(21); expect(rows[0]).toHaveTextContent("Retained human message 1"); expect(rows.at(-1)).toHaveTextContent("Retained human message 21");
});
test("IME composition and Shift+Enter never enqueue prematurely", async () => {
  const app = setup(); await ready(); const input = await composer(); fireEvent.change(input, { target: { value: "Composing a message" } });
  fireEvent.compositionStart(input); fireEvent.keyDown(input, { key: "Enter" }); fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true }); fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(app.posts).toHaveLength(0); fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByText("Queued in the global mailbox. This acknowledgement does not confirm delivery or completed work."); expect(app.posts).toHaveLength(1);
});
test("history-only authority preserves a usable draft and cannot enqueue", async () => {
  const app = setup({ write: false }); await ready(); await userEvent.type(await composer(), "Draft without enqueue permission");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(); expect(app.posts).toHaveLength(0);
});
test("changing operation reference fences a late response from the original intent", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  const app = setup(); await ready();
  server.use(http.post("/api/v1/actions", async ({ request }) => { const bytes = await request.text(); posts++; await gate; return HttpResponse.json(supervisorActionReceipt(bytes)); }),
    http.get(`/api/v1/operations/:operation`, () => new HttpResponse(null, { status: 404 })));
  await send("Old private pending message"); await waitFor(() => expect(posts).toBe(1));
  await act(() => app.router.navigate(`/supervisor?operation=${supervisorId(80)}&message=${supervisorId(81)}`));
  await screen.findByText(/No receipt is available yet/);
  await act(async () => { release(); await gate; });
  expect(screen.queryByText("Queued in the global mailbox. This acknowledgement does not confirm delivery or completed work.")).toBeNull();
  expect(await composer()).toHaveValue(""); expect(screen.queryByRole("button", { name: "Retry exact message" })).toBeNull();
});
test("new history does not scroll a reader who moved up and offers an explicit latest marker", async () => {
  const app = setup(); await ready();
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const region = screen.getByRole("region", { name: "Conversation history" });
  Object.defineProperty(region, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(region, "clientHeight", { configurable: true, value: 100 });
  region.scrollTop = 0; fireEvent.scroll(region); app.stored.push(supervisorMessage(2));
  await userEvent.click(screen.getByRole("button", { name: /history/i }));
  await userEvent.click(screen.getByRole("button", { name: "Refresh messages" }));
  await screen.findByText("Retained human message 2");
  expect(within(region).getByRole("button", { name: "New messages" })).toBeInTheDocument();
  expect(region.scrollTop).toBe(0);
});
test("a stale rejected preparation cannot clear the newer operation lookup's busy state", async () => {
  let rejectPreparation!: (reason: Error) => void, releaseLookup!: () => void;
  const preparation = new Promise<supervisorAdapters.FrozenSupervisorMessage>((_, reject) => { rejectPreparation = reject; });
  const lookup = new Promise<void>(resolve => { releaseLookup = resolve; }); let lookups = 0;
  vi.spyOn(supervisorAdapters, "freezeSupervisorMessage").mockImplementationOnce(() => preparation);
  const app = setup(); await ready();
  server.use(http.get(`/api/v1/operations/:operation`, async () => { lookups++; await lookup; return new HttpResponse(null, { status: 404 }); }));
  await send("Old preparation must not own newer state");
  await act(() => app.router.navigate(`/supervisor?operation=${supervisorId(90)}&message=${supervisorId(91)}`));
  await waitFor(() => expect(lookups).toBe(1));
  await act(async () => { rejectPreparation(new Error("old preparation rejected")); });
  expect(screen.getByRole("button", { name: "Check message status" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
  expect(screen.queryByText(/Could not prepare the message/)).toBeNull();
  expect(await composer()).toHaveValue("");
  await act(async () => { releaseLookup(); await lookup; });
  await screen.findByText(/No receipt is available yet/);
  expect(screen.getByRole("button", { name: "Check message status" })).toBeEnabled();
});
test.each([401, 403])("%s clears private state even when the subsequent bootstrap is offline", async status => {
  const app = setup(); await ready(); let bootstrapReads = 0;
  server.use(http.post("/api/v1/actions", () => new HttpResponse(null, { status })),
    http.get("/api/v1/bootstrap", () => { bootstrapReads++; return new HttpResponse(null, { status: 503 }); }));
  await send("Private draft before offline bootstrap");
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access not confirmed" });
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
  await waitFor(() => expect(bootstrapReads).toBeGreaterThan(0));
  expect(screen.getByRole("heading", { name: status === 401 ? "Sign in required" : "Access not confirmed" })).toBeInTheDocument();
  expect(screen.queryByText("Retained human message 1")).toBeNull();
  expect(screen.queryByDisplayValue("Private draft before offline bootstrap")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message the global supervisor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Check message status" })).toBeNull();
});


test("supervisor_dock_send_shows_pending_then_reply", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  const app = setup({ path: "/overview" });
  await userEvent.click(await screen.findByRole("button", { name: "Open supervisor" }));
  await ready();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const posted: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => {
    const bytes = await request.text(); posted.push(bytes); await gate;
    const body = JSON.parse(bytes).payload;
    app.stored.push({ ...supervisorMessage(2, body.body), message_id: body.message_id });
    app.stored.push(supervisorReply(2));
    return HttpResponse.json(supervisorActionReceipt(bytes));
  }));
  await send("Please inspect the work");
  await screen.findByText("Sending · awaiting admission");
  await userEvent.click(screen.getByRole("button", { name: "Expand conversation" }));
  expect(app.router.state.location.pathname).toBe("/supervisor");
  expect(await composer()).toHaveValue("Please inspect the work");
  await act(async () => { release(); await gate; });
  await screen.findByText("The supervisor replied to your message.");
  expect(posted).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Dock chat" }));
  expect(app.router.state.location.pathname).toBe("/overview");
  expect(screen.getByText("The supervisor replied to your message.")).toBeInTheDocument();
  expect(posted).toHaveLength(1);
});


test("unavailable supervisor preserves the draft and refuses action sends", async () => {
  const app = setup(); await ready(); await userEvent.type(await composer(), "Keep while disconnected");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: supervisorActor }, global_supervisor: { status: "unavailable", conversation_id: discovery.conversation.id }, capabilities: [ { name: "supervisor.history.read", version: "1", enabled: true }, { name: "supervisor.conversation", version: "1", enabled: false } ] } })));
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
  await screen.findByText(/Conversation unavailable; your draft is preserved/);
  expect(await composer()).toHaveValue("Keep while disconnected");
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled(); expect(app.posts).toHaveLength(0);
});

test("dock does not mistake another workspace's operation for a supervisor send", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  const app = setup({ path: `/overview?operation=${supervisorId(88)}` });
  await userEvent.click(await screen.findByRole("button", { name: "Open supervisor" })); await ready();
  await userEvent.type(await composer(), "Independent supervisor draft");
  expect(screen.getByRole("button", { name: "Send" })).toBeEnabled(); expect(app.posts).toHaveLength(0);
});

test("dock header shows only expand and close, with short metadata carrying the full delivery text", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  setup({ path: "/overview" });
  await userEvent.click(await screen.findByRole("button", { name: "Open supervisor" })); await ready();
  const dock = screen.getByRole("region", { name: "Global supervisor conversation" });
  const header = within(dock).getByRole("heading", { name: "Global supervisor" }).closest("header")!;
  expect(within(header).getAllByRole("button").map(button => button.getAttribute("aria-label"))).toEqual(["Expand conversation", "Close chat"]);
  const metadata = within(dock).getByText("Retained human message 1").nextElementSibling!;
  expect(metadata).toHaveTextContent(/^You · .+ · Queued · Delivery not attempted$/);
  const status = within(metadata as HTMLElement).getByText("Queued", { exact: false });
  expect(status).toHaveAttribute("tabindex", "0");
  await userEvent.click(within(header).getByRole("button", { name: "Expand conversation" }));
  expect(await screen.findByRole("button", { name: /history/i })).toBeInTheDocument();
});
test("SO-14/ISSUE-007: opening the dock moves focus into it and closing returns it to the launcher", async () => {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  setup({ path: "/overview" });
  await userEvent.click(await screen.findByRole("button", { name: "Open supervisor" }));
  const input = await composer();
  await waitFor(() => expect(input).toHaveFocus());
  await userEvent.click(screen.getByRole("button", { name: "Close chat" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Open supervisor" })).toHaveFocus());
});


test("global and project supervisors keep separate drafts, and Start works before a controller is online",async()=>{
 const app=setup();
 const project='a22afccc-d61a-5f77-aef8-9fd73311c68a',conversation='e0000000-0000-4000-8000-000000000099';
 const profile={profile_id:'standard-medium',profile_version:1,candidate_id:'codex',name:'Standard',provider:'openai',model:'gpt-test',reasoning:'medium',harness:'codex'};
 const scope=(id:string,project_id:string|null,label:string)=>({id,actor_id:supervisorActor,project_id,label,enabled:false,revision:0,profile:null,phase:'unavailable',stage:'Controller not started',observed_at_ms:null,generation:null,session_id:null,last_error:null});
 const global=scope(discovery.conversation.id,null,'Global supervisor'),local=scope(conversation,project,'AQ server supervisor');
 const controls:unknown[]=[];
 server.use(http.get('/api/supervisors',()=>HttpResponse.json({supervisors:[global,local],profiles:[profile],server_time_ms:1})),
 http.get(`/api/human/conversations/projects/${project}`,()=>HttpResponse.json({...discovery,conversation:{id:conversation,revision:'1',label:local.label}})),
 http.get(`/api/human/conversations/${conversation}/messages`,()=>HttpResponse.json({...supervisorHistory([]),conversation:{id:conversation,revision:'1',label:local.label}})),
 http.post(`/api/supervisors/${conversation}/control`,async({request})=>{const body=await request.json() as Record<string,unknown>;controls.push(body);return HttpResponse.json({...body,conversation_id:conversation,revision:1});}));
 await ready();await userEvent.type(await composer(),'Global draft');
 await userEvent.selectOptions(await screen.findByRole('combobox',{name:'Supervisor'}),`project:${project}`);
 const input=await screen.findByRole('textbox',{name:'Message the project supervisor'});expect(input).toHaveValue('');await userEvent.type(input,'Project draft');
 await userEvent.click(screen.getByRole('button',{name:'Start supervisor'}));await waitFor(()=>expect(controls).toHaveLength(1));expect(controls[0]).toMatchObject({enabled:true,expected_revision:0,intelligence_profile:{profile_id:'standard-medium',candidate_id:'codex'}});
 await userEvent.selectOptions(screen.getByRole('combobox',{name:'Supervisor'}),'global');expect(await composer()).toHaveValue('Global draft');
 await userEvent.selectOptions(screen.getByRole('combobox',{name:'Supervisor'}),`project:${project}`);expect(await screen.findByRole('textbox',{name:'Message the project supervisor'})).toHaveValue('Project draft');
 app.unmount();
});
