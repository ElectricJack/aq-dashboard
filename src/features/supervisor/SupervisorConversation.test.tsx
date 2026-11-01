import { webcrypto } from "node:crypto";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { supervisorActor, supervisorDiscovery as discovery, supervisorHistory, supervisorId, supervisorMessage, supervisorReceipt } from "../../test/supervisor";
import type { SupervisorMessage } from "../../api/adapters/supervisor";
import * as supervisorAdapters from "../../api/adapters/supervisor";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("matchMedia", () => ({ matches: true })); });
afterEach(() => { server.resetHandlers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
afterAll(() => server.close());
const base = `/api/human/conversations/${discovery.conversation.id}`;
function setup(options: { path?: string; history?: SupervisorMessage[]; enabled?: boolean; write?: boolean } = {}) {
  const stored = [...(options.history ?? [supervisorMessage(1)])], posts: string[] = [], reads: string[] = [];
  let discoveries = 0;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: supervisorActor }, capabilities: [
      ...bootstrap.data.capabilities.filter(cap => !["supervisor.history.read", "supervisor.message.enqueue"].includes(cap.name)),
      { name: "supervisor.history.read", version: "1", enabled: options.enabled ?? true }, { name: "supervisor.message.enqueue", version: "1", enabled: options.write ?? true },
    ] } })),
    http.get("/api/human/conversations/global", () => { discoveries++; return HttpResponse.json(discovery); }),
    http.get(`${base}/messages`, ({ request }) => {
      const url = new URL(request.url); reads.push(url.search);
      const before = url.searchParams.get("before"), after = url.searchParams.get("after"), limit = Number(url.searchParams.get("limit") ?? 16);
      let items = stored.filter(item => (!before || BigInt(item.cursor) < BigInt(before)) && (after === null || BigInt(item.cursor) > BigInt(after)));
      const hasMore = items.length > limit; items = after !== null ? items.slice(0, limit) : items.slice(-limit);
      return HttpResponse.json(supervisorHistory(items, { direction: after !== null ? "forward" : "backward", through_cursor: stored.at(-1)?.cursor ?? "0", has_more: hasMore, next_cursor: hasMore ? (after !== null ? items.at(-1)!.cursor : items[0]!.cursor) : null }));
    }),
    http.post(`${base}/messages`, async ({ request }) => {
      const bytes = await request.text(); posts.push(bytes); const body = JSON.parse(bytes);
      const result = supervisorReceipt(bytes); const item = supervisorMessage(stored.length + 1, body.body); item.message_id = body.message_id; stored.push(item); result.cursor = item.cursor;
      return HttpResponse.json(result);
    }),
  );
  return { ...renderApp(options.path ?? "/supervisor"), posts, stored, reads, discoveries: () => discoveries };
}
const composer = () => screen.findByRole("textbox", { name: "Message the global supervisor" });
const ready = () => screen.findByText("Retained human message 1");
async function send(text: string) { const input = await composer(); await userEvent.type(input, text); await userEvent.click(screen.getByRole("button", { name: "Send message" })); }

