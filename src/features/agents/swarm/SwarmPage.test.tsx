import { screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { handlersFor } from "../../../mocks/handlers";
import { renderApp } from "../../../test/renderApp";

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
