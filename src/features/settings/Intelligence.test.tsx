import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import type { Candidate, IntelligenceProfile } from "../../api/intelligenceSettings";

const anthropic: Candidate = { id: "anthropic-choice", provider: "anthropic", model: "configured-model", reasoning_configuration_reference: "balanced@1", harnesses: ["claude"] };
const openai: Candidate = { id: "openai-choice", provider: "openai", model: "configured-codex", reasoning_configuration_reference: "high@1", harnesses: ["codex"] };
const profile: IntelligenceProfile = { id: "standard", version: 1, name: "Standard", description: "Everyday work", candidates: [anthropic, openai], projects: [{ id: "p", name: "Example", enabled: true }] };
function snapshot() { return { revision: "12", active_digest: "a".repeat(64), profiles: [structuredClone(profile)], model_choices: [
  { ...anthropic, harness: "claude", reasoning: "balanced" },
  { ...openai, harness: "codex", reasoning: "high" },
  { ...openai, harness: "codex", reasoning: "medium", reasoning_configuration_reference: "medium@1" },
] }; }
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function read(data = snapshot()) { server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data))); }
async function open() { renderApp("/settings?tab=intelligence"); return screen.findByRole("row", { name: "Standard" }); }
function saved(operation: string, changes: Partial<IntelligenceProfile> = {}) {
  return { operation_id: operation, disposition: "saved", revision: "13", active_digest: "b".repeat(64), profile: { ...profile, ...changes, version: 2 }, updated_projects: [{ id: "p", name: "Example", revision: "2" }] };
}

test("provider dropdown changes the spreadsheet columns while preserving the other provider mapping", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data)), http.post("/api/settings/intelligence", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    const changes = { name: submitted.name as string, candidates: submitted.candidates as Candidate[] };
    data = { ...data, revision: "13", profiles: [{ ...data.profiles[0]!, ...changes, version: 2 }] };
    return HttpResponse.json(saved(submitted.operation_id as string, changes));
  }));
  const row = await open(); expect(within(row).getByLabelText("Model")).toHaveValue("anthropic:configured-model");
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "openai");
  expect(within(row).getByLabelText("Model")).toHaveValue("openai:configured-codex");
  await userEvent.selectOptions(within(row).getByLabelText("Reasoning effort"), "medium@1:codex");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  await within(row).findByText("Saved.");
  expect(submitted).toMatchObject({ expected_revision: "12", profile_id: "standard", profile_version: 1,
    candidates: [anthropic, { ...openai, reasoning_configuration_reference: "medium@1" }] });
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "anthropic");
  expect(within(row).getByLabelText("Model")).toHaveValue("anthropic:configured-model");
});

test("add row creates and saves a new profile in the same table", async () => {
  read(); let submitted: Record<string, unknown> | undefined;
  server.use(http.post("/api/settings/intelligence", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    return HttpResponse.json(saved(submitted.operation_id as string, { id: submitted.profile_id as string, name: "Research", candidates: [], version: 1 }));
  }));
  await open(); await userEvent.click(screen.getByRole("button", { name: "Add row" }));
  const row = screen.getByRole("row", { name: "new profile" });
  await userEvent.type(within(row).getByLabelText("Profile name"), "Research");
  await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  await userEvent.click(within(row).getByRole("button", { name: "Save Research" }));
  await waitFor(() => expect(submitted).toBeDefined());
  expect(submitted).toMatchObject({ profile_version: 0, name: "Research", candidates: [expect.objectContaining({ provider: "anthropic", model: "configured-model" })] });
  expect(submitted?.profile_id).toMatch(/^profile-/);
});

test("a conflicting row save preserves its edits and cannot overwrite newer settings", async () => {
  read(); server.use(http.post("/api/settings/intelligence", () => HttpResponse.json({ request_id: "conflict", code: "conflict", message: "Profiles changed.", retryable: false }, { status: 409 })));
  const row = await open(); await userEvent.type(within(row).getByLabelText("Profile name"), " revised");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard revised" })); await screen.findByRole("alert");
  expect(within(row).getByLabelText("Profile name")).toHaveValue("Standard revised"); expect(within(row).getByRole("button", { name: "Save Standard revised" })).toBeDisabled();
});

test("interrupted row saves reconcile without resending", async () => {
  read(); let posts = 0; let body: { operation_id: string; name: string };
  server.use(http.post("/api/settings/intelligence", async ({ request }) => { body = await request.json() as typeof body; posts++; return HttpResponse.error(); }),
    http.get("/api/settings/intelligence/operations/:id", ({ params }) => HttpResponse.json(saved(String(params.id), { name: body.name }))));
  const row = await open(); await userEvent.type(within(row).getByLabelText("Description"), " revised"); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" })); await screen.findByText("Saved."); expect(posts).toBe(1);
});

test("an unrecorded interrupted row save retries its exact request", async () => {
  read(); const requests: { operation_id: string }[] = [];
  server.use(http.post("/api/settings/intelligence", async ({ request }) => { const body = await request.json() as { operation_id: string }; requests.push(body); return requests.length === 1 ? HttpResponse.error() : HttpResponse.json(saved(body.operation_id)); }),
    http.get("/api/settings/intelligence/operations/:id", () => HttpResponse.json({}, { status: 404 })));
  const row = await open(); await userEvent.type(within(row).getByLabelText("Description"), " revised"); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" })); await userEvent.click(await screen.findByRole("button", { name: "Retry same save" }));
  await screen.findByText("Saved."); expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
});

test("settings sections are keyboard-accessible tabs and profile drafts survive tab changes", async () => {
  read(); const { router } = renderApp("/settings");
  expect(await screen.findByRole("tab", { name: "Identity", selected: true })).toBeVisible();
  await userEvent.click(screen.getByRole("tab", { name: "Intelligence" })); const row = await screen.findByRole("row", { name: "Standard" });
  await userEvent.type(within(row).getByLabelText("Profile name"), " draft");
  await userEvent.click(screen.getByRole("tab", { name: "Display" })); await screen.findByRole("region", { name: "Display" });
  await userEvent.click(screen.getByRole("tab", { name: "Intelligence" })); expect(within(row).getByLabelText("Profile name")).toHaveValue("Standard draft");
  expect(router.state.location.search).toContain("tab=intelligence");
});

test("an unconfigured provider still permits adding empty profile rows", async () => {
  read(); await open(); await userEvent.selectOptions(screen.getByLabelText("Provider"), "google");
  expect(await screen.findByText(/No Google models are configured yet/)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Add row" })); const row = screen.getByRole("row", { name: "new profile" });
  expect(within(row).getByLabelText("Model")).toBeDisabled(); expect(within(row).getByLabelText("Profile name")).toBeEnabled();
});

test("imported provider defaults display exact effort and preserve service options without implying launch readiness", async () => {
  const data = snapshot();
  data.model_choices = data.model_choices.map(c => ({ ...c, preference_only: true, options: { service_tier: "fast" } }));
  read(data); const row = await open();
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "openai");
  expect(within(row).getByLabelText("Reasoning effort")).toHaveValue("high@1:codex");
  expect(screen.getByText(/Imported defaults are saved preferences/)).toBeVisible();
});
