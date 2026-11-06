import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { PLAYBOOK_TIME, playbookPage, runDetail, runRecord } from "../../test/playbooks";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function enabled(on = true) { server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "playbooks.inspect"), { name: "playbooks.inspect", version: "1", enabled: on, reason: "Playbook runtime is not configured" }] } }))); }
function responses() { enabled(); server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([runRecord()]))), http.get("/api/playbooks/inspection/runs/:id", ({ params }) => HttpResponse.json(runDetail(String(params.id))))); }
test("unconfigured capability makes no playbook request", async () => {
  enabled(false); let reads = 0; server.use(http.get("/api/playbooks/inspection/runs", () => { reads++; return HttpResponse.json({}); }));
  renderApp("/playbooks"); await screen.findByText("Playbook runtime is not configured"); expect(reads).toBe(0);
});
test("discovery opens exact run and shows pins, timeline and pending operation", async () => {
  responses(); const { router } = renderApp("/playbooks");
  const list = await screen.findByRole("list", { name: "Playbook runs" }); await userEvent.click(within(list).getByRole("link"));
  const detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  expect(router.state.location.pathname).toBe("/playbooks/runs/run-0000000000000001");
  expect(within(detail).getByText(`sha256:${"a".repeat(64)}`)).toBeInTheDocument();
  const timeline = within(detail).getByRole("list", { name: "Execution timeline" });
  expect(within(timeline).getAllByRole("listitem").map(li => li.textContent)).toEqual(["InspectCompleted", "Request reviewWaiting"]);
  expect(within(timeline).getByText("Request review").closest("li")).toHaveAttribute("aria-current", "step");
  expect(within(detail).getByRole("tab", { name: "Execution" })).toHaveAttribute("aria-selected", "true");
  expect(within(detail).getByText("decision.request")).toBeInTheDocument(); expect(within(detail).getByText("Operation")).toBeInTheDocument();
  await userEvent.click(within(detail).getByRole("tab", { name: "Events" }));
  const table = within(detail).getByRole("table", { name: "Recent evidence" });
  expect(within(table).getAllByRole("row")).toHaveLength(3);
  expect(within(table).getByRole("link", { name: "Receipt 9007199254740993" })).toHaveAttribute("href", "#receipt-9007199254740993");
  expect(within(table).getByText(/Operation accepted · Request review/)).toBeInTheDocument();
  expect(within(detail).getByText(/^Observed \d+s ago$/)).toBeInTheDocument();
  expect(within(detail).getByRole("tab", { name: "Inputs & outputs" })).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(within(detail).getByRole("tab", { name: "Definition" }));
  expect(within(detail).getByRole("link", { name: "Open in Definitions" })).toHaveAttribute("href", `/playbooks?view=definitions&definition=sha256%3A${"a".repeat(64)}`);
});
test("empty and failed discovery remain distinct and failure retries explicitly", async () => {
  enabled(); let reads = 0; server.use(http.get("/api/playbooks/inspection/runs", () => ++reads === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(playbookPage([]))));
  renderApp("/playbooks"); await screen.findByRole("alert"); expect(screen.queryByText("No runs recorded in this configured namespace.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByText("No runs recorded in this configured namespace."); expect(reads).toBe(2);
});
test("next run page uses exact cursor and keeps bounded rows", async () => {
  enabled(); const records = Array.from({ length: 25 }, (_, i) => runRecord(`run-${String(i + 1).padStart(16, "0")}`));
  server.use(http.get("/api/playbooks/inspection/runs", ({ request }) => { const q = new URL(request.url).searchParams; expect(q.get("limit")).toBe("25"); return HttpResponse.json(q.get("after") ? playbookPage([runRecord("run-0000000000000026")]) : playbookPage(records, records[24]!.id)); }));
  renderApp("/playbooks"); await screen.findByRole("list", { name: "Playbook runs" }); await userEvent.click(screen.getByRole("button", { name: "Load more runs" }));
  await waitFor(() => expect(within(screen.getByRole("list", { name: "Playbook runs" })).getAllByRole("listitem")).toHaveLength(26));
});
test("admissions show pending without inventing an engine run", async () => {
  responses(); server.use(http.get("/api/playbooks/inspection/admissions", () => HttpResponse.json({ ...playbookPage([{ request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", status: "pending", created_at_ms: 1, run_id: null, activation_revision: null, catalog_revision: null }]), revision: null })));
  renderApp("/playbooks"); await screen.findByRole("list", { name: "Playbook runs" }); await userEvent.click(screen.getByRole("tab", { name: "Admissions" }));
  await screen.findByText("Engine run not confirmed"); expect(screen.queryByRole("link", { name: "Inspect admitted run" })).toBeNull();
});
test("loaded state filter describes only loaded rows", async () => {
  responses(); renderApp("/playbooks"); await screen.findByRole("list", { name: "Playbook runs" });
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Run state" }), "completed"); await screen.findByText("No loaded runs match these filters.");
  expect(screen.getByText("Filtering loaded runs")).toBeInTheDocument();
  expect(screen.queryByText("No runs recorded in this configured namespace.")).toBeNull();
});
test("run labels render as literal text and a forbidden read clears only its panel", async () => {
  enabled(); const badLabel = "<img src=x onerror=alert(1)>";
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([{ ...runRecord(), entry: badLabel }]))));
  const { queryClient } = renderApp("/playbooks");
  await screen.findByText(badLabel); expect(document.querySelector('img[src="x"]')).toBeNull();
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json({}, { status: 403 })));
  await queryClient.invalidateQueries({ predicate: q => q.queryKey.includes("playbook-runs") });
  await screen.findByText("Viewing playbook runs is not permitted for your account."); expect(screen.queryByText(badLabel)).toBeNull();
  expect(screen.queryByRole("heading", { name: "Access denied" })).toBeNull(); expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
});
test("run rows show a short id, relative age and a loaded-rows time range", async () => {
  enabled(); const old = { ...runRecord("run-0000000000000002", "completed"), admitted_at_ms: PLAYBOOK_TIME - 2 * 86_400_000 };
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([runRecord(), old]))));
  renderApp("/playbooks"); const list = await screen.findByRole("list", { name: "Playbook runs" });
  const row = within(list).getByRole("link", { name: /run-0000000000000001/ });
  expect(row).toHaveTextContent(/Main\s*run-1\s*run-0000000000000001 · 5s ago/);
  expect(within(row).getByText("5s ago")).toHaveAttribute("dateTime", new Date(PLAYBOOK_TIME - 5000).toISOString());
  expect(within(list).getAllByRole("link")).toHaveLength(1);
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Time range" }), "all");
  expect(within(list).getAllByRole("link")).toHaveLength(2); expect(screen.queryByText("Filtering loaded runs")).toBeNull();
  expect(screen.getByRole("button", { name: "Refresh runs" })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
});

test("default filters announce nothing; a chosen state is kept in the URL and restored (ISSUE-005, ISSUE-011)", async () => {
  responses(); const { router } = renderApp("/playbooks"); const list = await screen.findByRole("list", { name: "Playbook runs" });
  expect(screen.queryByText("Filtering loaded runs")).toBeNull();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Run state" }), "waiting");
  expect(screen.getByText("Filtering loaded runs")).toBeInTheDocument();
  expect(new URLSearchParams(router.state.location.search).get("state")).toBe("waiting");
  // Run links carry the filters so the list comes back narrowed.
  expect(within(list).getByRole("link")).toHaveAttribute("href", "/playbooks/runs/run-0000000000000001?state=waiting");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Time range" }), "7d");
  expect(new URLSearchParams(router.state.location.search).get("range")).toBe("7d");
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Run state" }), "all");
  expect(new URLSearchParams(router.state.location.search).has("state")).toBe(false);
});
test("filters from a shared URL are applied on load (ISSUE-011)", async () => {
  responses(); renderApp("/playbooks?state=completed&range=all"); await screen.findByText("No loaded runs match these filters.");
  expect(screen.getByRole("combobox", { name: "Run state" })).toHaveValue("completed"); expect(screen.getByRole("combobox", { name: "Time range" })).toHaveValue("all");
});
test("view tabs control a tabpanel (ISSUE-010)", async () => {
  responses(); renderApp("/playbooks"); await screen.findByRole("list", { name: "Playbook runs" });
  const tab = screen.getByRole("tab", { name: "Runs" }), panel = screen.getByRole("tabpanel", { name: "Runs" });
  expect(tab).toHaveAttribute("aria-controls", panel.id); expect(within(panel).getByRole("region", { name: "Recent runs" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Admissions" })).not.toHaveAttribute("aria-controls");
});
test("a run deep link with both reads failing offers one retry that reloads both (ISSUE-010)", async () => {
  enabled(); let list = 0, detail = 0;
  server.use(http.get("/api/playbooks/inspection/runs", () => ++list === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(playbookPage([runRecord()]))),
    http.get("/api/playbooks/inspection/runs/:id", ({ params }) => ++detail === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(runDetail(String(params.id)))));
  renderApp("/playbooks/runs/run-0000000000000001");
  await screen.findByText(/Couldn't load this playbook run either/);
  expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await screen.findByRole("region", { name: "Run run-0000000000000001" }); expect(list).toBe(2); expect(detail).toBe(2);
});
test("the run inspector names the entry as the roster does and keeps the raw id (ISSUE-012)", async () => {
  enabled(); server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([]))),
    http.get("/api/playbooks/inspection/runs/:id", ({ params }) => { const d = runDetail(String(params.id)); return HttpResponse.json({ ...d, run: { ...d.run, entry: "build_artifact" } }); }));
  renderApp("/playbooks/runs/run-0000000000000001");
  const detail = await screen.findByRole("region", { name: "Run run-0000000000000001" });
  expect(within(detail).getByRole("heading", { level: 2, name: "Build artifact" })).toHaveAttribute("title", "build_artifact");
  expect(within(detail).getByText(/This run:/)).toHaveTextContent("This run: Build artifact");
});
