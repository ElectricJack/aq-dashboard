import { usageLabel } from "./SwarmPane";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { SWARM_MOCKUP, swarmEnvelope } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
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
  const head = screen.getByRole("heading", { level: 2, name: window.location.host });
  expect(head.previousElementSibling).toHaveTextContent("AQ server");
});

test("machine pane shows load source and limits", async () => {
  renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(fact("Load source")).toHaveTextContent("Windows host (WSL2)"));
  expect(fact("Cores / RAM")).toHaveTextContent("24 / 64 GB");
  expect(screen.getByRole("button", { name: "Start worker" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Start worker" })).toHaveAttribute("title", "Already running");
});

test("machine pane names a stale Windows probe", async () => {
  const machines = SWARM_MOCKUP.machines.map(m => (m.id === "desktop" ? { ...m, load: { ...m.load!, host_probe: "stale" as const, fresh: false } } : m));
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines }))));
  renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(fact("Note")).toHaveTextContent("Windows host probe stale: showing WSL VM load"));
  expect(fact("Load now")).toHaveTextContent(/as of/);
});

test("machine pane shows a plain WSL VM label when the host probe is missing, with no note", async () => {
  const machines = SWARM_MOCKUP.machines.map(m => (m.id === "desktop" ? { ...m, load: { ...m.load!, source: "linux" as const, host_probe: "missing" as const } } : m));
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines }))));
  renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(fact("Load source")).toHaveTextContent("WSL VM"));
  expect(screen.queryByText(/missing/i)).not.toBeInTheDocument();
  expect(screen.queryByText("Note")).not.toBeInTheDocument();
});

test("machine pane shows Linux when the host probe is not applicable", async () => {
  renderApp("/agents");
  await click(/^studio, local/);
  await waitFor(() => expect(fact("Load source")).toHaveTextContent(/^Linux$/));
  expect(screen.queryByText("Note")).not.toBeInTheDocument();
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
  const pills = screen.getAllByRole("button", { name: /^claude · deep — / }).filter(b => b.getAttribute("data-kind") === "waitingAgent");
  expect(pills[0]).toHaveAttribute("title", "claude · deep — Every slot on an eligible machine is busy");
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
  await waitFor(() => expect(within(region).getAllByText("Waiting for interactive connection").length).toBeGreaterThan(0), { timeout: 8000 });
  // The watch mutation proves the posted list has been recorded before asserting that no control was sent.
  await waitFor(() => expect(posts).toContain("watch"));
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

const FIXTURE_HANDLERS = () => server.use(...handlersFor("default", { fixtures: true }));
const controlPosts = () => { const kinds: string[] = []; server.events.on("request:start", ({ request }) => { if (request.method === "POST" && request.url.includes("/mutations")) void request.clone().json().then(b => kinds.push((b as { kind: string }).kind)); }); return kinds; };
const withoutAgent = (id: string) => ({ ...SWARM_MOCKUP, machines: SWARM_MOCKUP.machines.map(m => ({ ...m, nodes: m.nodes.map(n => ({ ...n, agents: n.agents.filter(a => a.session_id !== id) })) })) });
const serve = (data: unknown) => server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope(data))));

