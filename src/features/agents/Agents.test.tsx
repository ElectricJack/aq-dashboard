import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function roster() {
  return screen.findByRole("list", { name: "Sessions" });
}

test("roster rows show task, project, profile, observed state and controller", async () => {
  renderApp("/agents");
  const row = within(await roster()).getByRole("link", { name: "Worker 07" }).closest("li")!;
  expect(row).toHaveTextContent("Replay reconciliation");
  expect(row).toHaveTextContent("agent-queue");
  expect(row).toHaveTextContent("claude-opus-5-5 · claude-code");
  expect(row).toHaveTextContent("Running (reported)");
  expect(row).toHaveTextContent(/updated \d+s ago/);
  expect(row).toHaveTextContent("No controller");
  expect(row).toHaveTextContent("Central");
});

test("a held controller is named", async () => {
  renderApp("/agents");
  const row = within(await roster()).getByRole("link", { name: "Worker 12" }).closest("li")!;
  expect(row).toHaveTextContent("Controlled by Sample Owner");
});

test("a stale observation says so and keeps its age", async () => {
  renderApp("/agents");
  const rows = within(await roster()).getAllByRole("listitem");
  expect(rows.some((r) => /Stale, observed 5m ago/.test(r.textContent ?? ""))).toBe(true);
});

test("opening a session shows its metadata and an honest terminal placeholder", async () => {
  const { router } = renderApp("/agents");
  await userEvent.click(within(await roster()).getByRole("link", { name: "Worker 07" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-07"));
  const detail = await screen.findByRole("region", { name: "Worker 07" });
  expect(within(detail).getByText(/terminal is not available/i)).toBeInTheDocument();
  expect(within(detail).getByText(/Not offered by this AQ server/)).toBeInTheDocument();
  expect(within(detail).getByRole("list", { name: "Profile revisions" })).toHaveTextContent("agent profile · revision 4");
  expect(within(detail).getByRole("list", { name: "Permissions" })).toHaveTextContent("run tests");
  expect(within(detail).getByRole("link", { name: "Replay reconciliation" })).toHaveAttribute("href", "/work/aq-104");
  await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Worker 07" })).toHaveFocus());
});

test("an unknown session is a neutral unavailable message", async () => {
  renderApp("/agents/nope-session");
  expect(await screen.findByText(/does not exist or is not available/i)).toBeInTheDocument();
  expect(screen.queryByText(/nope-session/)).not.toBeInTheDocument();
});

test("a failed roster read is an error, not an empty roster", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/agents");
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load sessions/i);
  expect(screen.queryByText("No active sessions")).not.toBeInTheDocument();
});

test("an empty complete roster says there are no sessions", async () => {
  server.use(...handlersFor("empty"));
  renderApp("/agents");
  expect(await screen.findByText("No active sessions")).toBeInTheDocument();
});

test("task detail links to the running session", async () => {
  const { router } = renderApp("/work/aq-104");
  await userEvent.click(await screen.findByRole("link", { name: "Open session" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/agents/sess-07"));
});

test("Back from a session returns focus to its roster row", async () => {
  const { router } = renderApp("/agents");
  await userEvent.click(within(await roster()).getByRole("link", { name: "Worker 12" }));
  await screen.findByRole("heading", { level: 2, name: "Worker 12" });
  await router.navigate(-1);
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Sessions" })).getByRole("link", { name: "Worker 12" })).toHaveFocus());
});
