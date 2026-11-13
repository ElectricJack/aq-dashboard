import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { ParentDescriptionEditor, StructureDraftProvider } from "./IntelligenceStructureControls";
import { RoutingPolicyEditor } from "./RoutingPolicyEditor";

const registered = vi.hoisted(() => ({ entry: null as null | { save(): Promise<boolean>; locked: boolean; dirty: boolean } }));
vi.mock("./IntelligenceDrafts", () => ({ useIntelligenceDraft: (entry: typeof registered.entry) => { registered.entry = entry; return { saving: false }; } }));
vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
const path = "/api/settings/intelligence/structure";
const snapshot = () => ({ revision: "1", catalog_revision: "2", routing_markdown: "# Policy\n", parents: [
  { id: "simple", description: "Simple" }, { id: "standard", description: "Standard" }, { id: "complex", description: "Complex" }, { id: "deep", description: "Deep" },
], assignments: [{ profile_id: "profile", parent_id: "simple", effort: "low" }] });
const routingPath = "/api/settings/intelligence/routing";
const none = { enabled: false, active: null, latest: null };
const server = setupServer(
  http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "2", active_digest: null, profiles: [], model_choices: [] })),
  http.get(routingPath, () => HttpResponse.json(none)),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open(pollMs?: number) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StructureDraftProvider><RoutingPolicyEditor pollMs={pollMs} /><ParentDescriptionEditor parent="standard" structure={snapshot() as Parameters<typeof ParentDescriptionEditor>[0]["structure"]} catalogRevision="2" busy={false} onBusy={() => {}} onSaved={async () => {}} onReload={async () => {}} /><button onClick={() => void registered.entry?.save()}>Save page</button></StructureDraftProvider></QueryClientProvider>);
  return client;
}

test("saves exact Markdown and preserves the snapshot captured on first edit across refresh", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...data, revision: "2", routing_markdown: submitted.routing_markdown, operation_id: submitted.operation_id, disposition: "saved" });
  }));
  const client = open(); const editor = await screen.findByLabelText("Markdown");
  fireEvent.change(editor, { target: { value: "  # Héllo\n\n" } });
  data = { ...data, revision: "2", parents: data.parents.map(p => ({ ...p, description: "changed" })) };
  await client.invalidateQueries();
  expect(editor).toHaveValue("  # Héllo\n\n");
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toMatchObject({ expected_revision: "2", expected_catalog_revision: "2", routing_markdown: "  # Héllo\n\n", parents: data.parents, assignments: snapshot().assignments });
});

test("conflict preserves the draft until explicit reload", async () => {
  let data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, () => HttpResponse.json({}, { status: 409 })));
  open(); const editor = await screen.findByLabelText("Markdown"); fireEvent.change(editor, { target: { value: "draft" } });
  data = { ...data, revision: "2", routing_markdown: "latest" };
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("edits are preserved"); expect(editor).toHaveValue("draft");
  expect(registered.entry?.locked).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Reload structure settings" }));
  await waitFor(() => expect(editor).toHaveValue("latest"));
});

test("unknown save checks status then retries the exact operation", async () => {
  const requests: Record<string, unknown>[] = []; const data = snapshot();
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ ...data, revision: "2", routing_markdown: body.routing_markdown, operation_id: body.operation_id, disposition: "saved" });
  }), http.get(`${path}/operations/:id`, () => HttpResponse.json({}, { status: 404 })));
  open(); fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same save" }));
  await screen.findByText("Structure saved."); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test("enforces the UTF-8 byte limit", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot()))); open();
  fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "é".repeat(65537) } });
  expect(screen.getByRole("alert")).toHaveTextContent("128 KiB"); expect(registered.entry?.locked).toBe(true);
});

test("combines description and policy drafts and clears a reverted field", async () => {
  const data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(data)), http.post(path, async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json({ ...data, revision: "2", parents: submitted.parents, routing_markdown: submitted.routing_markdown, operation_id: submitted.operation_id, disposition: "saved" });
  }));
  open(); const policy = await screen.findByLabelText("Markdown"); const description = screen.getByLabelText("Standard description");
  fireEvent.change(policy, { target: { value: "changed" } }); fireEvent.change(policy, { target: { value: data.routing_markdown } });
  expect(registered.entry?.dirty).toBe(false);
  fireEvent.change(policy, { target: { value: "policy" } }); fireEvent.change(description, { target: { value: "Updated" } });
  await userEvent.click(screen.getByRole("button", { name: "Save page" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toMatchObject({ routing_markdown: "policy", parents: expect.arrayContaining([expect.objectContaining({ id: "standard", description: "Updated" })]) });
});

const active = (problems: { path: string; message: string }[] = []) => ({
  digest: "sha256:" + "a".repeat(64), structure_revision: 1, created_at_ms: 1_000, took_effect_at_ms: 2_000, problems,
  summary: ["Bug fixes: Standard, high effort; Complex, high effort after 1 failed attempt.", "High risk: at least Standard, high effort; Claude or Codex only."],
});
const latest = (status: string, extra: Record<string, unknown> = {}) => ({
  status, structure_revision: 1, error: null, problems: [], unresolved: [], internal_task_id: "00000000-0000-4000-8000-000000000001", created_at_ms: 1_000, finished_at_ms: status === "compiling" ? null : 2_000, ...extra,
});

test("says saved changes are compiled", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot()))); open();
  expect(await screen.findByText("Saved changes are compiled and take effect when they compile.")).toBeVisible();
  expect(screen.queryByText(/playbook execution will be connected later/)).toBeNull();
});

