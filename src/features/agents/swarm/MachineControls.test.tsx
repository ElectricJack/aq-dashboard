import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { SWARM_MOCKUP, SWARM_STOPPED, swarmEnvelope } from "../../../mocks/swarm";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";

const server = setupServer(...handlersFor("default"));
let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); server.listen({ onUnhandledFrame: "error" }); });
beforeEach(() => sessionStorage.clear());
afterEach(() => { server.resetHandlers(); server.events.removeAllListeners(); });
afterAll(() => { server.close(); restore(); });

const swarm = (data: unknown) => server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope(data))));
async function openMachine(name: RegExp = /^desktop/) { renderApp("/agents"); fireEvent.click(await screen.findByRole("button", { name })); }
const button = (name: string) => screen.findByRole("button", { name });
async function confirmAndSubmit(title: string, checkbox: RegExp) {
  const dialog = await screen.findByRole("dialog", { name: title });
  await userEvent.click(within(dialog).getByRole("checkbox", { name: checkbox }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  return dialog;
}

test("stop posts worker.stop with the machine generation", async () => {
  let seen: { body: Record<string, unknown>; header: string | null } | null = null;
  server.use(http.post("/api/v1/actions", async ({ request }) => { seen = { body: await request.clone().json() as Record<string, unknown>, header: request.headers.get("X-AQ-Request") }; return undefined; }));
  await openMachine();
  await userEvent.click(await button("Stop worker"));
  const dialog = await screen.findByRole("dialog", { name: "Stop worker" });
  expect(dialog).toHaveTextContent("4 running agents will be handed off.");
  await confirmAndSubmit("Stop worker", /Stop desktop now/);
  await waitFor(() => expect(seen).not.toBeNull());
  expect(seen!.header).toBe("1");
  expect(seen!.body).toMatchObject({ kind: "worker.stop", subject: { type: "machine", id: "desktop" }, expected_versions: {}, payload: { machine: "desktop", expected_generation: "1" } });
  expect((seen!.body.payload as { operation_id: string }).operation_id).toBe(seen!.body.operation_id);
});

test("start is disabled while running and enabled when stopped", async () => {
  await openMachine();
  expect(await button("Start worker")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Start worker" })).toHaveAttribute("title", "Already running");
  expect(screen.getByRole("button", { name: "Drain" })).toBeEnabled();
  cleanup();
  swarm(SWARM_STOPPED);
  await openMachine();
  await waitFor(() => expect(screen.getByRole("button", { name: "Start worker" })).toBeEnabled());
  expect(screen.getByRole("button", { name: "Stop worker" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Drain" })).toHaveAttribute("title", "Only a running worker can drain");
});

test("status line shows handing-off count", async () => {
  swarm(SWARM_STOPPED);
  await openMachine();
  expect(await screen.findByText("Worker: stopped, handing off 1")).toBeInTheDocument();
});

test("status line reports draining and drained", async () => {
  const draining = (agents: boolean) => ({ ...SWARM_MOCKUP, machines: SWARM_MOCKUP.machines.map(m => m.id !== "desktop" ? m : {
    ...m, control: { desired: "draining" as const, generation: "3", since: null, pending_handoffs: 0 }, nodes: agents ? m.nodes : m.nodes.map(n => ({ ...n, agents: [] })) }) });
  swarm(draining(true));
  await openMachine();
  expect(await screen.findByText("Worker: draining (4 running)")).toBeInTheDocument();
  cleanup();
  swarm(draining(false));
  await openMachine();
  expect(await screen.findByText("Worker: drained")).toBeInTheDocument();
});

test("legacy machine has no worker controls", async () => {
  await openMachine(/^studio, local/);
  expect(await button("Start worker")).toBeDisabled();
  expect(screen.getByRole("button", { name: "Stop worker" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Drain" })).toBeDisabled();
  expect(screen.getByText("This machine's worker is not installed as a service, so it cannot be started or stopped here.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Revoke machine" })).toBeNull();
});

test("disabled with the existing note without swarm.worker.control", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !["swarm.read", "swarm.worker.control"].includes(c.name)), { name: "swarm.read", version: "1", enabled: true }] } })));
  await openMachine();
  expect(await button("Start worker")).toBeDisabled();
  expect(screen.getByText("Worker start, stop and drain are not available on this server yet.")).toBeInTheDocument();
});

