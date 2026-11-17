import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { projectRecord } from "../../test/projectBindings";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function capability(enabled: boolean) {
  server.use(http.get("/api/v1/projects", () => HttpResponse.json({ ...bootstrap, data: { items: [], next_cursor: null, has_more: false, snapshot_id: "test", total: { value: 0, accuracy: "exact" } } })), http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "projects.read"), { name: "projects.read", version: "1", enabled, reason: "Project inspection requires an owner account" }] } })));
}
test("disabled owner capability never requests project bindings", async () => {
  capability(false); let calls = 0;
  server.use(http.get("/api/projects", () => { calls++; return HttpResponse.json({}); }));
  renderApp("/settings?tab=projects"); await screen.findByText("Project inspection requires an owner account"); expect(calls).toBe(0);
});
test("loading is explicit, then actual configuration and historical status labels are shown", async () => {
  capability(true); let resolve!: () => void;
  const waiting = new Promise<void>(r => { resolve = r; });
  server.use(http.get("/api/projects", async () => { await waiting; return HttpResponse.json({ items: [projectRecord()], next_cursor: null }); }));
  renderApp("/settings?tab=projects"); await screen.findByText("Loading project execution bindings…"); resolve();
  const list = await screen.findByRole("list", { name: "Project execution bindings" });
  expect(within(list).getByText("Project 1")).toBeInTheDocument();
  expect(list).toHaveTextContent("Setup needed");
  await userEvent.click(within(list).getByText("Configuration and connection details"));
  expect(list).toHaveTextContent("Revision 2"); expect(list).toHaveTextContent("Repository: Verified · Graph: Stale");
  expect(list).toHaveTextContent("None individually listed");
  expect(list).toHaveTextContent("Allowed worker groups");
  expect(list).toHaveTextContent("Recorded external checks");
});
test("a project shows its default role, its default level and its notes for each role, read-only", async () => {
  capability(true);
  const named = projectRecord(); named.binding.default_role = "reviewer"; named.binding.default_intelligence = "deep-low";
  named.binding.role_notes = { reviewer: "Check the migration notes.\nAsk before touching billing.", developer: "Run the linter." };
  // As the server writes a binding whose defaults are the usual ones: neither default, and no notes.
  const usual = projectRecord(2); usual.binding.default_role = undefined; usual.binding.default_intelligence = undefined; usual.binding.role_notes = undefined;
  server.use(http.get("/api/projects", () => HttpResponse.json({ items: [named, usual], next_cursor: null })));
  renderApp("/settings?tab=projects");
  // Shown on the card itself, without opening the configuration details.
  const defaults = await screen.findByRole("list", { name: "Notes for roles in Project 1" }).then(() => screen.getByLabelText("Defaults of Project 1"));
  expect(defaults).toHaveTextContent("Default rolereviewer"); expect(defaults).toHaveTextContent("Default levelDeep · Low (deep-low)");
  const notes = within(defaults).getByRole("list", { name: "Notes for roles in Project 1" });
  expect(within(notes).getAllByRole("listitem").map(item => item.querySelector("summary")!.textContent)).toEqual(["developer", "reviewer"]);
  await userEvent.click(within(notes).getByText("reviewer"));
  expect(within(notes).getByText(/Check the migration notes\.\s+Ask before touching billing\./)).toBeVisible();
  expect(within(defaults).queryByRole("textbox")).toBeNull();
  const other = screen.getByLabelText("Defaults of Project 2");
  expect(other).toHaveTextContent("Default roledeveloper"); expect(other).toHaveTextContent("Default levelStandard · High (standard-high)"); expect(other).toHaveTextContent("Notes for rolesNone");
});
test("empty is distinct from unavailable; retry is an explicit read", async () => {
  capability(true); let calls = 0;
  server.use(http.get("/api/projects", () => ++calls === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ items: [], next_cursor: null })));
  renderApp("/settings?tab=projects"); await screen.findByRole("alert"); expect(screen.queryByText("No project execution bindings configured.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByText("No project execution bindings configured."); expect(calls).toBe(2);
});
test("pagination is explicit and uses the exact returned UUID cursor", async () => {
  capability(true); const rows = Array.from({ length: 25 }, (_, i) => projectRecord(i + 1)); let calls = 0;
  server.use(http.get("/api/projects", ({ request }) => { calls++; const q = new URL(request.url).searchParams;
    expect(q.get("limit")).toBe("25");
    if (calls === 1) return HttpResponse.json({ items: rows, next_cursor: rows[24]!.binding.project_id });
    expect(q.get("after")).toBe(rows[24]!.binding.project_id); return HttpResponse.json({ items: [projectRecord(26)], next_cursor: null });
  }));
  renderApp("/settings?tab=projects"); await screen.findByText("Project 25"); expect(calls).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: "Load more project bindings" })); await screen.findByText("Project 26");
  await waitFor(() => expect(screen.queryByRole("button", { name: "Load more project bindings" })).toBeNull()); expect(calls).toBe(2);
});
test("a binding with no lists and no allow_enrolled_nodes field renders as enrolled machines allowed", async () => {
  capability(true); const r = projectRecord(); r.binding.allowed_worker_groups = [];
  server.use(http.get("/api/projects", () => HttpResponse.json({ items: [r], next_cursor: null })));
  renderApp("/settings?tab=projects"); const list = await screen.findByRole("list", { name: "Project execution bindings" });
  expect(list).toHaveTextContent(/Enrolled machines\s*allowed/);
});
test("allow_enrolled_nodes false renders as not allowed", async () => {
  capability(true); const r = projectRecord() as ReturnType<typeof projectRecord> & { binding: Record<string, unknown> }; r.binding.allow_enrolled_nodes = false;
  server.use(http.get("/api/projects", () => HttpResponse.json({ items: [r], next_cursor: null })));
  renderApp("/settings?tab=projects"); const list = await screen.findByRole("list", { name: "Project execution bindings" });
  expect(list).toHaveTextContent(/Enrolled machines\s*not allowed/);
});
