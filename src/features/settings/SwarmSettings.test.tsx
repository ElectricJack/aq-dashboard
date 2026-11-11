import { screen, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeEach(() => server.use(
  http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "1", active_digest: "a".repeat(64), profiles: [], model_choices: [] })),
  http.get("/api/settings/swarm", () => HttpResponse.json({ revision: "1", catalog_revision: "1", active_mode: "normal", normal: [], reduced: null, unclassified: [], cells: [] })),
));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

test.each(["/settings#swarm", "/settings?tab=swarm"])("legacy limits destination %s opens Intelligence without a separate tab", async path => {
  renderApp(path);
  expect(await screen.findByRole("tab", { name: "Intelligence", selected: true })).toBeVisible();
  expect(screen.queryByRole("tab", { name: "Swarm" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("tablist")).getAllByRole("tab")).toHaveLength(6);
  expect(await screen.findByRole("columnheader", { name: "Max agents" })).toBeVisible();
});