test("Reconnect automatically restores interactive control", async () => {
  FIXTURE_HANDLERS();
  const kinds = controlPosts();
  renderApp("/agents?select=agent:sess-07");
  await screen.findByText("You have control", {}, { timeout: 8000 });
  expect(kinds.filter(k => k === "control")).toHaveLength(1);
  expect(screen.queryByRole("group", { name: "Terminal keyboard" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
  fireEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
  await waitFor(() => expect(kinds.filter(k => k === "watch").length).toBeGreaterThan(1), { timeout: 8000 });
  expect(kinds.filter(k => k === "control")).toHaveLength(2);
});

test("a data flap keeps the terminal mounted and never retakes control", async () => {
  FIXTURE_HANDLERS();
  const kinds = controlPosts();
  const { queryClient } = renderApp("/agents?select=agent:sess-07");
  await screen.findByText("You have control", {}, { timeout: 8000 });
  const region = screen.getByRole("region", { name: "Agent terminal" });
  serve(withoutAgent("sess-07"));
  await queryClient.invalidateQueries({ queryKey: [] });
  await screen.findByText(/not in the latest update/);
  expect(screen.getByRole("region", { name: "Agent terminal" })).toBe(region);
  serve(SWARM_MOCKUP);
  await queryClient.invalidateQueries({ queryKey: [] });
  await waitFor(() => expect(screen.queryByText(/not in the latest update/)).toBeNull());
  expect(kinds.filter(k => k === "control")).toHaveLength(1);
});

test("the last known agent is dropped after three polls without it", async () => {
  FIXTURE_HANDLERS();
  const { queryClient } = renderApp("/agents?select=agent:sess-07");
  await screen.findByRole("region", { name: "Agent terminal" });
  serve(withoutAgent("sess-07"));
  for (let i = 0; i < 3; i++) { await queryClient.invalidateQueries({ queryKey: [] }); await screen.findByText(/not in the latest update/); }
  await queryClient.invalidateQueries({ queryKey: [] });
  await waitFor(() => expect(screen.queryByRole("region", { name: "Agent terminal" })).toBeNull());
  expect(screen.getByText("Select anything in the tree")).toBeInTheDocument();
});

test("a malformed swarm response shows an in-view error and the rest of the app works", async () => {
  serve({ server: SWARM_MOCKUP.server, machines: "nope", waiting: {} });
  renderApp("/agents");
  expect(await screen.findByText(/can't read AQ's response for the swarm/)).toBeInTheDocument();
  expect(screen.queryByText(/Dashboard update required/i)).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Sessions" }));
  expect(await screen.findByRole("list", { name: "Sessions" })).toBeInTheDocument();
});

test("a failed refresh keeps the tree and says it is stale", async () => {
  const { queryClient } = renderApp("/agents");
  await card(/^desktop/);
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json({ request_id: "r", code: "read_model_unavailable", message: "down", retryable: true }, { status: 503 })));
  await queryClient.invalidateQueries({ queryKey: [] });
  expect(await screen.findByText(/Stale: the latest refresh failed\. Last updated/)).toBeInTheDocument();
  expect(await card(/^desktop/)).toBeInTheDocument();
  expect(document.querySelector(".react-flow__edge.animated")).toBeNull();
});

test("selecting a card replaces the history entry", async () => {
  const { router } = renderApp("/agents");
  await click(/^desktop/);
  await waitFor(() => expect(router.state.location.search).toContain("select=machine%3Adesktop"));
  expect(router.state.historyAction).toBe("REPLACE");
});

test("keyboard: Enter on a focused card selects it", async () => {
  renderApp("/agents");
  await card(/^desktop/);
  const holder = document.querySelector<HTMLElement>('.react-flow__node[data-id="machine:desktop"]')!;
  expect(holder.getAttribute("tabindex")).toBe("0");
  expect(holder.querySelector("button")).toHaveAttribute("tabindex", "-1");
  holder.focus();
  fireEvent.keyDown(holder, { key: "Enter" });
  await waitFor(() => expect(fact("Load source")).toHaveTextContent("Windows host (WSL2)"));
});

test("on a narrow viewport a selection moves focus to the pane heading", async () => {
  const original = window.matchMedia;
  window.matchMedia = ((q: string) => ({ matches: q.includes("max-width: 1023px"), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  const scrolled = vi.fn(); window.HTMLElement.prototype.scrollIntoView = scrolled;
  try {
    renderApp("/agents");
    await click(/^desktop/);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: "desktop" })));
    expect(scrolled).toHaveBeenCalled();
  } finally { window.matchMedia = original; }
});
void SERVER_TIME;

test("a machine without 15-minute samples shows a dash for the average", async () => {
  const machines = SWARM_MOCKUP.machines.map(m => (m.id === "desktop" ? { ...m, load: { ...m.load!, cpu_avg_15m_bps: null, memory_avg_15m_bps: null, samples_15m: 0 } } : m));
  server.use(http.get("/api/v1/swarm", () => HttpResponse.json(swarmEnvelope({ ...SWARM_MOCKUP, machines }))));
  renderApp("/agents?select=machine:desktop");
  await waitFor(() => expect(fact("Load avg")).toHaveTextContent(/^—$/));
});

test("usage window reads 'unknown' without a percent sign when the value is unknown", () => {
  expect(usageLabel("anthropic", null)).toBe("anthropic unknown");
  expect(usageLabel("anthropic", undefined)).toBe("anthropic unknown");
  expect(usageLabel("anthropic", 42)).toBe("anthropic 42%");
  expect(usageLabel("anthropic", 0)).toBe("anthropic 0%");
});
