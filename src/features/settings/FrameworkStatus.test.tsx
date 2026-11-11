import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function enable(...names: string[]) {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [
    ...bootstrap.data.capabilities.filter(c => !names.includes(c.name)), ...names.map(name => ({ name, version: "1", enabled: true })),
  ] } })));
}
async function daemon() {
  const region = await screen.findByRole("region", { name: "Framework connection" });
  return (await screen.findAllByRole("status")).find(el => region.contains(el) && el.textContent?.startsWith("Daemon:"))!;
}
test("healthy daemon shows the success dot state and the reported label", async () => {
  enable("status.read"); server.use(http.get("/api/status", () => HttpResponse.json({ health: "ok" }))); renderApp("/settings?tab=connection");
  const line = await daemon(); await screen.findByText("Daemon: ok");
  expect(line).toHaveAttribute("data-state", "healthy");
});
test("unreadable daemon status is unavailable, other health values stay neutral", async () => {
  enable("status.read"); server.use(http.get("/api/status", () => HttpResponse.json({}, { status: 503 }))); renderApp("/settings?tab=connection");
  await screen.findByText("Daemon: Status unavailable");
  expect(await daemon()).toHaveAttribute("data-state", "unavailable");
});
test("unknown health is reported verbatim without a success dot; empty roster is a meta line", async () => {
  enable("status.read", "workers.read");
  server.use(http.get("/api/status", () => HttpResponse.json({ health: "degraded" })), http.get("/api/workers", () => HttpResponse.json([]))); renderApp("/settings?tab=connection");
  await screen.findByText("Daemon: degraded"); expect(await daemon()).toHaveAttribute("data-state", "unknown");
  expect(await screen.findByText("No worker nodes enrolled.")).toBeInTheDocument();
});
test("worker heartbeats are readable times with the exact instant in the title (ISSUE-014)", async () => {
  enable("workers.read");
  server.use(http.get("/api/workers", () => HttpResponse.json([{ id: "w1", name: "ms1-node", worker_version: "0.5.1", status: "offline", last_seen_at: "2026-11-06T02:36:26.400064Z" }]))); renderApp("/settings?tab=connection");
  const list = await screen.findByRole("list", { name: "Worker nodes" });
  const time = list.querySelector("time")!;
  expect(time).toHaveAttribute("title", "2026-11-06T02:36:26.400064Z"); expect(time).toHaveAttribute("dateTime", "2026-11-06T02:36:26.400064Z");
  expect(list.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
});
