import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function taskList() {
  return screen.findByRole("list", { name: "Tasks" });
}

test("shows a bounded first page with its total and loads more on request", async () => {
  renderApp("/work");
  const list = await taskList();
  expect(within(list).getAllByRole("listitem")).toHaveLength(25);
  expect(screen.getByText(/25 of 47 tasks/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Load more tasks" }));
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(47));
  expect(screen.queryByRole("button", { name: "Load more tasks" })).not.toBeInTheDocument();
});

test("rows show readiness and the server's explanation", async () => {
  renderApp("/work");
  const list = await taskList();
  const row = within(list).getByRole("link", { name: "Approve recovery plan" }).closest("li")!;
  expect(row).toHaveTextContent("Needs decision");
  expect(row).toHaveTextContent("Approval of revision 3 required");
  expect(row).toHaveTextContent("agent-queue");
});

test("the readiness filter lives in the URL and narrows rows", async () => {
  const { router } = renderApp("/work?scope=project:agent-queue");
  await taskList();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Readiness" }), "running");
  await waitFor(() => {
    const rows = within(screen.getByRole("list", { name: "Tasks" })).getAllByRole("listitem");
    expect(rows.every((r) => r.textContent?.includes("Running"))).toBe(true);
  });
  const params = new URLSearchParams(router.state.location.search);
  expect(params.get("readiness")).toBe("running");
  expect(params.get("scope")).toBe("project:agent-queue");
});

test("selecting a task opens its detail, keeps scope and focuses the detail heading", async () => {
  const { router } = renderApp("/work?scope=project:agent-queue");
  const list = await taskList();
  await userEvent.click(within(list).getByRole("link", { name: "Replay reconciliation" }));
  const heading = await screen.findByRole("heading", { level: 2, name: "Replay reconciliation" });
  expect(router.state.location.pathname).toBe("/work/aq-104");
  expect(new URLSearchParams(router.state.location.search).get("scope")).toBe("project:agent-queue");
  await waitFor(() => expect(heading).toHaveFocus());
});

test("detail shows acceptance, dependencies and distinct delivery facts", async () => {
  renderApp("/work/aq-104");
  const detail = await screen.findByRole("region", { name: "Replay reconciliation" });
  expect(within(detail).getByText("Attempt 27 is running on worker-07")).toBeInTheDocument();
  const deps = within(detail).getByRole("list", { name: "Dependencies" });
  expect(within(deps).getByRole("link", { name: "Define lease contract" })).toBeInTheDocument();
  expect(deps).toHaveTextContent(/satisfied/i);
  expect(within(detail).getByRole("list", { name: /acceptance criteria/i })).toHaveTextContent(
    "Behaviour is covered by tests",
  );
  const facts = within(detail).getByRole("list", { name: "Delivery facts" });
  expect(within(facts).getByText("Merged").closest("li")).toHaveTextContent("Unknown");
  expect(within(facts).getByText("Result accepted").closest("li")).toHaveTextContent("Not yet");
});

test("Back from a task returns focus to the row that opened it", async () => {
  const { router } = renderApp("/work");
  const list = await taskList();
  const link = within(list).getByRole("link", { name: "Replay reconciliation" });
  await userEvent.click(link);
  await screen.findByRole("heading", { level: 2, name: "Replay reconciliation" });
  await router.navigate(-1);
  await waitFor(() =>
    expect(within(screen.getByRole("list", { name: "Tasks" })).getByRole("link", { name: "Replay reconciliation" })).toHaveFocus(),
  );
});

test("an unknown task shows a neutral unavailable message without echoing its id", async () => {
  renderApp("/work/secret-task-id");
  expect(await screen.findByText(/does not exist or is not available/i)).toBeInTheDocument();
  expect(screen.queryByText(/secret-task-id/)).not.toBeInTheDocument();
});

test("a failed list read is an error, not an empty list", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/work");
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load tasks/i);
  expect(screen.queryByText(/no tasks/i)).not.toBeInTheDocument();
});

test("an empty complete read says no tasks match", async () => {
  server.use(...handlersFor("empty"));
  renderApp("/work");
  expect(await screen.findByText("No tasks match these filters")).toBeInTheDocument();
});

test("task titles are rendered as text, never markup", async () => {
  server.use(
    http.get("/api/v1/tasks", () =>
      HttpResponse.json({
        api_version: "proposed-0",
        request_id: "r",
        server_time: "2026-10-31T12:00:00.000Z",
        scope: { kind: "all_authorized" },
        observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
        pending_operations: [],
        coverage: { state: "complete" },
        data: {
          items: [{
            id: "x", revision: "1", title: '<img src=x onerror="alert(1)">',
            project: { id: "p", label: "p" }, state: "active",
            readiness: { state: "ready", explanation: "<b>bold</b>" },
            execution: { observation: "unknown", observed_at: null, session_id: null, agent_label: null },
            blocker: null, latest_result: null, updated_at: "2026-10-31T12:00:00.000Z",
          }],
          next_cursor: null, has_more: false, snapshot_id: "s", total: { value: 1, accuracy: "exact" },
        },
      }),
    ),
  );
  renderApp("/work");
  const list = await taskList();
  expect(within(list).getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
  expect(list.querySelector("img")).toBeNull();
  expect(list.querySelector("b")).toBeNull();
});

test("moving from one task to another shows the second task, not a cached first", async () => {
  renderApp("/work/aq-104");
  const detail = await screen.findByRole("region", { name: "Replay reconciliation" });
  await userEvent.click(within(detail).getByRole("link", { name: "Define lease contract" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Define lease contract" })).toBeInTheDocument();
});
