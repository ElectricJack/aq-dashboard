import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { playbookPage, runDetail, runRecord } from "../../test/playbooks";
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
  expect(within(detail).getByRole("list", { name: "Execution timeline" })).toHaveTextContent("9007199254740993");
  expect(within(detail).getByText("decision.request")).toBeInTheDocument(); expect(within(detail).getByText("effect pending")).toBeInTheDocument();
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
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Loaded run states" }), "completed"); await screen.findByText("No loaded runs match this state.");
  expect(screen.queryByText("No runs recorded in this configured namespace.")).toBeNull();
});
test("run labels render as literal text and forbidden reads clear the protected page", async () => {
  enabled(); const badLabel = "<img src=x onerror=alert(1)>";
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json(playbookPage([{ ...runRecord(), entry: badLabel }]))));
  const { queryClient } = renderApp("/playbooks");
  await screen.findByText(badLabel); expect(document.querySelector('img[src="x"]')).toBeNull();
  server.use(http.get("/api/playbooks/inspection/runs", () => HttpResponse.json({}, { status: 403 })));
  await queryClient.invalidateQueries({ predicate: q => q.queryKey.includes("playbook-runs") });
  await screen.findByRole("heading", { name: "Access denied" }); expect(screen.queryByText(badLabel)).toBeNull();
});