test("shows the server's capability reason when worker control is not advertised", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !["swarm.read", "swarm.worker.control"].includes(c.name)), { name: "swarm.read", version: "1", enabled: true },
    { name: "swarm.worker.control", version: "1", enabled: false, reason: "Worker control requires an owner account" }] } })));
  await openMachine();
  expect(await button("Start worker")).toBeDisabled();
  expect(screen.getByText("Worker control requires an owner account")).toBeInTheDocument();
});

test("an unrecognised worker state allows removal", async () => {
  swarm({ ...SWARM_MOCKUP, machines: SWARM_MOCKUP.machines.map(m => m.id !== "desktop" ? m : { ...m, control: { desired: "hibernating", generation: "1", since: null, pending_handoffs: 0 } }) });
  await openMachine();
  expect(await screen.findByText(/reported an unrecognised state/)).toBeInTheDocument();
  expect(screen.queryByText(/not installed as a service/)).toBeNull();
  expect(screen.getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(await screen.findByRole("button", { name: "Remove machine" })).toBeEnabled();
});

test("an unsettled operation does not follow the selection to another machine", async () => {
  const other = { ...SWARM_MOCKUP.machines[0]!, id: "desk2", label: "desk2", nodes: [] };
  swarm({ ...SWARM_MOCKUP, machines: [...SWARM_MOCKUP.machines, other] });
  const posts: { subject: { id: string }; operation_id: string }[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { posts.push(await request.clone().json() as never); return HttpResponse.error(); }));
  await openMachine();
  await userEvent.click(await button("Stop worker"));
  const dialog = await confirmAndSubmit("Stop worker", /Stop desktop now/);
  expect(await within(dialog).findByText(/Outcome unknown/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close action" }));
  expect(await button("Stop worker · operation")).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: /^desk2/ }));
  expect(await screen.findByRole("button", { name: "Stop worker" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Stop worker · operation" })).toBeNull();
  const sent = posts.length;
  await userEvent.click(screen.getByRole("button", { name: "Stop worker" }));
  const fresh = await confirmAndSubmit("Stop worker", /Stop desk2 now/);
  await waitFor(() => expect(posts.length).toBeGreaterThan(sent));
  expect(posts.slice(sent).every(p => p.subject.id === "desk2")).toBe(true);
  expect(new Set(posts.map(p => p.operation_id)).size).toBe(2);
  expect(fresh).toBeInTheDocument();
});

test("conflict shows reload guidance", async () => {
  server.use(http.post("/api/v1/actions", () => HttpResponse.json({ request_id: "r", code: "conflict", message: "The machine control generation changed.", retryable: false }, { status: 409 })));
  await openMachine();
  await userEvent.click(await button("Drain"));
  const dialog = await confirmAndSubmit("Drain", /Drain desktop/);
  expect(await within(dialog).findByRole("status")).toHaveTextContent("Reload to see its current state");
  expect(within(dialog).getByRole("button", { name: "Reload current state" })).toBeInTheDocument();
});

test("confirmation is required", async () => {
  const posts: string[] = [];
  server.use(http.post("/api/v1/actions", async ({ request }) => { posts.push(await request.text()); return undefined; }));
  await openMachine();
  await userEvent.click(await button("Stop worker"));
  const dialog = await screen.findByRole("dialog", { name: "Stop worker" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Submit" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Confirm this action before submitting.");
  expect(posts).toHaveLength(0);
});

test("a confirmed action refetches the swarm", async () => {
  let reads = 0;
  server.use(http.get("/api/v1/swarm", () => { reads++; return HttpResponse.json(swarmEnvelope(SWARM_MOCKUP)); }));
  await openMachine();
  await userEvent.click(await button("Start worker").then(() => button("Drain")));
  const before = reads;
  const dialog = await confirmAndSubmit("Drain", /Drain desktop/);
  expect(await within(dialog).findByText("Worker drain confirmed.")).toBeInTheDocument();
  await waitFor(() => expect(reads).toBeGreaterThan(before));
});

function cleanup() { document.body.innerHTML = ""; }
