import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { envelope, handlersFor } from "../mocks/handlers";
import { overview } from "../mocks/inspectionData";
import { renderApp } from "../test/renderApp";
import usageFixture from "../../contracts/proposed/provider-usage.json";

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
  // Bootstrap mounts the shell before the index redirect renders its page.
  await rail();
  await waitFor(() => expect(router.state.location.pathname).toBe("/overview"));
  expect(await screen.findByRole("heading", { level: 1, name: "Overview" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/overview");
});

test("rail lists destinations in the specified order with Supervisor below Overview", async () => {
  renderApp("/overview");
  const links = within(await rail()).getAllByRole("link");
  // The first span is the label; a pending badge may follow it.
  expect(links.map((l) => l.querySelector("span")?.textContent)).toEqual([
    "Overview",
    "Supervisor",
    "Agents",
    "Work",
    "Results",
    "Decisions",
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
  expect(within(more).getAllByRole("link").map((l) => l.querySelector("span")?.textContent)).toEqual([
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
  expect(within(screen.getByRole("complementary", {name:"Application navigation"})).getByText("Sample Owner")).toBeInTheDocument();
});

function railNavigation() {
  return screen.getByRole("complementary", { name: "Application navigation" });
}

test("shows connection status in the rail footer, not the desktop header", async () => {
  renderApp("/overview");
  const banner = await screen.findByRole("banner");
  expect(within(railNavigation()).getByRole("status")).toHaveTextContent("Connected");
  expect(within(banner).queryByRole("status")).not.toBeInTheDocument();
});

test("reports Reconnecting when AQ stops responding after load", async () => {
  const { queryClient } = renderApp("/overview");
  const banner = await screen.findByRole("banner");
  await waitFor(() => expect(banner.querySelector("summary")).toHaveTextContent("42% used"));
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.error()),
    http.get("/api/v1/provider-usage", () => HttpResponse.error()),
  );
  await queryClient.refetchQueries();
  await waitFor(() => expect(within(railNavigation()).getByRole("status")).toHaveTextContent("Reconnecting"));
});

test("reports Offline when the browser has no network", async () => {
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    renderApp("/overview");
    await rail();
    expect(within(railNavigation()).getByRole("status")).toHaveTextContent("Offline");
  } finally {
    onLine.mockRestore();
  }
});

test("desktop rail holds the scope picker; the header does not", async () => {
  renderApp("/overview");
  const nav = await rail();
  expect(within(nav).getByRole("combobox", { name: "Scope" })).toHaveDisplayValue("All projects");
  expect(within(screen.getByRole("banner")).queryByRole("combobox")).not.toBeInTheDocument();
});

test("Decisions shows the scoped open-decision count (reviews + questions), not every attention item (RR-02)", async () => {
  // The fixture has 3 attention rows: a decision, a question and a failure.
  renderApp("/overview");
  const nav = await rail();
  expect(await within(nav).findByRole("link", { name: "Decisions, 2 pending" })).toBeInTheDocument();
});

test("RR-02: needs_you counting offline workers and failed results never inflates the Decisions badge", async () => {
  // Shape of the live MS1 overview: 6 attention items, none of them a review or question.
  const live = overview(null);
  const respond = (reviews: number) => server.use(http.get("/api/v1/overview", () => HttpResponse.json(envelope({ ...live,
    counts: { ...live.counts, needs_you: { value: 6, accuracy: "estimated" as const } },
    sources: [{ source: "reviews", project: null, observation: null, coverage: { state: "partial" as const }, total: { value: reviews, accuracy: "estimated" as const } },
      { source: "questions", project: null, observation: null, coverage: { state: "unknown" as const }, total: { value: null, accuracy: "unknown" as const } }] }))));
  respond(0);
  const { queryClient } = renderApp("/overview");
  const nav = await rail();
  await screen.findByText(/About 6 items need you\./);
  expect(within(nav).getByRole("link", { name: "Decisions" })).toHaveTextContent(/^Decisions$/);
  respond(4);
  await queryClient.refetchQueries({ predicate: q => q.queryKey[4] === "overview" });
  expect(await within(nav).findByRole("link", { name: "Decisions, 4 pending, approximate" })).toHaveTextContent("~4");
});

test("Decisions has no badge when nothing is pending", async () => {
  useScenario("empty");
  renderApp("/overview");
  const nav = await rail();
  await screen.findByText("Nothing needs your attention");
  const decisions = within(nav).getByRole("link", { name: "Decisions" });
  expect(decisions).toHaveTextContent(/^Decisions$/);
});

test("identity shows initials beside the name and the header avatar links to Settings", async () => {
  renderApp("/overview");
  await rail();
  expect(within(railNavigation()).getByText("SO")).toBeInTheDocument();
  const avatar = within(screen.getByRole("banner")).getByRole("link", { name: "Settings, signed in as Sample Owner" });
  expect(avatar).toHaveTextContent("SO");
  expect(avatar).toHaveAttribute("href", "/settings");
});

test("removes protected views and caches when a refresh is unauthenticated", async () => {
  const { queryClient } = renderApp("/overview");
  await rail();
  await within(railNavigation()).findByText("Connected");
  server.use(
    http.get("/api/v1/bootstrap", () =>
      HttpResponse.json(
        { request_id: "r", code: "unauthenticated", message: "Sign in", retryable: false },
        { status: 401 },
      ),
    ),
  );
  await queryClient.refetchQueries({ queryKey: ["bootstrap"] });
  expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeInTheDocument();
  expect(screen.queryByRole("navigation", { name: "Primary" })).not.toBeInTheDocument();
  expect(queryClient.getQueryCache().findAll({ queryKey: ["aq"] })).toHaveLength(0);
});

test("redirecting / keeps the scope", async () => {
  const { router } = renderApp("/?scope=project:alpha");
  await rail();
  await waitFor(() => expect(router.state.location.pathname).toBe("/overview"));
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

test("every destination link has a decorative icon and keeps its text name", async () => {
  renderApp("/overview");
  const navs = [await rail(), screen.getByRole("navigation", { name: "Primary (compact)" })];
  for (const nav of navs) {
    for (const link of within(nav).getAllByRole("link")) {
      const icon = link.querySelector("svg");
      expect(icon, link.textContent ?? "").not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  }
  const more = within(navs[1]!).getByRole("button", { name: "More" });
  expect(more.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(screen.getByRole("button", { name: "Search" }).querySelector("svg")).not.toBeNull();
});


test("keeps account quota amounts visible while window and freshness details disclose on demand", async () => {
  renderApp("/overview");
  const banner = await screen.findByRole("banner");
  const summary = banner.querySelector("summary")!;
  await waitFor(() => expect(summary).toHaveTextContent("42% used"));
  expect(summary).toHaveTextContent("Claude"); expect(summary).toHaveTextContent("Codex"); expect(summary).toHaveTextContent("85% used");
  expect(summary).toHaveAccessibleName(/Provider usage \(account-wide\).*Claude.*42% used.*Codex.*85% used/);
  const details = summary.closest("details")!; expect(details).not.toHaveAttribute("open");
  await userEvent.click(summary);
  const region = within(banner).getByRole("region", { name: "Provider usage (account-wide)" });
  expect(region).toHaveTextContent("Week"); expect(region).toHaveTextContent(/resets/); expect(region).toHaveTextContent(/updated/);
  await userEvent.click(within(region).getByRole("button", { name: "Claude: 2 windows" }));
  expect(within(region).getByRole("list", { name: "Claude usage windows" })).toHaveTextContent("5-hour");
  await userEvent.click(within(banner).getByRole("button", { name: "Close usage details" }));
  expect(details).not.toHaveAttribute("open"); expect(summary).toHaveFocus();
});

test("usage reason and Escape stay in the same bounded disclosure for unavailable quota", async () => {
  useScenario("unavailable"); renderApp("/overview");
  const banner = await screen.findByRole("banner"); const summary = banner.querySelector("summary")!;
  await waitFor(() => expect(summary).toHaveTextContent("Usage unavailable"));
  expect(summary).not.toHaveTextContent("No qualified");
  await userEvent.click(summary); expect(summary.closest("details")).toHaveAttribute("open");
  within(banner).getByRole("button", { name: "Close usage details" }).focus();
  await userEvent.keyboard("{Escape}"); expect(summary.closest("details")).not.toHaveAttribute("open"); expect(summary).toHaveFocus();
});

test("unknown quota summaries never invent a zero percentage", async () => {
  useScenario("unknown"); renderApp("/overview");
  const banner = await screen.findByRole("banner"); const summary = banner.querySelector("summary")!;
  await waitFor(() => expect(summary).toHaveTextContent("Claude"));
  expect(summary).toHaveTextContent("Usage unavailable"); expect(summary).not.toHaveTextContent("0%");
});

test("stale quota stays qualified in the compact account summary", async () => {
  useScenario("stale"); renderApp("/overview");
  const banner = await screen.findByRole("banner"); const summary = banner.querySelector("summary")!;
  await waitFor(() => expect(summary).toHaveTextContent(/42% used.*Stale, observed 1h ago/));
});


test("compact quota follows the reported preferred window and preserves estimated partial qualifiers", async () => {
  const fixture = structuredClone(usageFixture);
  fixture.data[0]!.preferred_window_id = "session";
  fixture.data[0]!.windows[1]!.observation.quality = "estimated";
  fixture.data[0]!.windows[1]!.observation.coverage = "partial";
  server.use(http.get("/api/v1/provider-usage", () => HttpResponse.json(fixture)));
  renderApp("/overview"); const banner = await screen.findByRole("banner"); const summary = banner.querySelector("summary")!;
  await waitFor(() => expect(summary).toHaveTextContent(/18% used.*estimated.*partial data/));
  expect(summary).not.toHaveTextContent("42% used");
});

test("SO-21: More is marked while one of its pages is open, and an outside tap closes its sheet", async () => {
  renderApp("/work");
  const phone = await screen.findByRole("navigation", { name: "Primary (compact)" });
  const more = within(phone).getByRole("button", { name: /^More/ });
  expect(more).toHaveAttribute("data-active");
  expect(more).toHaveAccessibleName("More, current section");
  await userEvent.click(more);
  expect(within(phone).getByRole("list", { name: "More destinations" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("main"));
  await waitFor(() => expect(within(phone).queryByRole("list", { name: "More destinations" })).toBeNull());
});

test("SO-21: More is not marked on its primary siblings", async () => {
  renderApp("/overview");
  const phone = await screen.findByRole("navigation", { name: "Primary (compact)" });
  expect(within(phone).getByRole("button", { name: "More" })).not.toHaveAttribute("data-active");
});

test("SO-12: the usage popover closes on an outside click", async () => {
  renderApp("/overview");
  const banner = await screen.findByRole("banner");
  const details = banner.querySelector("details")!;
  await userEvent.click(details.querySelector("summary")!);
  expect(details.open).toBe(true);
  await userEvent.click(await screen.findByRole("heading", { level: 1, name: "Overview" }));
  expect(details.open).toBe(false);
});
