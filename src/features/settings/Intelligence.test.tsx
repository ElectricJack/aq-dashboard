import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";

const candidate = { id: "primary", provider: "anthropic", model: "configured-model", reasoning_configuration_reference: "balanced@1", harnesses: ["claude"] };
const choices = ["balanced", "deep"].map(reasoning => ({ provider: "anthropic", model: "configured-model", reasoning_configuration_reference: `${reasoning}@1`, reasoning, harness: "claude" }));
function snapshot() { return { revision: "12", active_digest: "a".repeat(64), profiles: [{ id: "standard", version: 1, name: "Standard", description: "Everyday work", candidates: [candidate], projects: [{ id: "p", name: "Example", enabled: true }] }], model_choices: choices }; }
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function read(data = snapshot()) { server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data))); }
async function edit() {
  renderApp("/settings/intelligence");
  await userEvent.click(await screen.findByRole("button", { name: "Edit Standard" }));
  return screen.getByRole("region", { name: "Edit Standard" });
}
const saved = (operation: string) => ({ operation_id: operation, disposition: "saved", revision: "13", active_digest: "b".repeat(64), updated_projects: [{ id: "p", name: "Example", revision: "2" }] });

test("reads real settings and saves the draft revision, metadata, model and reasoning", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data)), http.post("/api/settings/intelligence", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    data = { ...data, revision: "13", profiles: [{ ...data.profiles[0]!, name: submitted.name as string, description: submitted.description as string, version: 2, candidates: submitted.candidates as typeof data.profiles[0]["candidates"] }] };
    return HttpResponse.json(saved(submitted.operation_id as string));
  }));
  const form = await edit();
  await userEvent.clear(within(form).getByLabelText("Name")); await userEvent.type(within(form).getByLabelText("Name"), "Deep work");
  await userEvent.selectOptions(within(form).getByLabelText("Reasoning"), "deep@1:claude");
  await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await screen.findByText("Profile saved. Future agent launches will use the updated settings.");
  expect(submitted).toMatchObject({ expected_revision: "12", profile_id: "standard", profile_version: 1, name: "Deep work", candidates: [{ ...candidate, reasoning_configuration_reference: "deep@1" }] });
  expect(submitted?.operation_id).toMatch(/^[a-f0-9-]{36}$/);
  await screen.findByRole("button", { name: "Edit Deep work" });
});

test("a conflicting save preserves the draft and cannot overwrite newer settings", async () => {
  read(); server.use(http.post("/api/settings/intelligence", () => HttpResponse.json({ request_id: "conflict", code: "conflict", message: "Profiles changed since this editor opened.", retryable: false }, { status: 409 })));
  const form = await edit(); await userEvent.type(within(form).getByLabelText("Name"), " revised");
  await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await within(form).findByRole("alert");
  expect(within(form).getByLabelText("Name")).toHaveValue("Standard revised");
  expect(within(form).getByRole("button", { name: "Save changes" })).toBeDisabled();
});

test("an interrupted response is reconciled by operation id without resending", async () => {
  read(); let operation = ""; let posts = 0;
  server.use(http.post("/api/settings/intelligence", async ({ request }) => { operation = (await request.json() as { operation_id: string }).operation_id; posts++; return HttpResponse.error(); }),
    http.get("/api/settings/intelligence/operations/:id", ({ params }) => HttpResponse.json(saved(String(params.id)))));
  const form = await edit(); await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await within(form).findByRole("button", { name: "Check save status" });
  expect(within(form).getByLabelText("Name")).toBeDisabled();
  await userEvent.click(within(form).getByRole("button", { name: "Check save status" }));
  await screen.findByText("Profile saved. Future agent launches will use the updated settings.");
  expect(operation).not.toBe(""); expect(posts).toBe(1);
});

test("an unrecorded interrupted save retries its exact original request", async () => {
  read(); const requests: unknown[] = [];
  server.use(http.post("/api/settings/intelligence", async ({ request }) => {
    const body = await request.json() as { operation_id: string }; requests.push(body);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json(saved(body.operation_id));
  }), http.get("/api/settings/intelligence/operations/:id", () => HttpResponse.json({}, { status: 404 })));
  const form = await edit(); await userEvent.click(within(form).getByRole("button", { name: "Save changes" }));
  await userEvent.click(await within(form).findByRole("button", { name: "Check save status" }));
  await userEvent.click(await within(form).findByRole("button", { name: "Retry same save" }));
  await screen.findByText("Profile saved. Future agent launches will use the updated settings.");
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
});

test("Settings links to the editor and an empty catalog has a clear state", async () => {
  read({ ...snapshot(), profiles: [] }); const { router } = renderApp("/settings");
  await userEvent.click(await screen.findByRole("link", { name: "Manage intelligence profiles →" }));
  await waitFor(() => expect(router.state.location.pathname).toBe("/settings/intelligence"));
  await screen.findByText("No intelligence profiles are configured.");
});
