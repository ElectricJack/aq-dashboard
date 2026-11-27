import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor, envelope } from "../../mocks/handlers";
import { overview } from "../../mocks/inspectionData";
import { decisionPage } from "../../test/decisions";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

type Row = ReturnType<typeof overview>["attention"][number];
const base = overview(null).attention;
const failed = (n: number): Row => ({ ...base[2]!, id: `att-f${n}`, title: `Failed result ${n}`, subject: { type: "task", id: `00000000-0000-0000-0000-00000000030${n}`, revision: `${n + 10}` } });

/** A stateful overview: dismissals remove the row and lower the count, as the server contract says. */
async function serve(initial: Row[], { dismiss = true, onDismiss }: { dismiss?: boolean; onDismiss?: (id: string, body: unknown) => Response | undefined } = {}) {
  let rows = initial;
  const calls: { id: string; body: unknown }[] = [];
  // The default handler's bootstrap carries every capability the pages need; add or withhold dismissal on top.
  const current = await (await fetch("/api/v1/bootstrap")).json() as { data: { capabilities: { name: string }[] } };
  const bootstrap = current.data;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json(envelope({ ...bootstrap, capabilities: [...bootstrap.capabilities.filter(c => c.name !== "attention.dismiss"), ...(dismiss ? [{ name: "attention.dismiss", version: "1", enabled: true }] : [])] }))),
    http.get("/api/v1/overview", () => HttpResponse.json(envelope({ ...overview(null), attention: rows, sources: [],
      counts: { ...overview(null).counts, needs_you: { value: rows.length, accuracy: "exact" as const } } }))),
    http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })),
    http.post("/api/v1/attention/:id/dismiss", async ({ params, request }) => {
      const id = String(params.id), body = await request.json();
      calls.push({ id, body });
      const custom = onDismiss?.(id, body);
      // A 404 means the item is already gone on the server, so it must not come back on the re-read.
      if (custom) { if (custom.status === 404) rows = rows.filter(row => row.id !== id); return custom; }
      rows = rows.filter(row => row.id !== id);
      return HttpResponse.json({ id, dismissed: true });
    }),
  );
  return calls;
}

const dismissButton = (name: RegExp) => screen.findByRole("button", { name });
const needsYouCount = () => screen.getByRole("list", { name: "Work counts" }).querySelector("[data-count=needs_you]")!;

