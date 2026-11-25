import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http } from "msw";
import { setupServer } from "msw/node";
import examples from "../../../contracts/live/performance/examples.json";
import { handlersFor } from "../../mocks/handlers";
import { fixtureProject, FIXTURE_IDS } from "../../mocks/humanGraphData";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default", { fixtures: true }));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function captureRequests() {
  const urls: URL[] = [];
  server.use(http.get(/\/api\/v1\/performance\//, ({ request }) => { urls.push(new URL(request.url)); }));
  return urls;
}

test("shows independent clocks, measured idle capacity and one ready queue at the same cutoff", async () => {
  const urls = captureRequests();
  renderApp("/performance");
  const outcomes = await screen.findByRole("region", { name: "Delivery and quality" });
  const timing = await within(outcomes).findByRole("table", { name: "First ready to outcome" });
  expect(within(timing).getByRole("row", { name: "Confirmed completion 1 h 20 min 1 h 20 min 2 / 12" })).toBeInTheDocument();
  expect(within(outcomes).getByText("87.5%")).toBeInTheDocument();
  expect(within(outcomes).getByText("Not tracked")).toBeInTheDocument();
  const machines = await screen.findByRole("region", { name: "Machine utilization" });
  expect(await within(machines).findByText("Desktop worker")).toBeInTheDocument();
  expect(within(machines).getByText("Lab worker")).toBeInTheDocument();
  expect(within(machines).getByText(/online · 0 occupied · 2 free/)).toBeInTheDocument();
  expect(within(machines).getAllByText("Fleet ready queue")).toHaveLength(1);
  expect(within(machines).getByText("0% utilization · 2 idle intervals with queued work")).toBeInTheDocument();
  expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
  for (const path of ["/machines", "/holds"]) {
    expect(urls.find(url => url.pathname.endsWith(path))?.searchParams.get("cutoff_ms"))
      .toBe(String(examples.populated.summary.cutoff_ms));
  }
});

test("project reads stay scoped and keep their cutoff across the holds cursor and task detail", async () => {
  const urls = captureRequests();
  renderApp(`/performance?scope=project:${fixtureProject.id}`);
  expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Machine utilization" })).not.toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Queue diagnostics" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Next holds" }));
  expect(await screen.findByText("Awaiting release window")).toBeInTheDocument();
  const paged = urls.find(url => url.searchParams.has("cursor"));
  expect(paged?.searchParams.get("cutoff_ms")).toBe(String(examples.populated.summary.cutoff_ms));
  expect(paged?.searchParams.get("cursor")).toBe("fixture-next-hold");
  await userEvent.click(screen.getByText("Task evidence · Up to 50 recent tasks"));
  await userEvent.click(screen.getByRole("link", { name: "View usage" }));
  expect(await screen.findByText("First submission · accepted")).toBeInTheDocument();
  expect(screen.getByText("First intended model")).toBeInTheDocument();
  const attempts = screen.getAllByText(/^Attempt (generation|…)/);
  expect(attempts.map(attempt => attempt.textContent)).toEqual([
    "Attempt generation 4 · failed",
    "Attempt …00000302 · completed",
  ]);
  await userEvent.click(attempts[0]!);
  expect(screen.getByRole("table", { name: "Actual models for Attempt generation 4" })).toBeInTheDocument();
  await userEvent.click(screen.getByText("Attempt …00000302 · completed"));
  expect(screen.getByRole("table", { name: "Actual models for Attempt …00000302" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open task in Work" })).toHaveAttribute("href",
    `/work/${FIXTURE_IDS.lease}?scope=project%3A${fixtureProject.id}`);
  expect(urls.some(url => url.pathname.endsWith("/machines"))).toBe(false);
  expect(urls.every(url => url.searchParams.get("project_id") === fixtureProject.id && !url.searchParams.has("scope"))).toBe(true);
});

test("older servers omit navigation and direct visits make no performance requests", async () => {
  server.use(...handlersFor("performance-old", { fixtures: true }));
  const urls = captureRequests();
  renderApp("/performance");
  expect(await screen.findByRole("heading", { name: "Performance is not available" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Performance" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Work" })).toBeInTheDocument();
  expect(urls).toHaveLength(0);
});

test("zero events and an untracked definition have distinct states", async () => {
  server.use(...handlersFor("empty", { fixtures: true }));
  renderApp("/performance");
  expect(await screen.findByText("No outcome events in this window.")).toBeInTheDocument();
  expect(screen.getByText("Not tracked")).toBeInTheDocument();
  expect(await screen.findByText("No usage events in this window.")).toBeInTheDocument();
  expect(await screen.findByText("No holds observed.")).toBeInTheDocument();
});

test("an unavailable usage source leaves outcomes and holds visible", async () => {
  server.use(...handlersFor("partial", { fixtures: true }));
  renderApp("/performance");
  expect(await screen.findByText("Temporarily unavailable.")).toBeInTheDocument();
  expect(screen.getByText("87.5%")).toBeInTheDocument();
  expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
});

test("an outage is distinguishable from an empty snapshot", async () => {
  server.use(...handlersFor("performance-outage", { fixtures: true }));
  renderApp("/performance");
  const delivery = await screen.findByRole("region", { name: "Delivery and quality" });
  expect(await within(delivery).findByRole("alert")).toHaveTextContent("Couldn't load delivery and quality metrics");
  expect(screen.queryByText("No outcome events in this window.")).not.toBeInTheDocument();
});

test("a refused task doesn't disclose its usage or link to its task record", async () => {
  server.use(...handlersFor("performance-forbidden", { fixtures: true }));
  renderApp(`/performance/tasks/${FIXTURE_IDS.lease}`);
  expect(await screen.findByText("This item does not exist or is not available to you.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Open task in Work" })).not.toBeInTheDocument();
});

test("stale capacity retains the last machine observations", async () => {
  server.use(...handlersFor("stale", { fixtures: true }));
  renderApp("/performance");
  const machines = await screen.findByRole("region", { name: "Machine utilization" });
  expect(await within(machines).findByText("Latest capacity observation is stale.")).toBeInTheDocument();
  expect(within(machines).getByText("Lab worker")).toBeInTheDocument();
});
