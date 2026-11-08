import { fireEvent, render, screen } from "@testing-library/react";
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

test("agents landing is the swarm tab", async () => {
  renderApp("/agents");
  const swarm = await screen.findByRole("link", { name: "Swarm" });
  expect(swarm).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("href", "/agents/sessions");
});

test("sessions tab keeps the roster", async () => {
  renderApp("/agents/sessions");
  expect(await screen.findByRole("list", { name: "Sessions" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");
});

test("swarm without capability degrades to a note and keeps the Sessions tab", async () => {
  const { default: bootstrap } = await import("../../../../contracts/proposed/bootstrap.json");
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: bootstrap.data.capabilities.filter(c => c.name !== "swarm.read") } })));
  renderApp("/agents");
  expect(await screen.findByText(/Swarm is not available on this server\./)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sessions" })).toBeInTheDocument();
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
