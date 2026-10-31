import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const useScenario = (name: string) => server.use(...handlersFor(name));

async function rail() {
  return screen.findByRole("navigation", { name: "Primary" });
}

test("redirects / to the Overview page", async () => {
  const { router } = renderApp("/");
  expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/overview");
});

test("rail lists destinations in the specified order with Supervisor below Overview", async () => {
  renderApp("/overview");
  const links = within(await rail()).getAllByRole("link");
  expect(links.map((l) => l.textContent)).toEqual([
    "Overview",
    "Supervisor",
    "Work",
    "Results",
    "Decisions",
    "Agents",
    "Playbooks",
    "Knowledge",
    "Settings",
  ]);
});

test("marks the current destination", async () => {
  renderApp("/work");
  expect(within(await rail()).getByRole("link", { name: "Work" })).toHaveAttribute(
    "aria-current",
    "page",
  );
});

test("phone navigation offers Overview, Results, Supervisor, Agents and More", async () => {
  renderApp("/overview");
  const phone = await screen.findByRole("navigation", { name: "Primary (compact)" });
  expect(within(phone).getAllByRole("link").map((l) => l.textContent)).toEqual([
    "Overview",
    "Results",
    "Supervisor",
    "Agents",
  ]);
  await userEvent.click(within(phone).getByRole("button", { name: "More" }));
  const more = within(phone).getByRole("list", { name: "More destinations" });
  expect(within(more).getAllByRole("link").map((l) => l.textContent)).toEqual([
    "Work",
    "Decisions",
    "Playbooks",
    "Knowledge",
    "Settings",
  ]);
});

test("moves focus to the page heading after navigation", async () => {
  renderApp("/overview");
  await userEvent.click(within(await rail()).getByRole("link", { name: "Agents" }));
  const heading = await screen.findByRole("heading", { level: 1, name: "Agents" });
  await waitFor(() => expect(heading).toHaveFocus());
});

test("keeps project scope in the URL across navigation", async () => {
  const { router } = renderApp("/overview?scope=project:alpha");
  await userEvent.click(within(await rail()).getByRole("link", { name: "Work" }));
  await screen.findByRole("heading", { level: 1, name: "Work" });
  expect(router.state.location.search).toBe("?scope=project%3Aalpha");
});

test("changing scope to All projects removes the scope parameter", async () => {
  const { router } = renderApp("/work?scope=project:alpha");
  const picker = await screen.findByRole("combobox", { name: "Scope" });
  expect(picker).toHaveValue("project:alpha");
  await userEvent.selectOptions(picker, "all");
  expect(router.state.location.search).toBe("");
  expect(picker).toHaveFocus();
});

test("a destination whose capability is not offered explains why instead of fetching", async () => {
  renderApp("/results");
  await screen.findByRole("heading", { level: 1, name: "Results" });
  const main = screen.getByRole("main");
  expect(await within(main).findByText(/not available/i)).toBeInTheDocument();
  expect(within(main).getByText(/Not offered by this AQ server/)).toBeInTheDocument();
});

test("an unknown path shows a neutral not-found view", async () => {
  renderApp("/nowhere/secret-task");
  expect(await screen.findByRole("heading", { level: 1, name: "Page not found" })).toBeInTheDocument();
  expect(screen.queryByText("secret-task")).not.toBeInTheDocument();
});

test("shows provider usage from AQ in the top area", async () => {
  renderApp("/overview");
  const strip = await screen.findByRole("region", { name: /provider usage/i });
  expect(await within(strip).findByText("42% used")).toBeInTheDocument();
  expect(within(strip).getByText("85% used")).toBeInTheDocument();
});

test("a disabled quota capability shows the reason and never requests usage", async () => {
  let requested = false;
  useScenario("unavailable");
  server.use(
    http.get("/api/v1/provider-usage", () => {
      requested = true;
      return HttpResponse.json({}, { status: 500 });
    }),
  );
  renderApp("/overview");
  const strip = await screen.findByRole("region", { name: /provider usage/i });
  expect(await within(strip).findByText(/No qualified provider quota source/)).toBeInTheDocument();
  expect(requested).toBe(false);
});

test("a failed usage read says unavailable, never 0%", async () => {
  useScenario("failed");
  renderApp("/overview");
  const strip = await screen.findByRole("region", { name: /provider usage/i });
  expect(await within(strip).findByText(/usage unavailable/i)).toBeInTheDocument();
  expect(strip).not.toHaveTextContent(/%/);
});

