import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { SWARM_MOCKUP, swarmEnvelope } from "../../../mocks/swarm";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";

const server = setupServer(...handlersFor("default"));
let restore: () => void;
beforeAll(() => { restore = stubReactFlowDom(); server.listen({ onUnhandledFrame: "error" }); });
beforeEach(() => sessionStorage.clear());
afterEach(() => { server.resetHandlers(); server.events.removeAllListeners(); });
afterAll(() => { server.close(); restore(); });

const card = async (name: RegExp | string) => screen.findByRole("button", { name });
const fact = (label: string) => screen.getByText(label, { selector: "dt" }).nextElementSibling as HTMLElement;
const click = async (name: RegExp | string) => fireEvent.click(await card(name));

test("server pane shows health version and running agents", async () => {
  renderApp("/agents");
  await click(/^AQ server/);
  await waitFor(() => expect(fact("Health").textContent).toMatch(/^ok · v/));
  expect(fact("Running agents")).toHaveTextContent(/^4$/);
});

test("machine pane shows load source and limits", async () => {
  renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(fact("Load source")).toHaveTextContent("Windows host (WSL2)"));
  expect(fact("Cores / RAM")).toHaveTextContent("24 / 64 GB");
  expect(screen.getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(screen.getByText("Worker start, stop and drain are not available on this server yet.")).toBeInTheDocument();
});

test("machine pane names a stale Windows probe", async () => {
  const machines = SWARM_MOCKUP.machines.map(m => (m.id === "desktop" ? { ...m, load: { ...m.load!, host_probe: "stale" as const, fresh: false } } : m));
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines }))));
  renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(fact("Note")).toHaveTextContent("Windows host probe stale: showing WSL VM load"));
  expect(fact("Load now")).toHaveTextContent(/as of/);
});

test("holding machine lists reason and remedy", async () => {
  renderApp("/agents");
  await click(/^studio, local/);
  await waitFor(() => expect(fact("Holding")).toHaveTextContent("Context measurement expired — Measure this worker's runtime again"));
});

test("free slot on a holding machine explains why", async () => {
  renderApp("/agents");
  await card(/^desktop/);
  const free = await screen.findAllByRole("button", { name: "free" });
  fireEvent.click(free[1]!);
  await waitFor(() => expect(fact("Why")).toHaveTextContent("Free, but this machine is holding back: Context measurement expired"));
  expect(fact("Fix")).toHaveTextContent("Measure this worker's runtime again");
});

test("waiting agent pane gives why and fix", async () => {
  renderApp("/agents");
  await card(/^waiting/);
  const pills = screen.getAllByRole("button", { name: "claude · deep" }).filter(b => b.getAttribute("data-kind") === "waitingAgent");
  fireEvent.click(pills[0]!);
  await waitFor(() => expect(fact("Why")).toHaveTextContent("Every slot on an eligible machine is busy"));
  expect(fact("Fix")).toHaveTextContent("Wait for a running agent to finish, or add a machine");
});

test("agent pane opens a terminal with control requested", async () => {
  server.use(...handlersFor("default", { fixtures: true }));
  renderApp("/agents");
  await click("claude · standard");
  expect(await screen.findByRole("region", { name: "Agent terminal" })).toBeInTheDocument();
  expect(await screen.findByText("You have control", {}, { timeout: 8000 })).toBeInTheDocument();
});

test("agent pane is watch-only without terminal.control", async () => {
  const posts: string[] = [];
  server.use(...handlersFor("default", { fixtures: true }));
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !["terminal.control", "terminal.watch", "swarm.read", "dashboard.overview"].includes(c.name)),
    { name: "terminal.watch", version: "1", enabled: true }, { name: "swarm.read", version: "1", enabled: true },
    { name: "terminal.control", version: "1", enabled: false, reason: "Terminal control is not offered" }] } })));
  server.events.on("request:start", ({ request }) => { if (request.method === "POST" && request.url.includes("/mutations")) void request.clone().json().then(b => posts.push((b as { kind: string }).kind)); });
  renderApp("/agents");
  await click("claude · standard");
  const region = await screen.findByRole("region", { name: "Agent terminal" });
  await waitFor(() => expect(within(region).getAllByText("Watch only").length).toBeGreaterThan(0), { timeout: 8000 });
  expect(posts).not.toContain("control");
});

test("selection survives reload through ?select=", async () => {
  renderApp("/agents?select=machine:desktop");
  await waitFor(() => expect(fact("Load source")).toHaveTextContent("Windows host (WSL2)"));
});

test("pane widens for an agent", async () => {
  renderApp("/agents");
  await click("claude · standard");
  await waitFor(() => expect(screen.getByRole("complementary", { name: "Properties" }).parentElement).toHaveAttribute("data-wide"));
});
