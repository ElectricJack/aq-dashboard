import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { renderApp } from "../../../test/renderApp";
import { stubReactFlowDom } from "../../../test/reactFlow";
import { adaptSwarm } from "../../../api/adapters/swarm";
import { SWARM_MOCKUP } from "../../../mocks/swarm";
import { SERVER_TIME } from "../../../mocks/inspectionData";
import { SwarmTree } from "./SwarmTree";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => sessionStorage.clear());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test("swarm route selects the swarm tab", async () => {
  renderApp("/agents/swarm");
  const swarm = await screen.findByRole("link", { name: "Swarm" });
  expect(swarm).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "History" })).toHaveAttribute("href", "/agents/history");
});

test("legacy sessions route redirects to history preserving scope", async () => {
  const { router } = renderApp("/agents/sessions?scope=project:example");
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/history"));
  expect(router.state.location.search).toBe("?scope=project:example");
});

test("swarm without capability degrades to a note and keeps the History tab", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: bootstrap.data.capabilities.filter(c => c.name !== "swarm.read") } })));
  renderApp("/agents/swarm");
  expect(await screen.findByText(/Swarm is not available on this server\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "History" })).toBeInTheDocument();
});

describe("swarm tree", () => {
  let restore: () => void;
  beforeAll(() => { restore = stubReactFlowDom(); });
  afterAll(() => restore());
  const view = adaptSwarm(SWARM_MOCKUP, SERVER_TIME);
  const tree = (onSelect = vi.fn()) => { render(<SwarmTree view={view} ready={6} selected={null} onSelect={onSelect} />); return onSelect; };

  test("renders every mockup state", async () => {
    tree();
    expect(await screen.findByRole("button", { name: /^desktop, local · 24 cores/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^laptop, local · offline/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /studio.*holding: Context measurement expired/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^boat vm-a, cloud · booting/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "free" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: /^waiting/ })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Legend" })).toBeInTheDocument();
  });
  test("offline machine renders dashed and greyed without meters", async () => {
    tree();
    const laptop = await screen.findByRole("button", { name: /^laptop, local · offline/ });
    expect(laptop).toHaveAttribute("data-state", "offline");
    expect(laptop.querySelector("[class*=meters]")).toBeNull();
    expect((await screen.findByRole("button", { name: /^desktop/ })).querySelector("[class*=meters]")).not.toBeNull();
  });
  test("codex pill has the provider ring", async () => {
    tree();
    // One running agent and one waiting agent carry the same label.
    const pills = await screen.findAllByRole("button", { name: "codex · fast" });
    expect(pills.length).toBeGreaterThanOrEqual(1);
    for (const pill of pills) expect(pill).toHaveAttribute("data-provider", "codex");
  });
  test("clicking a card selects it", async () => {
    const onSelect = tree();
    fireEvent.click(await screen.findByRole("button", { name: /^desktop/ }));
    expect(onSelect).toHaveBeenCalledWith({ kind: "machine", machineId: "desktop" });
  });
});

test("swarm status shows provider controls", async () => {
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json({
    revision: "1", catalog_revision: "1", active_mode: "normal", normal: [{ provider: "codex", intelligence_class: "fast", limit: 2 }], reduced: [{ provider: "codex", intelligence_class: "fast", limit: 1 }],
    cells: [{ provider: "codex", intelligence_class: "fast", display_name: "Fast", normal_limit: 2, reduced_limit: 1, effective_limit: 2, running: 2, waiting: 3 }],
    unclassified: [{ provider: "codex", running: 1, waiting: 4 }], provider_limits: [], cell_limits: [],
  })));
  renderApp("/agents/swarm");
  expect(await screen.findByRole("slider", { name: "codex concurrent agents" })).toBeInTheDocument();
  expect(screen.queryByRole("switch", { name: "Reduced usage" })).not.toBeInTheDocument();
});