test("an unreachable AQ server shows a connection failure, not an empty dashboard", async () => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.error()));
  renderApp("/overview");
  expect(await screen.findByRole("heading", { name: /can't reach AQ/i })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
});

test("an unauthenticated session asks the user to sign in", async () => {
  server.use(
    http.get("/api/v1/bootstrap", () =>
      HttpResponse.json(
        { request_id: "r", code: "unauthenticated", message: "Sign in", retryable: false },
        { status: 401 },
      ),
    ),
  );
  renderApp("/overview");
  expect(await screen.findByRole("heading", { name: /sign in required/i })).toBeInTheDocument();
});

test("shows the signed-in principal in the rail", async () => {
  renderApp("/overview");
  await rail();
  expect(within(screen.getByRole("complementary")).getByText("Sample Owner")).toBeInTheDocument();
});

test("shows connection status in the top area", async () => {
  renderApp("/overview");
  const banner = await screen.findByRole("banner");
  expect(within(banner).getByRole("status")).toHaveTextContent("Connected");
});

test("reports Disconnected when AQ stops responding after load", async () => {
  const { queryClient } = renderApp("/overview");
  const banner = await screen.findByRole("banner");
  await within(banner).findByText("42% used");
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.error()),
    http.get("/api/v1/provider-usage", () => HttpResponse.error()),
  );
  await queryClient.refetchQueries();
  await waitFor(() => expect(within(banner).getByRole("status")).toHaveTextContent("Disconnected"));
});

test("reports an expired sign-in when a refresh is unauthenticated", async () => {
  const { queryClient } = renderApp("/overview");
  const banner = await screen.findByRole("banner");
  await within(banner).findByText("Connected");
  server.use(
    http.get("/api/v1/bootstrap", () =>
      HttpResponse.json(
        { request_id: "r", code: "unauthenticated", message: "Sign in", retryable: false },
        { status: 401 },
      ),
    ),
  );
  await queryClient.refetchQueries({ queryKey: ["bootstrap"] });
  await waitFor(() => expect(within(banner).getByRole("status")).toHaveTextContent(/sign-in expired/i));
});

test("redirecting / keeps the scope", async () => {
  const { router } = renderApp("/?scope=project:alpha");
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  expect(new URLSearchParams(router.state.location.search).get("scope")).toBe("project:alpha");
});

test("Tab from an opened More button reaches the first More destination", async () => {
  renderApp("/overview");
  const phone = await screen.findByRole("navigation", { name: "Primary (compact)" });
  await userEvent.click(within(phone).getByRole("button", { name: "More" }));
  await userEvent.tab();
  expect(within(phone).getByRole("link", { name: "Work" })).toHaveFocus();
});

test("Escape inside the More menu closes it and returns focus to More", async () => {
  renderApp("/overview");
  const phone = await screen.findByRole("navigation", { name: "Primary (compact)" });
  const more = within(phone).getByRole("button", { name: "More" });
  await userEvent.click(more);
  within(phone).getByRole("link", { name: "Work" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(within(phone).queryByRole("list", { name: "More destinations" })).not.toBeInTheDocument();
  expect(more).toHaveFocus();
});

test("keeps the last usage but marks it stale when a refresh fails", async () => {
  const { queryClient } = renderApp("/overview");
  const strip = await screen.findByRole("region", { name: /provider usage/i });
  await within(strip).findByText("42% used");
  useScenario("failed");
  await queryClient.refetchQueries();
  expect(within(strip).getByText("42% used")).toBeInTheDocument();
  await waitFor(() => expect(within(strip).getAllByText(/stale/i).length).toBeGreaterThan(0));
});

test("mock mode shows a persistent mock-data banner in the header", async () => {
  vi.stubEnv("MODE", "mock");
  try {
    renderApp("/overview");
    const banner = await screen.findByRole("banner");
    expect(within(banner).getByText(/mock data/i)).toHaveTextContent(/proposed contracts/i);
  } finally {
    vi.unstubAllEnvs();
  }
});

test("live mode shows no mock banner", async () => {
  renderApp("/overview");
  await screen.findByRole("heading", { level: 1, name: "Overview" });
  expect(screen.queryByText(/mock data/i)).not.toBeInTheDocument();
});