test("granular history capability gates all mailbox requests independently of legacy runtime capability", async () => {
  const app = setup({ enabled: false });
  await screen.findByText(/Supervisor history is unavailable/); expect(app.discoveries()).toBe(0); expect(app.posts).toHaveLength(0);
});
test("keeps one global history and draft across project changes without scoped routing", async () => {
  const app = setup(); await ready(); await userEvent.type(await composer(), "Preserved global draft");
  await act(() => app.router.navigate("/supervisor?scope=project:other-project"));
  expect(await composer()).toHaveValue("Preserved global draft"); expect(screen.getByText("Retained human message 1")).toBeInTheDocument();
  expect(app.discoveries()).toBe(1); expect(app.reads.every(search => !search.includes("scope"))).toBe(true);
  expect(screen.getByText(/Supervisor is not connected/)).toBeInTheDocument();
});
test("sends one frozen text-only intent and renders actual queued history without inventing a reply", async () => {
  const app = setup(); await ready(); await userEvent.type(await composer(), "Inspect the retained boundary");
  await userEvent.dblClick(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("Queued in the global mailbox. Delivery has not been attempted.");
  expect(app.posts).toHaveLength(1); const body = JSON.parse(app.posts[0]!);
  expect(body.context).toEqual([]); expect(body.attachments).toEqual([]); expect(body.expected_conversation_revision).toBe("1"); expect(body.message_id).not.toBe(body.operation_id);
  expect(new URLSearchParams(app.router.state.location.search).get("operation")).toBe(body.operation_id);
  expect(app.router.state.location.search).not.toContain("Inspect");
  expect(await within(screen.getByRole("list", { name: "Supervisor messages" })).findByText("Inspect the retained boundary")).toBeInTheDocument();
  expect(screen.queryByText(/typing|delivered|supervisor replied/i)).toBeNull();
  expect(screen.getByRole("button", { name: "Compose another message" })).toBeEnabled();
});
test("lost response and missing lookup receipt keep exact intent; retry preserves every byte and both IDs", async () => {
  const app = setup(); await ready(); let writes = 0; const bytes: string[] = [];
  server.use(http.post(`${base}/messages`, async ({ request }) => { const value = await request.text(); bytes.push(value); return ++writes === 1 ? HttpResponse.error() : HttpResponse.json(supervisorReceipt(value)); }),
    http.get(`${base}/operations/:operation`, () => new HttpResponse(null, { status: 404 })));
  await send("Only the original request"); await screen.findByText(/Message status is unknown/);
  expect(await composer()).toHaveValue("Only the original request"); expect(await composer()).toHaveAttribute("readonly");
  await userEvent.click(screen.getByRole("button", { name: "Check message status" })); await screen.findByText(/No receipt is available yet/);
  expect(writes).toBe(1); expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Retry exact message" })); await screen.findByText("Queued in the global mailbox. Delivery has not been attempted.");
  expect(bytes).toHaveLength(2); expect(bytes[0]).toBe(bytes[1]); expect(app.posts).toHaveLength(0);
});
test.each([401, 403])("%s after send clears private draft/history and fences later writes", async status => {
  const app = setup(); await ready(); let writes = 0;
  server.use(http.post(`${base}/messages`, () => { writes++; return new HttpResponse(null, { status }); }));
  await send("Private request to clear");
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" });
  expect(screen.queryByText("Retained human message 1")).toBeNull(); expect(screen.queryByDisplayValue("Private request to clear")).toBeNull();
  expect(writes).toBe(1); expect(app.posts).toHaveLength(0);
});
test("typed not-queued receipt allows deliberate revision, preserving the draft", async () => {
  setup(); await ready(); server.use(http.post(`${base}/messages`, async ({ request }) => HttpResponse.json(supervisorReceipt(await request.text(), "not_queued"), { status: 409 })));
  await send("Revise only after retained refusal"); await screen.findByText(/Not queued: the conversation revision changed/);
  await userEvent.click(screen.getByRole("button", { name: "Revise message" }));
  expect(await composer()).toHaveValue("Revise only after retained refusal"); expect(await composer()).not.toHaveAttribute("readonly");
});
test("operation deep link only looks up its receipt and never reconstructs or sends a body", async () => {
  const operation = supervisorId(30), message = supervisorId(31);
  let lookups = 0; server.use(http.get(`${base}/operations/${operation}`, () => { lookups++; return new HttpResponse(null, { status: 404 }); }));
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
  await screen.findByText("Queued in the global mailbox. Delivery has not been attempted."); expect(app.posts).toHaveLength(1);
});
test("history-only authority preserves a usable draft and cannot enqueue", async () => {
  const app = setup({ write: false }); await ready(); await userEvent.type(await composer(), "Draft without enqueue permission");
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled(); expect(app.posts).toHaveLength(0);
});
test("changing operation reference fences a late response from the original intent", async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
  const app = setup(); await ready();
  server.use(http.post(`${base}/messages`, async ({ request }) => { const bytes = await request.text(); posts++; await gate; return HttpResponse.json(supervisorReceipt(bytes)); }),
    http.get(`${base}/operations/:operation`, () => new HttpResponse(null, { status: 404 })));
  await send("Old private pending message"); await waitFor(() => expect(posts).toBe(1));
  await act(() => app.router.navigate(`/supervisor?operation=${supervisorId(80)}&message=${supervisorId(81)}`));
  await screen.findByText(/No receipt is available yet/);
  await act(async () => { release(); await gate; });
  expect(screen.queryByText("Queued in the global mailbox. Delivery has not been attempted.")).toBeNull();
  expect(await composer()).toHaveValue(""); expect(screen.queryByRole("button", { name: "Retry exact message" })).toBeNull();
});
test("new history does not scroll a reader who moved up and offers an explicit latest marker", async () => {
  const app = setup(); await ready();
  await act(() => new Promise(resolve => requestAnimationFrame(resolve)));
  const region = screen.getByRole("region", { name: "Conversation history" });
  Object.defineProperty(region, "scrollHeight", { configurable: true, value: 1000 });
  Object.defineProperty(region, "clientHeight", { configurable: true, value: 100 });
  region.scrollTop = 0; fireEvent.scroll(region); app.stored.push(supervisorMessage(2));
  await userEvent.click(screen.getByRole("button", { name: "Refresh history" }));
  await screen.findByText("Retained human message 2");
  expect(screen.getByRole("button", { name: "New messages available · Show latest" })).toBeInTheDocument();
  expect(region.scrollTop).toBe(0);
});
test("a stale rejected preparation cannot clear the newer operation lookup's busy state", async () => {
  let rejectPreparation!: (reason: Error) => void, releaseLookup!: () => void;
  const preparation = new Promise<supervisorAdapters.FrozenSupervisorMessage>((_, reject) => { rejectPreparation = reject; });
  const lookup = new Promise<void>(resolve => { releaseLookup = resolve; }); let lookups = 0;
  vi.spyOn(supervisorAdapters, "freezeSupervisorMessage").mockImplementationOnce(() => preparation);
  const app = setup(); await ready();
  server.use(http.get(`${base}/operations/:operation`, async () => { lookups++; await lookup; return new HttpResponse(null, { status: 404 }); }));
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
  server.use(http.post(`${base}/messages`, () => new HttpResponse(null, { status })),
    http.get("/api/v1/bootstrap", () => { bootstrapReads++; return new HttpResponse(null, { status: 503 }); }));
  await send("Private draft before offline bootstrap");
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" });
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
  await waitFor(() => expect(bootstrapReads).toBeGreaterThan(0));
  expect(screen.getByRole("heading", { name: status === 401 ? "Sign in required" : "Access denied" })).toBeInTheDocument();
  expect(screen.queryByText("Retained human message 1")).toBeNull();
  expect(screen.queryByDisplayValue("Private draft before offline bootstrap")).toBeNull();
  expect(screen.queryByRole("textbox", { name: "Message the global supervisor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Check message status" })).toBeNull();
});
