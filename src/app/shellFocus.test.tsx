import { screen } from "@testing-library/react";
import { setupServer } from "msw/node";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// History uses the full shell while a session detail uses the focused shell.
test("/agents/history keeps the full shell with phone nav, scope row and search", async () => {
  renderApp("/agents/history");
  await screen.findByRole("link", { name: "History" });
  expect(document.querySelector("[data-focused-session]")).toBeNull();
  expect(screen.getByRole("combobox", { name: "Scope" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /search/i })).toBeInTheDocument();
});

test("/agents/<id> is still the focused-session shell", async () => {
  renderApp("/agents/sess-07");
  await screen.findByRole("heading", { level: 2, name: "Worker 07" });
  expect(document.querySelector("[data-focused-session]")).not.toBeNull();
});
