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
const server = setupServer(http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "2", active_digest: null, profiles: [], model_choices: [] })));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><StructureDraftProvider><RoutingPolicyEditor /><ParentDescriptionEditor parent="standard" structure={snapshot() as Parameters<typeof ParentDescriptionEditor>[0]["structure"]} catalogRevision="2" busy={false} onBusy={() => {}} onSaved={async () => {}} onReload={async () => {}} /><button onClick={() => void registered.entry?.save()}>Save page</button></StructureDraftProvider></QueryClientProvider>);
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