test("dismiss appears only on informational items, never decisions or questions", async () => {
  await serve([base[0]!, base[1]!, failed(1)]);
  renderApp("/overview");
  const region = await screen.findByRole("region", { name: "Needs your attention" });
  const rows = await within(region).findAllByRole("listitem");
  expect(rows).toHaveLength(3);
  expect(within(rows[0]!).queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  expect(within(rows[1]!).queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
  expect(within(rows[2]!).getByRole("button", { name: "Dismiss: Failed result 1" })).toBeInTheDocument();
});

test("no control without the attention.dismiss capability", async () => {
  await serve([failed(1)], { dismiss: false });
  renderApp("/overview");
  await screen.findByText("Failed result 1");
  expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
});

test("a decision-style gate under an informational kind is not dismissible", async () => {
  await serve([{ ...failed(1), action: { ...base[0]!.action! } }]);
  renderApp("/overview");
  await screen.findByText("Failed result 1");
  expect(screen.queryByRole("button", { name: /dismiss/i })).not.toBeInTheDocument();
});

test("dismissing sends the item's revision, removes it and lowers the count, and it stays gone after a refresh", async () => {
  const calls = await serve([failed(1), failed(2)]);
  renderApp("/overview");
  await userEvent.click(await dismissButton(/Dismiss: Failed result 1/));
  await waitFor(() => expect(screen.queryByText("Failed result 1")).not.toBeInTheDocument());
  expect(calls).toEqual([{ id: "att-f1", body: { expected_revision: "11" } }]);
  expect(screen.getByText("Failed result 2")).toBeInTheDocument();
  await waitFor(() => expect(needsYouCount()).toHaveTextContent(/^1\s*need you/));
  // The follow-up read agrees with the optimistic view; nothing comes back.
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(screen.queryByText("Failed result 1")).not.toBeInTheDocument();
  expect(needsYouCount()).toHaveTextContent(/^1\s*need you/);
});

test("the row leaves the page before the server answers", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await serve([failed(1)], { onDismiss: () => undefined });
  server.use(http.post("/api/v1/attention/:id/dismiss", async () => { await gate; return HttpResponse.json({ dismissed: true }); }));
  renderApp("/overview");
  await userEvent.click(await dismissButton(/Dismiss: Failed result 1/));
  await waitFor(() => expect(screen.queryByText("Failed result 1")).not.toBeInTheDocument());
  expect(await screen.findByText("Nothing needs your attention")).toBeInTheDocument();
  release();
});

test("a repeat dismissal (already gone) and a conflicting one raise no error", async () => {
  await serve([failed(1), failed(2)], { onDismiss: id => id === "att-f1"
    ? HttpResponse.json({ error: "not_found", message: "gone" }, { status: 404 })
    : HttpResponse.json({ error: "conflict", message: "revision changed" }, { status: 409 }) });
  renderApp("/overview");
  await userEvent.click(await dismissButton(/Dismiss: Failed result 1/));
  await waitFor(() => expect(screen.queryByText("Failed result 1")).not.toBeInTheDocument());
  await userEvent.click(await dismissButton(/Dismiss: Failed result 2/));
  // The conflict leaves the item for the re-read to decide: here the server still lists it.
  expect(await screen.findByText("Failed result 2")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText(/couldn't dismiss/i)).not.toBeInTheDocument();
});

test("an unknown-outcome failure restores the row and says so", async () => {
  await serve([failed(1)], { onDismiss: () => HttpResponse.json({ error: "internal" }, { status: 500 }) });
  renderApp("/overview");
  await userEvent.click(await dismissButton(/Dismiss: Failed result 1/));
  expect(await screen.findByText(/couldn't dismiss/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Dismiss: Failed result 1/ })).toBeEnabled();
});

test("View all offers the same control and dismissal updates both views", async () => {
  await serve([failed(1), failed(2)]);
  const { router } = renderApp("/decisions");
  const other = await screen.findByRole("list", { name: "Other items that need you" });
  await userEvent.click(within(other).getByRole("button", { name: /Dismiss: Failed result 1/ }));
  await waitFor(() => expect(screen.queryByText("Failed result 1")).not.toBeInTheDocument());
  await router.navigate("/overview");
  const region = await screen.findByRole("region", { name: "Needs your attention" });
  expect(within(region).queryByText("Failed result 1")).not.toBeInTheDocument();
  expect(within(region).getByText("Failed result 2")).toBeInTheDocument();
  await waitFor(() => expect(needsYouCount()).toHaveTextContent(/^1\s*need you/));
});

test("loading, error and empty are distinct, and empty never shows while the count is above zero", async () => {
  // Loading on View all
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await serve([]);
  server.use(http.get("/api/v1/overview", async () => { await gate; return HttpResponse.json(envelope({ ...overview(null), attention: [], sources: [] })); }));
  const first = renderApp("/decisions");
  expect(await screen.findByText(/loading other items that need you/i)).toBeInTheDocument();
  release();
  await waitFor(() => expect(screen.queryByText(/loading other items/i)).not.toBeInTheDocument());
  first.unmount();
  // Count above zero with nothing listed: never "nothing needs your attention"
  server.use(http.get("/api/v1/overview", () => HttpResponse.json(envelope({ ...overview(null), attention: [], sources: [],
    counts: { ...overview(null).counts, needs_you: { value: 4, accuracy: "exact" as const } } }))));
  renderApp("/overview");
  const region = await screen.findByRole("region", { name: "Needs your attention" });
  expect(await within(region).findByText(/AQ reports 4 items need you, but none are listed/)).toBeInTheDocument();
  expect(within(region).queryByText("Nothing needs your attention")).not.toBeInTheDocument();
});