test("shows Compiling… until the compile finishes, then how the policy routes", async () => {
  let reads = 0;
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(routingPath, () => {
    reads++;
    return HttpResponse.json(reads < 3 ? { ...none, latest: latest("compiling") } : { enabled: false, active: active(), latest: latest("active") });
  }));
  open(20);
  expect(await screen.findByText("Compiling…")).toBeVisible();
  const summary = await screen.findByRole("region", { name: "How this policy routes" });
  expect(summary).toHaveTextContent("Bug fixes: Standard, high effort; Complex, high effort after 1 failed attempt.");
  expect(summary).toHaveTextContent("High risk: at least Standard, high effort; Claude or Codex only.");
  expect(summary).toHaveTextContent("In effect since");
  expect(screen.queryByText("Compiling…")).toBeNull();
  const settled = reads;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(reads).toBe(settled);
});

test("a failed compile keeps the previous policy and lists its problems, unresolved sentences and the run", async () => {
  const run = { id: "00000000-0000-4000-8000-000000000001", purpose: "playbook_compilation", status: "answered", affected: { kind: "routing_policy", id: "2", project_id: null },
    instructions: "Compile the policy.", input: "# Routing", answer: { policy: {} }, attempts: [], provider: "openai", model: "fixture-model", way: "api", elapsed_ms: 900, created_at_ms: 1, escalation: "none" };
  let asked: URLSearchParams | undefined;
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.get(routingPath, () => HttpResponse.json({ enabled: true, active: active(), latest: latest("failed", {
      structure_revision: 2, error: "kinds.docs.class: Standard, high effort is above the highest level for this kind\nCould not be resolved: Art goes to the plotter.",
      problems: [{ path: "kinds.docs.class", message: "Standard, high effort is above the highest level for this kind" }], unresolved: ["Art goes to the plotter."] }) })),
    http.get("/api/internal-work/runs", ({ request }) => { asked = new URL(request.url).searchParams; return HttpResponse.json({ runs: [run], next_cursor: null }); }));
  open();
  const failure = await screen.findByText(/This version did not compile/);
  expect(failure).toHaveTextContent("This version did not compile. The previous policy is still routing.");
  expect(screen.getByRole("list", { name: "Compile problems" })).toHaveTextContent("Standard, high effort is above the highest level for this kind kinds.docs.class");
  expect(screen.getByRole("list", { name: "Unresolved sentences" })).toHaveTextContent("Art goes to the plotter.");
  expect(await screen.findByRole("region", { name: "Internal work" })).toBeVisible();
  expect(asked?.get("affected_kind")).toBe("routing_policy");
  expect(asked?.get("affected_id")).toBe("2");
  expect(screen.getByRole("region", { name: "How this policy routes" })).toBeVisible();
});

test("a failed first compile says no policy routes yet and shows the error when there are no problems", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.get(routingPath, () => HttpResponse.json({ ...none, latest: latest("failed", { error: "The compile did not finish (no candidate): no internal work profile configured" }) })),
    http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [], next_cursor: null })));
  open();
  expect(await screen.findByText(/This version did not compile/)).toHaveTextContent("This version did not compile. No policy is routing yet.");
  expect(screen.getByText("The compile did not finish (no candidate): no internal work profile configured")).toBeVisible();
});

test("the switch is disabled until a policy is active, then turns routing on", async () => {
  let state: Record<string, unknown> = none; let posted: unknown;
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.get(routingPath, () => HttpResponse.json(state)),
    http.post(routingPath, async ({ request }) => { posted = await request.json(); state = { ...state, enabled: true }; return HttpResponse.json(state); }));
  const client = open();
  const toggle = await screen.findByRole("switch", { name: "Route tasks with this policy" });
  expect(toggle).toBeDisabled(); expect(toggle).not.toBeChecked();
  state = { enabled: false, active: active(), latest: latest("active") };
  await client.invalidateQueries();
  await waitFor(() => expect(toggle).toBeEnabled());
  await userEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeChecked());
  expect(posted).toEqual({ enabled: true });
});

test("lists what the active policy no longer fits in Settings", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.get(routingPath, () => HttpResponse.json({ enabled: true, active: active([{ path: "reserved[0].classes[1]", message: "Deep, high effort has no assigned profile in Settings" }]), latest: latest("active") })));
  open();
  expect(await screen.findByRole("list", { name: "Active policy problems" })).toHaveTextContent("Deep, high effort has no assigned profile in Settings");
  expect(screen.getByRole("switch", { name: "Route tasks with this policy" })).toBeChecked();
});
