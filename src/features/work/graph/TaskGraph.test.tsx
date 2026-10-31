import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../../mocks/handlers";
import { renderApp } from "../../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function graphRegion() {
  return screen.findByRole("region", { name: /dependency graph/i });
}

test("switching to Graph roots the view at the selected task", async () => {
  const { router } = renderApp("/work/aq-104");
  await screen.findByRole("heading", { level: 2, name: "Replay reconciliation" });
  await userEvent.click(screen.getByRole("link", { name: "Graph" }));
  await graphRegion();
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("view")).toBe("graph");
  expect(params.get("root")).toBe("aq-104");
});

test("renders the bounded neighbourhood with omitted counts", async () => {
  renderApp("/work/aq-104?view=graph&root=aq-104");
  const region = await graphRegion();
  expect(await within(region).findAllByRole("button", { name: /·/ })).toHaveLength(7);
  expect(region).toHaveTextContent("7 tasks shown");
  expect(region).toHaveTextContent("3 tasks and 4 relationships not shown");
});

test("offers the same relationships as text", async () => {
  renderApp("/work/aq-104?view=graph&root=aq-104");
  const list = await screen.findByRole("list", { name: "Relationships in this view" });
  expect(list).toHaveTextContent("Define lease contract must finish before Approve recovery plan");
  expect(list).toHaveTextContent("Replay reconciliation references Validate crash recovery");
});

test("selecting a node keeps the root and the node positions", async () => {
  const { router } = renderApp("/work/aq-104?view=graph&root=aq-104");
  const region = await graphRegion();
  const node = await within(region).findByRole("button", { name: /Implement safe recovery/ });
  const before = node.getAttribute("style");
  await userEvent.click(node);
  await waitFor(() => expect(router.state.location.pathname).toBe("/work/aq-105"));
  expect(new URLSearchParams(router.state.location.search).get("root")).toBe("aq-104");
  const after = within(await graphRegion()).getByRole("button", { name: /Implement safe recovery/ });
  expect(after.getAttribute("style")).toBe(before);
  expect(after).toHaveAttribute("aria-pressed", "true");
});

test("graph view without a selected task asks for one", async () => {
  renderApp("/work?view=graph");
  expect(await screen.findByText(/choose a task to see its dependency neighbourhood/i)).toBeInTheDocument();
});

test("graph nodes and task rows show a readiness icon alongside the text", async () => {
  renderApp("/work/aq-104?view=graph&root=aq-104");
  const region = await graphRegion();
  const nodes = await within(region).findAllByRole("button", { name: /·/ });
  for (const n of nodes) expect(n.querySelector("svg[aria-hidden='true']")).not.toBeNull();
});
