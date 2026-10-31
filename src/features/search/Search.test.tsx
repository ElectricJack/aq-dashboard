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

async function openSearch() {
  await userEvent.click(await screen.findByRole("button", { name: "Search" }));
  return screen.getByRole("dialog", { name: "Search" });
}

test("the Search button opens the dialog with the input focused", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  expect(within(dialog).getByRole("searchbox", { name: "Search" })).toHaveFocus();
});

test("Ctrl+K opens the same dialog", async () => {
  renderApp("/overview");
  await screen.findByRole("button", { name: "Search" });
  await userEvent.keyboard("{Control>}k{/Control}");
  expect(screen.getByRole("dialog", { name: "Search" })).toBeVisible();
});

test("results are grouped by type and link to their subject", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const tasks = await within(dialog).findByRole("list", { name: "Tasks" });
  const link = within(tasks).getByRole("link", { name: /^Approve recovery plan/ });
  expect(link).toHaveAttribute("href", "/work/aq-103");
});

test("search is scoped to the selected project", async () => {
  let scopeSent: string | null = "unset";
  server.use(
    http.get("/api/v1/search", ({ request }) => {
      scopeSent = new URL(request.url).searchParams.get("scope");
      return HttpResponse.json({
        api_version: "proposed-0", request_id: "r", server_time: "2026-10-31T12:00:00.000Z",
        scope: { kind: "project", project_id: "matter-engine" },
        observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
        pending_operations: [], coverage: { state: "complete" }, data: { groups: [] },
      });
    }),
  );
  renderApp("/overview?scope=project:matter-engine");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "terrain");
  await within(dialog).findByText(/no matches/i);
  expect(scopeSent).toBe("project:matter-engine");
});

test("arrow keys move from the input through results", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const links = await within(dialog).findAllByRole("link");
  await userEvent.keyboard("{ArrowDown}");
  expect(links[0]).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(links[1]).toHaveFocus();
  await userEvent.keyboard("{ArrowUp}{ArrowUp}");
  expect(within(dialog).getByRole("searchbox")).toHaveFocus();
});

test("choosing a result navigates and closes the dialog", async () => {
  const { router } = renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  await userEvent.click(await within(dialog).findByRole("link", { name: /^Approve recovery plan/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/work/aq-103"));
  expect(screen.queryByRole("dialog", { name: "Search" })).not.toBeInTheDocument();
});

test("closing returns focus to the Search button", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.click(within(dialog).getByRole("button", { name: "Close search" }));
  expect(screen.getByRole("button", { name: "Search" })).toHaveFocus();
});

test("short queries do not search", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "r");
  expect(within(dialog).getByText(/type at least 2 characters/i)).toBeInTheDocument();
});

test("a failed search shows an error, not 'no matches'", async () => {
  server.use(...handlersFor("reads-failed"));
  renderApp("/overview");
  await screen.findByRole("button", { name: "Search" });
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/couldn't load search results/i);
  expect(within(dialog).queryByText(/no matches/i)).not.toBeInTheDocument();
});

test("a malformed search response is contained in the dialog", async () => {
  server.use(
    http.get("/api/v1/search", () =>
      HttpResponse.json({
        api_version: "proposed-0", request_id: "r", server_time: "2026-10-31T12:00:00.000Z",
        scope: { kind: "all_authorized" },
        observation: { observed_at: "2026-10-31T12:00:00.000Z", fresh_until: "2026-10-31T12:01:00.000Z", source: "t", quality: "reported", coverage: "complete" },
        pending_operations: [], coverage: { state: "complete" }, data: { nope: true },
      }),
    ),
  );
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  expect(await within(dialog).findByRole("alert")).toHaveTextContent(/can't read/i);
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
});

test("results are announced as a count, not read out in full", async () => {
  renderApp("/overview");
  const dialog = await openSearch();
  await userEvent.type(within(dialog).getByRole("searchbox"), "recovery");
  const tasks = await within(dialog).findByRole("list", { name: "Tasks" });
  expect(tasks.closest("[aria-live]")).toBeNull();
  expect(within(dialog).getByRole("status")).toHaveTextContent(/\d+ results?/);
});
