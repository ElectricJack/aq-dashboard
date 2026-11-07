import { screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// The focused-session shell hides the phone nav, scope row and search; the roster at /agents/sessions must keep them.
test("/agents/sessions keeps the full shell with phone nav, scope row and search", async () => {
  renderApp("/agents/sessions");
  await screen.findByRole("list", { name: "Sessions" });
  expect(document.querySelector("[data-focused-session]")).toBeNull();
  expect(screen.getByRole("combobox", { name: "Scope" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
});

test("/agents/<id> is still the focused-session shell", async () => {
  renderApp("/agents/sess-07");
  await screen.findByRole("heading", { level: 2, name: "Worker 07" });
  expect(document.querySelector("[data-focused-session]")).not.toBeNull();
});
