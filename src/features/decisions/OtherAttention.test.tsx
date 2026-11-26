import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor, envelope } from "../../mocks/handlers";
import { overview } from "../../mocks/inspectionData";
import { decisionPage } from "../../test/decisions";
import { renderApp } from "../../test/renderApp";
import { otherAttention } from "./OtherAttention";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const KINDS = ["blocked", "failed", "worker_offline", "uncertain_operation", "internal_work"] as const;

/** Ten non-decision attention rows: the shape the owner reported (overview shows 10, the inbox has none). */
function tenOtherItems() {
  const base = overview(null).attention[2]!;
  return Array.from({ length: 10 }, (_, i) => ({
    ...base, id: `att-x${i}`, kind: KINDS[i % KINDS.length]!, title: `Needs attention ${i}`,
    subject: { type: "task", id: `00000000-0000-0000-0000-0000000002${String(i).padStart(2, "0")}`, revision: "1" },
  }));
}

function serveOverview(attention: unknown[], needsYou = attention.length) {
  const data = { ...overview(null), attention, counts: { ...overview(null).counts, needs_you: { value: needsYou, accuracy: "exact" as const } }, sources: [] };
  server.use(http.get("/api/v1/overview", () => HttpResponse.json(envelope(data))),
    http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })));
}

test("View all lists every overview item the decision inbox does not carry", async () => {
  serveOverview(tenOtherItems());
  const { router } = renderApp("/overview");
  const region = await screen.findByRole("region", { name: "Needs your attention" });
  expect(await within(region).findAllByRole("listitem")).toHaveLength(10);
  await userEvent.click(within(region).getByRole("link", { name: /View all/ }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/decisions"));
  const other = await screen.findByRole("list", { name: "Other items that need you" });
  expect(within(other).getAllByRole("listitem")).toHaveLength(10);
  expect(await screen.findByText(/^No open reviews/)).toBeInTheDocument();
  await userEvent.click(within(other).getByRole("link", { name: /inspect.*needs attention 0/i }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/work/00000000-0000-0000-0000-000000000200"));
});

test("items beyond the first screenful are all listed, and the count disagreement is stated", async () => {
  serveOverview(tenOtherItems(), 14);
  renderApp("/decisions");
  const other = await screen.findByRole("list", { name: "Other items that need you" });
  expect(within(other).getAllByRole("listitem")).toHaveLength(10);
  expect(screen.getByText(/AQ reports 14 items need you but listed 10/)).toBeInTheDocument();
});

test("project scope is forwarded so the list matches the scoped overview", async () => {
  const scopes: (string | null)[] = [];
  server.use(http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })));
  server.events.on("request:start", ({ request }) => { const u = new URL(request.url); if (u.pathname === "/api/v1/overview") scopes.push(u.searchParams.get("scope")); });
  renderApp("/decisions?scope=project:matter-engine");
  await screen.findByRole("list", { name: "Other items that need you" });
  expect(scopes).toContain("project:matter-engine");
});

test("a failed overview read shows an error, not an empty list", async () => {
  server.use(http.get("/api/v1/overview", () => HttpResponse.json({}, { status: 500 })),
    http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })));
  renderApp("/decisions");
  expect(await screen.findByRole("heading", { name: "Other items that need you" })).toBeInTheDocument();
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(/couldn't load/i);
  expect(screen.queryByRole("list", { name: "Other items that need you" })).not.toBeInTheDocument();
});

test("a genuinely empty overview adds nothing beside the empty inbox", async () => {
  serveOverview([]);
  renderApp("/decisions");
  expect(await screen.findByText(/^No open reviews/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Other items that need you" })).not.toBeInTheDocument();
});

test("kinds the inbox already lists are not repeated", () => {
  const items = overview(null).attention as unknown as Parameters<typeof otherAttention>[0];
  const kinds = (covered: Parameters<typeof otherAttention>[1]) => otherAttention(items.map(i => ({ ...i, kind: i.kind }) as never), covered).map(i => i.kind);
  expect(kinds({ reviews: true, questions: true, host: false })).toEqual(["failed"]);
  expect(kinds({ reviews: false, questions: false, host: false })).toEqual(["decision", "question", "failed"]);
});
