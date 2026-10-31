import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

async function attention() {
  return screen.findByRole("region", { name: "Needs your attention" });
}

test("lists attention items with reason, impact, age and project", async () => {
  renderApp("/overview");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toHaveTextContent("Approve worker recovery plan");
  expect(rows[0]).toHaveTextContent("agent-queue");
  expect(rows[0]).toHaveTextContent("Review");
  expect(rows[0]).toHaveTextContent("waiting 18m");
  expect(rows[0]).toHaveTextContent("Unblocks 4 tasks");
});

test("the next-action link opens the exact subject", async () => {
  const { router } = renderApp("/overview");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  await userEvent.click(within(rows[2]!).getByRole("link", { name: /inspect.*resolve integration conflict/i }));
  expect(router.state.location.pathname).toBe("/work/me-301");
});

test("shows counts with unknown rendered as unknown, not zero", async () => {
  renderApp("/overview");
  const counts = await screen.findByRole("list", { name: "Work counts" });
  expect(within(counts).getByText("running").parentElement).toHaveTextContent(/\d+\s*running/);
  const recovering = within(counts).getByText("recovering").parentElement!;
  expect(recovering).not.toHaveTextContent(/0\s*recovering/);
  expect(within(recovering).getByLabelText("unknown")).toBeInTheDocument();
});

test("an empty complete read says nothing needs attention", async () => {
  server.use(...handlersFor("empty"));
  renderApp("/overview");
  const region = await attention();
  expect(await within(region).findByText("Nothing needs your attention")).toBeInTheDocument();
});

test("a partial read warns that the list may be incomplete", async () => {
  server.use(...handlersFor("partial"));
  renderApp("/overview");
  const region = await attention();
  expect(await within(region).findByText(/may be incomplete/i)).toBeInTheDocument();
  expect(within(region).queryByText("Nothing needs your attention")).not.toBeInTheDocument();
});

test("a failed read never looks like an empty queue", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/overview");
  expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load/i);
  expect(screen.queryByText("Nothing needs your attention")).not.toBeInTheDocument();
  expect(screen.queryByRole("list", { name: "Work counts" })).not.toBeInTheDocument();
});

test("project scope narrows attention to that project", async () => {
  renderApp("/overview?scope=project:quilt-trader");
  const region = await attention();
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveTextContent("Choose retry policy");
});

test("shows work in motion and recent outcomes", async () => {
  renderApp("/overview");
  const motion = await screen.findByRole("table", { name: "Work in motion" });
  expect(within(motion).getAllByRole("row").length).toBeGreaterThan(1);
  const outcomes = screen.getByRole("region", { name: "Recent outcomes" });
  expect(within(outcomes).getByText("Renderer fix")).toBeInTheDocument();
  expect(within(outcomes).getByText(/merged/i)).toBeInTheDocument();
});
