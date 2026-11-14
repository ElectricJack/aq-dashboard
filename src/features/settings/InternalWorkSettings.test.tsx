import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { InternalWorkSettings } from "./InternalWorkSettings";

vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
const path = "/api/settings/internal-work";
const purposes = ["routing_classification", "playbook_compilation", "playbook_call", "decision_revision", "result_processing"];
const profile = (id: string, name: string) => ({ id, version: 1, name, description: "", candidates: [], projects: [] });
const snapshot = (over: Record<string, unknown> = {}) => ({ revision: "3", catalog_revision: "7", default_profile_id: "p1", overrides: {}, purposes, ...over });
const server = setupServer(http.get("/api/settings/intelligence", () => HttpResponse.json({ revision: "7", active_digest: null, model_choices: [], profiles: [profile("p1", "Fast"), profile("p2", "Careful")] })));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InternalWorkSettings /></QueryClientProvider>);
}

test("loads the default and purpose overrides with profile names", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot({ overrides: { playbook_call: "p2" } }))));
  open();
  expect(await screen.findByRole("heading", { name: "Internal work" })).toBeVisible();
  await waitFor(() => expect(screen.getByLabelText("Default profile")).toHaveValue("p1"));
  expect(within(screen.getByLabelText("Default profile")).getByRole("option", { name: "Careful" })).toBeVisible();
  expect(screen.getByLabelText("Playbook calls")).toHaveValue("p2");
  for (const label of ["Routing classification", "Playbook compilation", "Decision revision", "Result processing"]) {
    expect(screen.getByLabelText(label)).toHaveValue("");
    expect(within(screen.getByLabelText(label)).getAllByRole("option")[0]).toHaveTextContent("Use default");
  }
  expect(screen.queryByText(/No profile is set/)).toBeNull();
});
test("warns when no default is chosen", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot({ default_profile_id: null }))));
  open();
  expect(await screen.findByText("No profile is set. Internal work will fail until one is chosen.")).toBeVisible();
});
test("saves operation id, both revisions and only non-default overrides", async () => {
  let body: Record<string, unknown> | undefined;
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.post(path, async ({ request }) => {
    body = await request.json() as Record<string, unknown>;
    return HttpResponse.json(snapshot({ revision: "4", default_profile_id: body.default_profile_id, overrides: body.overrides, operation_id: body.operation_id, disposition: "saved" }));
  }));
  open();
  await waitFor(() => expect(screen.getByLabelText("Default profile")).toHaveValue("p1"));
  await userEvent.selectOptions(screen.getByLabelText("Default profile"), "p2");
  await userEvent.selectOptions(screen.getByLabelText("Playbook compilation"), "p1");
  await userEvent.click(screen.getByRole("button", { name: "Save internal work" }));
  await waitFor(() => expect(body).toBeDefined());
  expect(body).toEqual({ operation_id: expect.any(String), expected_revision: "3", expected_catalog_revision: "7", default_profile_id: "p2", overrides: { playbook_compilation: "p1" } });
  expect(await screen.findByText("Saved.")).toBeVisible();
});
test("a conflict shows the reload message and keeps the draft", async () => {
  server.use(http.get(path, () => HttpResponse.json(snapshot())), http.post(path, () => HttpResponse.json({ error: "conflict", message: "changed" }, { status: 409 })));
  open();
  await waitFor(() => expect(screen.getByLabelText("Default profile")).toHaveValue("p1"));
  await userEvent.selectOptions(screen.getByLabelText("Decision revision"), "p2");
  await userEvent.click(screen.getByRole("button", { name: "Save internal work" }));
  expect(await screen.findByText("Settings changed elsewhere. Reload to continue.")).toBeVisible();
  expect(screen.getByLabelText("Decision revision")).toHaveValue("p2");
});

test("a lost save response is confirmed by inspecting the same operation", async () => {
  let posted: Record<string, unknown> | undefined, inspected: string | undefined;
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.post(path, async ({ request }) => { posted = await request.json() as Record<string, unknown>; return HttpResponse.error(); }),
    http.get(`${path}/operations/:id`, ({ params }) => { inspected = String(params.id); return HttpResponse.json(snapshot({ revision: "4", default_profile_id: "p2", operation_id: params.id, disposition: "saved" })); }));
  open();
  await waitFor(() => expect(screen.getByLabelText("Default profile")).toHaveValue("p1"));
  await userEvent.selectOptions(screen.getByLabelText("Default profile"), "p2");
  await userEvent.click(screen.getByRole("button", { name: "Save internal work" }));
  expect(await screen.findByText("Saved.")).toBeVisible();
  expect(inspected).toBe(posted?.operation_id);
  expect(screen.queryByRole("alert")).toBeNull();
});
test("an unconfirmed save keeps the draft and retries with the same operation id", async () => {
  const ids: unknown[] = []; let inspect = 0;
  server.use(http.get(path, () => HttpResponse.json(snapshot())),
    http.post(path, async ({ request }) => {
      const body = await request.json() as Record<string, unknown>; ids.push(body.operation_id);
      return ids.length === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json(snapshot({ revision: "4", default_profile_id: "p2", operation_id: body.operation_id, disposition: "saved" }));
    }),
    http.get(`${path}/operations/:id`, () => { inspect++; return HttpResponse.json({}, { status: 503 }); }));
  open();
  await waitFor(() => expect(screen.getByLabelText("Default profile")).toHaveValue("p1"));
  await userEvent.selectOptions(screen.getByLabelText("Default profile"), "p2");
  await userEvent.click(screen.getByRole("button", { name: "Save internal work" }));
  expect(await screen.findByText("Save status is unavailable. Your edits are preserved.")).toBeVisible();
  expect(inspect).toBe(1);
  expect(screen.getByLabelText("Default profile")).toHaveValue("p2");
  expect(screen.queryByText("Settings changed elsewhere. Reload to continue.")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Save internal work" }));
  expect(await screen.findByText("Saved.")).toBeVisible();
  expect(ids).toHaveLength(2);
  expect(ids[1]).toBe(ids[0]);
});
