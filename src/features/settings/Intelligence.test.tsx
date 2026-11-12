import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import type { Candidate, IntelligenceProfile } from "../../api/intelligenceSettings";
import { IntelligenceGroups } from "./IntelligenceGroups";

const anthropic: Candidate = { id: "anthropic-choice", provider: "anthropic", model: "configured-model", reasoning_configuration_reference: "balanced@1", harnesses: ["claude"] };
const openai: Candidate = { id: "openai-choice", provider: "openai", model: "configured-codex", reasoning_configuration_reference: "high@1", harnesses: ["codex"] };
const profile: IntelligenceProfile = { id: "standard", version: 1, name: "Standard", description: "Everyday work", candidates: [anthropic, openai], projects: [{ id: "p", name: "Example", enabled: true }] };
function snapshot() { return { revision: "12", active_digest: "a".repeat(64), profiles: [structuredClone(profile)], model_choices: [
  { ...anthropic, harness: "claude", reasoning: "balanced" },
  { ...openai, harness: "codex", reasoning: "high" },
  { ...openai, harness: "codex", reasoning: "medium", reasoning_configuration_reference: "medium@1" },
] }; }
const server = setupServer(...handlersFor("default"));
beforeEach(() => server.use(http.get("/api/settings/swarm", () => HttpResponse.json(limitsSnapshot())), http.get("/api/settings/intelligence/structure", () => HttpResponse.json({}, { status: 503 }))));
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
  await userEvent.click(screen.getByText("Model catalog", { exact: true }));
  expect(screen.getByText(/Imported defaults are saved preferences/)).toBeVisible();
});

test("saved rows require confirmation before deletion and return focus to Add row", async () => {
  let data = snapshot(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data)), http.post("/api/settings/intelligence", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>; data = { ...data, profiles: [], revision: "13" };
    return HttpResponse.json({ ...saved(submitted.operation_id as string), disposition: "deleted", profile });
  }));
  const row = await open(); await userEvent.click(within(row).getByRole("button", { name: "Delete Standard" }));
  expect(submitted).toBeUndefined(); expect(screen.getByText('Delete “Standard” for all providers?')).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(within(row).getByRole("button", { name: "Delete Standard" })).toHaveFocus(); expect(submitted).toBeUndefined();
  await userEvent.click(within(row).getByRole("button", { name: "Delete Standard" })); await userEvent.click(screen.getByRole("button", { name: "Confirm delete Standard" }));
  await screen.findByText('Deleted “Standard”.'); expect(screen.queryByRole("row", { name: "Standard" })).not.toBeInTheDocument();
  expect(submitted).toMatchObject({ delete: true, expected_revision: "12", profile_id: "standard", profile_version: 1 });
  expect(screen.getByRole("button", { name: "Add row" })).toHaveFocus();
});

test("a stale deletion preserves the row and its unsaved edits", async () => {
  read(); server.use(http.post("/api/settings/intelligence", () => HttpResponse.json({ error: "conflict", message: "Profiles changed since this editor opened." }, { status: 409 })));
  const row = await open(); await userEvent.type(within(row).getByLabelText("Profile name"), " draft");
  await userEvent.click(within(row).getByRole("button", { name: "Delete Standard draft" })); await userEvent.click(screen.getByRole("button", { name: "Confirm delete Standard draft" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profiles changed"); expect(within(row).getByLabelText("Profile name")).toHaveValue("Standard draft");
  expect(within(row).getByRole("button", { name: "Save Standard draft" })).toBeEnabled();
});

test("unsaved rows can be deleted locally", async () => {
  read(); let posts = 0; server.use(http.post("/api/settings/intelligence", () => { posts++; return HttpResponse.error(); }));
  await open(); await userEvent.click(screen.getByRole("button", { name: "Add row" }));
  await userEvent.click(screen.getByRole("button", { name: "Delete new profile" })); expect(screen.queryByRole("row", { name: "new profile" })).not.toBeInTheDocument(); expect(posts).toBe(0);
});

test("an interrupted deletion reconciles its original operation without sending another deletion", async () => {
  let data = snapshot(); let posts = 0;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data)), http.post("/api/settings/intelligence", () => { posts++; return HttpResponse.error(); }),
    http.get("/api/settings/intelligence/operations/:id", ({ params }) => { data = { ...data, profiles: [], revision: "13" }; return HttpResponse.json({ ...saved(String(params.id)), disposition: "deleted", profile }); }));
  const row = await open(); await userEvent.click(within(row).getByRole("button", { name: "Delete Standard" })); await userEvent.click(screen.getByRole("button", { name: "Confirm delete Standard" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check delete status" })); await screen.findByText('Deleted “Standard”.'); expect(posts).toBe(1);
});


test("deleting an assigned row succeeds and reports automatic routing", async () => {
  let data = snapshot();
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(data)), http.post("/api/settings/intelligence", async ({ request }) => {
    const body = await request.json() as { operation_id: string }; data = { ...data, revision: "13", profiles: [] };
    return HttpResponse.json({ ...saved(body.operation_id), disposition: "deleted", profile,
      routing: { mode: "automatic", profile_reference: "router@1", agent_profiles: ["implementer"] } });
  }));
  const row = await open(); await userEvent.click(within(row).getByRole("button", { name: "Delete Standard" }));
  expect(screen.getByText("Affected work will return to the router.")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Confirm delete Standard" }));
  expect(await screen.findByText(/Deleted “Standard”. Affected work will use the router/)).toBeVisible();
  expect(screen.queryByRole("row", { name: "Standard" })).not.toBeInTheDocument();
});

function limitsSnapshot(limit: number | null = 2) {
  return { revision: "12", catalog_revision: "2", active_mode: "normal", normal: [], reduced: null, unclassified: [], provider_limits: [],
    cell_limits: [{ provider: "anthropic", intelligence_class: "standard", limit }],
    cells: [{ provider: "anthropic", intelligence_class: "standard", display_name: "Standard", normal_limit: null, reduced_limit: null, effective_limit: limit, running: 1, waiting: 0 }] };
}

test.each(["0", ""])("the added max agents column saves %j using the existing row Save without writing an unchanged profile", async value => {
  read(); let data = limitsSnapshot(); let submitted: Record<string, unknown> | undefined; let profilePosts = 0;
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data)), http.post("/api/settings/swarm/limits", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>; data = { ...limitsSnapshot(value === "" ? null : Number(value)), revision: "13" }; return HttpResponse.json(data);
  }), http.post("/api/settings/intelligence", () => { profilePosts++; return HttpResponse.error(); }));
  const row = await open(); const input = within(row).getByRole("spinbutton", { name: "Max agents for Standard" });
  await waitFor(() => expect(input).toHaveValue(2));
  await userEvent.clear(input); if (value) await userEvent.type(input, value);
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  await within(row).findByText("Saved.");
  expect(submitted).toMatchObject({ expected_revision: "12", expected_catalog_revision: "2", cell: { provider: "anthropic", intelligence_class: "standard", limit: value === "" ? null : 0 } });
  expect(profilePosts).toBe(0); expect(within(row).getByLabelText("Description")).toHaveValue("Everyday work");
  expect(within(row).getByRole("button", { name: "Save Standard" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
  expect(screen.getAllByRole("columnheader")).toHaveLength(6);
});

test("an interrupted max agents save checks its operation before unlocking the provider", async () => {
  read(); let data = limitsSnapshot(); let posts = 0;
  server.use(http.get("/api/settings/swarm", () => HttpResponse.json(data)), http.post("/api/settings/swarm/limits", () => { posts++; return HttpResponse.error(); }),
    http.get("/api/settings/swarm/operations/:id", () => { data = { ...limitsSnapshot(0), revision: "13" }; return HttpResponse.json(data); }));
  const row = await open(); const input = within(row).getByRole("spinbutton", { name: "Max agents for Standard" });
  await waitFor(() => expect(input).toHaveValue(2)); await userEvent.clear(input); await userEvent.type(input, "0");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  const check = await screen.findByRole("button", { name: "Check save status" }); expect(screen.getByLabelText("Provider")).toBeDisabled();
  await userEvent.click(check); await within(row).findByText("Saved.");
  expect(screen.getByLabelText("Provider")).toBeEnabled(); expect(input).toHaveValue(0); expect(posts).toBe(1);
});

test("a conflicting cap update preserves the cap draft and profile editing", async () => {
  read(); server.use(http.post("/api/settings/swarm/limits", () => HttpResponse.json({ error: "conflict", message: "Limits changed. Try again after refresh." }, { status: 409 })));
  const row = await open(); const input = within(row).getByRole("spinbutton", { name: "Max agents for Standard" });
  await waitFor(() => expect(input).toHaveValue(2)); await userEvent.clear(input); await userEvent.type(input, "3");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Limits changed"); expect(input).toHaveValue(3);
  expect(screen.getByLabelText("Provider")).toBeEnabled(); expect(within(row).getByLabelText("Description")).toBeEnabled();
});

test("the selected provider cannot edit an absent class catalog pair", async () => {
  read(); const row = await open(); await userEvent.selectOptions(screen.getByLabelText("Provider"), "openai");
  expect(within(row).getByRole("spinbutton", { name: "Max agents for Standard" })).toBeDisabled();
  expect(within(row).getByText("Unavailable")).toBeVisible();
});

async function editProfileAndCap() {
  const row = await open(); const input = within(row).getByRole("spinbutton", { name: "Max agents for Standard" });
  await waitFor(() => expect(input).toHaveValue(2));
  await userEvent.type(within(row).getByLabelText("Description"), " revised");
  await userEvent.clear(input); await userEvent.type(input, "3");
  return { row, input };
}

test("one Save confirms profile first and then cap with the refreshed catalog and original limits revision", async () => {
  let profiles = snapshot(); let limits = limitsSnapshot(); const order: string[] = []; let cap: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; description: string }; order.push("profile");
      profiles = { ...profiles, revision: "13", profiles: [{ ...profile, description: body.description, version: 2 }] };
      limits = { ...limits, catalog_revision: "3" }; return HttpResponse.json(saved(body.operation_id, { description: body.description }));
    }), http.post("/api/settings/swarm/limits", async ({ request }) => { order.push("cap"); cap = await request.json() as Record<string, unknown>;
      limits = { ...limitsSnapshot(3), revision: "13", catalog_revision: "3" }; return HttpResponse.json(limits); }));
  const { row, input } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  await within(row).findByText("Saved."); await waitFor(() => expect(within(row).getByRole("button", { name: "Save Standard" })).toBeDisabled());
  expect(order).toEqual(["profile", "cap"]); expect(cap).toMatchObject({ expected_revision: "12", expected_catalog_revision: "3", cell: { provider: "anthropic", intelligence_class: "standard", limit: 3 } });
  expect(input).toHaveValue(3); expect(within(row).getByLabelText("Description")).toHaveValue("Everyday work revised");
});

test("a failed profile save preserves both drafts and never writes the cap", async () => {
  read(); let capPosts = 0;
  server.use(http.post("/api/settings/intelligence", () => HttpResponse.json({ error: "conflict", message: "Profile changed." }, { status: 409 })),
    http.post("/api/settings/swarm/limits", () => { capPosts++; return HttpResponse.error(); }));
  const { row, input } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profile changed"); expect(capPosts).toBe(0);
  expect(input).toHaveValue(3); expect(within(row).getByLabelText("Description")).toHaveValue("Everyday work revised");
});

test("partial cap failure reports the confirmed profile and retries only the unsaved cap", async () => {
  let profiles = snapshot(); let limits = limitsSnapshot(); let profilePosts = 0; let capPosts = 0;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", async ({ request }) => { const body = await request.json() as { operation_id: string; description: string }; profilePosts++;
      profiles = { ...profiles, revision: "13", profiles: [{ ...profile, description: body.description, version: 2 }] };
      limits = { ...limits, catalog_revision: "3" }; return HttpResponse.json(saved(body.operation_id, { description: body.description })); }),
    http.post("/api/settings/swarm/limits", () => { capPosts++; if (capPosts === 1) return HttpResponse.json({ error: "invalid", message: "Limit rejected." }, { status: 422 });
      limits = { ...limitsSnapshot(3), revision: "13", catalog_revision: "3" }; return HttpResponse.json(limits); }));
  const { row, input } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profile saved. Max agents were not saved. Limit rejected."); expect(input).toHaveValue(3);
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" })); await within(row).findByText("Saved.");
  expect(profilePosts).toBe(1); expect(capPosts).toBe(2); expect(input).toHaveValue(3);
});

test("an uncertain combined profile phase is reconciled before sending its captured cap", async () => {
  let profiles = snapshot(); let limits = limitsSnapshot(); let profilePosts = 0; let capPosts = 0;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", () => { profilePosts++; return HttpResponse.error(); }),
    http.get("/api/settings/intelligence/operations/:id", ({ params }) => {
      profiles = { ...profiles, revision: "13", profiles: [{ ...profile, description: "Everyday work revised", version: 2 }] };
      limits = { ...limits, catalog_revision: "3" }; return HttpResponse.json(saved(String(params.id), { description: "Everyday work revised" })); }),
    http.post("/api/settings/swarm/limits", () => { capPosts++; limits = { ...limitsSnapshot(3), revision: "13", catalog_revision: "3" }; return HttpResponse.json(limits); }));
  const { row } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  const check = await screen.findByRole("button", { name: "Check save status" }); expect(capPosts).toBe(0); expect(screen.getByLabelText("Provider")).toBeDisabled();
  await userEvent.click(check); await within(row).findByText("Saved."); await waitFor(() => expect(capPosts).toBe(1)); expect(profilePosts).toBe(1);
});

test("an uncertain cap phase retries its exact request without resaving the confirmed profile", async () => {
  let profiles = snapshot(); let limits = limitsSnapshot(); let profilePosts = 0; const caps: Record<string, unknown>[] = [];
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", async ({ request }) => { const body = await request.json() as { operation_id: string }; profilePosts++;
      profiles = { ...profiles, revision: "13", profiles: [{ ...profile, description: "Everyday work revised", version: 2 }] }; return HttpResponse.json(saved(body.operation_id, { description: "Everyday work revised" })); }),
    http.post("/api/settings/swarm/limits", async ({ request }) => { caps.push(await request.json() as Record<string, unknown>); if (caps.length === 1) return HttpResponse.error();
      limits = { ...limitsSnapshot(3), revision: "13" }; return HttpResponse.json(limits); }),
    http.get("/api/settings/swarm/operations/:id", () => HttpResponse.json({}, { status: 404 })));
  const { row } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profile saved. Max agents save unconfirmed");
  await userEvent.click(screen.getByRole("button", { name: "Check save status" })); await userEvent.click(await screen.findByRole("button", { name: "Retry same save" }));
  await within(row).findByText("Saved."); expect(caps).toHaveLength(2); expect(caps[0]).toEqual(caps[1]); expect(profilePosts).toBe(1);
});

test("a new row can create its configured profile and cap with one Save", async () => {
  let profiles = snapshot(); let limits: ReturnType<typeof limitsSnapshot> = limitsSnapshot(); let cap: Record<string, unknown> | undefined; let createdId = "";
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; profile_id: string; name: string; candidates: Candidate[] }; createdId = body.profile_id;
      const created = { ...profile, id: createdId, name: body.name, candidates: body.candidates };
      profiles = { ...profiles, revision: "13", profiles: [...profiles.profiles, created] };
      limits = { ...limits, catalog_revision: "3", cells: [...limits.cells, { ...limits.cells[0]!, intelligence_class: createdId, display_name: body.name, effective_limit: null }] };
      return HttpResponse.json(saved(body.operation_id, created));
    }), http.post("/api/settings/swarm/limits", async ({ request }) => { cap = await request.json() as Record<string, unknown>;
      limits = { ...limits, revision: "13", cell_limits: [...limits.cell_limits, { provider: "anthropic", intelligence_class: createdId, limit: 4 }], cells: limits.cells.map(c => c.intelligence_class === createdId ? { ...c, effective_limit: 4 } : c) }; return HttpResponse.json(limits); }));
  await open(); await userEvent.click(screen.getByRole("button", { name: "Add row" })); const row = screen.getByRole("row", { name: "new profile" });
  await userEvent.type(within(row).getByLabelText("Profile name"), "Research");
  await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  const input = within(row).getByRole("spinbutton"); expect(input).toBeEnabled(); await userEvent.type(input, "4");
  await userEvent.click(within(row).getByRole("button", { name: "Save Research" })); await within(row).findByText("Saved.");
  expect(cap).toMatchObject({ expected_revision: "12", expected_catalog_revision: "3", cell: { provider: "anthropic", intelligence_class: createdId, limit: 4 } });
});

test("a concurrent cap revision after profile confirmation is rejected without replacing its expected revision", async () => {
  let profiles = snapshot(); let limits = limitsSnapshot(); let cap: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/swarm", () => HttpResponse.json(limits)),
    http.post("/api/settings/intelligence", async ({ request }) => { const body = await request.json() as { operation_id: string };
      profiles = { ...profiles, revision: "13", profiles: [{ ...profile, version: 2, description: "Everyday work revised" }] };
      limits = { ...limitsSnapshot(1), revision: "13", catalog_revision: "3" }; return HttpResponse.json(saved(body.operation_id, { description: "Everyday work revised" })); }),
    http.post("/api/settings/swarm/limits", async ({ request }) => { cap = await request.json() as Record<string, unknown>;
      return HttpResponse.json({ error: "conflict", message: "Limits changed." }, { status: 409 }); }));
  const { row, input } = await editProfileAndCap(); await userEvent.click(within(row).getByRole("button", { name: "Save Standard" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profile saved. Max agents were not saved. Limits changed.");
  expect(cap).toMatchObject({ expected_revision: "12", expected_catalog_revision: "3" }); expect(input).toHaveValue(3);
});


test("grouping uses explicit assignments and retains unmatched profiles without guessing from their names", async () => {
  const mapped = { ...profile, id: "standard-low", name: "Imported Standard" };
  const retained = ["routing-sol-low", "supervisor-medium", "fast-off", "custom-high"].map(id => ({ ...profile, id, name: id }));
  render(<IntelligenceGroups profiles={[mapped, ...retained]} assignments={[{ profile_id: mapped.id, parent_id: "standard", effort: "low" }]}
    renderParent={parent => <h3>{parent}</h3>} renderRow={(item, variation) => <tr key={item.id}><td>{variation}</td><td colSpan={3}>{item.id}</td></tr>}
    otherTable={items => <ul>{items.map(item => <li key={item.id}>{item.id}</li>)}</ul>} />);
  expect(screen.getByRole("region", { name: "Standard variations, scroll horizontally", hidden: true })).toBeInTheDocument();
  await userEvent.click(screen.getByText("Standard variations"));
  expect(screen.getByRole("row", { name: "Low standard-low" })).toBeVisible();
  expect(screen.getByRole("row", { name: "Standard Medium not configured" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Other profiles" })).toBeVisible();
  for (const item of retained) expect(screen.getByText(item.id)).toBeVisible();
});

function structureSnapshot() {
  return { revision: "2", catalog_revision: "12", routing_markdown: "# Routing\nUse Standard for everyday work.",
    parents: ["simple", "standard", "complex", "deep"].map(id => ({ id, description: `${id} tasks` })),
    assignments: [{ profile_id: "standard", parent_id: "standard", effort: "low" }] };
}
function readStructure(data = structureSnapshot()) { server.use(http.get("/api/settings/intelligence/structure", () => HttpResponse.json(data))); }

test("four parent types show one description each and child model, reasoning and limits keep their current mappings", async () => {
  read(); readStructure(); renderApp("/settings?tab=intelligence");
  for (const name of ["Simple", "Standard", "Complex", "Deep"]) expect(await screen.findByLabelText(`${name} description`)).toBeVisible();
  await userEvent.click(screen.getByText("Standard variations"));
  const row = screen.getByRole("row", { name: "Standard" });
  expect(within(row).getByText("Low", { exact: true })).toBeVisible();
  expect(within(row).queryByLabelText("Profile name")).not.toBeInTheDocument();
  expect(within(row).queryByLabelText("Description")).not.toBeInTheDocument();
  expect(within(row).getByLabelText("Model")).toHaveValue("anthropic:configured-model");
  await userEvent.selectOptions(screen.getByLabelText("Provider"), "openai");
  expect(within(row).getByLabelText("Model")).toHaveValue("openai:configured-codex");
  expect(within(row).getByLabelText("Reasoning effort")).toHaveValue("high@1:codex");
  expect(screen.getByLabelText("Markdown")).toHaveValue(structureSnapshot().routing_markdown);
});

test("saving a parent description preserves policy, assignments, other descriptions and runtime profiles", async () => {
  read(); let data = structureSnapshot(); let submitted: Record<string, unknown> | undefined; let profilePosts = 0;
  server.use(http.get("/api/settings/intelligence/structure", () => HttpResponse.json(data)), http.post("/api/settings/intelligence/structure", async ({ request }) => {
    submitted = await request.json() as Record<string, unknown>;
    data = { ...data, revision: "3", parents: submitted.parents as typeof data.parents };
    return HttpResponse.json({ ...data, operation_id: submitted.operation_id, disposition: "saved" });
  }), http.post("/api/settings/intelligence", () => { profilePosts++; return HttpResponse.error(); }));
  renderApp("/settings?tab=intelligence"); const input = await screen.findByLabelText("Standard description");
  await userEvent.clear(input); await userEvent.type(input, "Everyday engineering");
  await userEvent.click(screen.getByRole("button", { name: "Save Standard description" })); await screen.findByText("Saved.");
  expect(submitted).toMatchObject({ expected_revision: "2", expected_catalog_revision: "12", routing_markdown: structureSnapshot().routing_markdown, assignments: structureSnapshot().assignments,
    parents: [{ id: "simple", description: "simple tasks" }, { id: "standard", description: "Everyday engineering" }, { id: "complex", description: "complex tasks" }, { id: "deep", description: "deep tasks" }] });
  expect(profilePosts).toBe(0);
});

test("a conflicting parent description retains its draft and original revision until reset", async () => {
  read(); let data = structureSnapshot();
  server.use(http.get("/api/settings/intelligence/structure", () => HttpResponse.json(data)), http.post("/api/settings/intelligence/structure", () => {
    data = { ...data, revision: "3", parents: data.parents.map(parent => parent.id === "standard" ? { ...parent, description: "Someone else's description" } : parent) };
    return HttpResponse.json({ error: "conflict", message: "Settings changed." }, { status: 409 });
  }));
  renderApp("/settings?tab=intelligence"); const input = await screen.findByLabelText("Standard description");
  await userEvent.type(input, " revised"); await userEvent.click(screen.getByRole("button", { name: "Save Standard description" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Settings changed.");
  expect(input).toHaveValue("standard tasks revised"); expect(screen.getByRole("button", { name: "Save Standard description" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Reset Standard description" }));
  await waitFor(() => expect(input).toHaveValue("Someone else's description"));
});

test("an interrupted parent save inspects and retries the identical metadata request", async () => {
  read(); readStructure(); const requests: Record<string, unknown>[] = [];
  server.use(http.post("/api/settings/intelligence/structure", async ({ request }) => {
    const body = await request.json() as Record<string, unknown>; requests.push(body);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ ...structureSnapshot(), parents: body.parents, revision: "3", operation_id: body.operation_id, disposition: "saved" });
  }), http.get("/api/settings/intelligence/structure/operations/:id", () => HttpResponse.json({}, { status: 404 })));
  renderApp("/settings?tab=intelligence"); await userEvent.type(await screen.findByLabelText("Standard description"), " revised");
  await userEvent.click(screen.getByRole("button", { name: "Save Standard description" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same save" })); await screen.findByText("Saved.");
  expect(requests).toHaveLength(2); expect(requests[0]).toEqual(requests[1]);
});

test("a missing variation saves its profile before assigning it under the captured structure revision", async () => {
  let profiles = snapshot(); let metadata = structureSnapshot(); const order: string[] = []; let assigned: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/intelligence/structure", () => HttpResponse.json(metadata)),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; profile_id: string; name: string; candidates: Candidate[] }; order.push("profile");
      const created = { ...profile, id: body.profile_id, name: body.name, description: "", candidates: body.candidates, projects: [] };
      profiles = { ...profiles, revision: "13", profiles: [...profiles.profiles, created] };
      return HttpResponse.json(saved(body.operation_id, created));
    }), http.post("/api/settings/intelligence/structure", async ({ request }) => {
      assigned = await request.json() as Record<string, unknown>; order.push("assignment");
      metadata = { ...metadata, revision: "3", catalog_revision: "13", assignments: assigned.assignments as typeof metadata.assignments };
      return HttpResponse.json({ ...metadata, operation_id: assigned.operation_id, disposition: "saved" });
    }));
  renderApp("/settings?tab=intelligence"); await screen.findByLabelText("Standard description"); await userEvent.click(screen.getByText("Standard variations"));
  await userEvent.click(screen.getByRole("button", { name: "Add variation: Standard Medium" }));
  const row = screen.getByRole("row", { name: "Standard Medium" }); await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard Medium" }));
  await waitFor(() => expect(order).toEqual(["profile", "assignment"]));
  expect(assigned).toMatchObject({ expected_revision: "2", expected_catalog_revision: "13", assignments: [...structureSnapshot().assignments, { profile_id: expect.stringMatching(/^profile-/), parent_id: "standard", effort: "medium" }] });
  expect(screen.queryByText("Profile saved. The variation assignment must also be confirmed.")).not.toBeInTheDocument();
});

test("deleting and readding a variation uses a fresh profile identity and replaces the retired assignment", async () => {
  let profiles = snapshot(); let metadata = structureSnapshot(); let replacementId = ""; let assignment: Record<string, unknown> | undefined;
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/intelligence/structure", () => HttpResponse.json(metadata)),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; profile_id: string; name: string; candidates: Candidate[]; delete?: boolean };
      if (body.delete) { profiles = { ...profiles, revision: "13", profiles: [] }; return HttpResponse.json({ ...saved(body.operation_id), disposition: "deleted" }); }
      replacementId = body.profile_id; const created = { ...profile, id: body.profile_id, name: body.name, candidates: body.candidates, projects: [] };
      profiles = { ...profiles, revision: "14", profiles: [created] }; return HttpResponse.json({ ...saved(body.operation_id, created), revision: "14" });
    }), http.post("/api/settings/intelligence/structure", async ({ request }) => {
      assignment = await request.json() as Record<string, unknown>;
      metadata = { ...metadata, revision: "3", catalog_revision: "14", assignments: assignment.assignments as typeof metadata.assignments };
      return HttpResponse.json({ ...metadata, operation_id: assignment.operation_id, disposition: "saved" });
    }));
  renderApp("/settings?tab=intelligence"); await screen.findByLabelText("Standard description"); await userEvent.click(screen.getByText("Standard variations"));
  await userEvent.click(screen.getByRole("button", { name: "Delete Standard" })); await userEvent.click(screen.getByRole("button", { name: "Confirm delete Standard" }));
  await userEvent.click(await screen.findByRole("button", { name: "Add variation: Standard Low" }));
  const row = screen.getByRole("row", { name: "Standard Low" }); await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard Low" }));
  await waitFor(() => expect(assignment).toBeDefined());
  expect(replacementId).toMatch(/^profile-/); expect(replacementId).not.toBe(profile.id);
  expect(assignment).toMatchObject({ expected_revision: "2", expected_catalog_revision: "14", assignments: [{ profile_id: replacementId, parent_id: "standard", effort: "low" }] });
});

test("a partially saved new variation can reload and save only its assignment without replacing concurrent metadata", async () => {
  let profiles = snapshot(); let metadata = structureSnapshot(); let profilePosts = 0; const assignments: Record<string, unknown>[] = [];
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/intelligence/structure", () => HttpResponse.json(metadata)),
    http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; profile_id: string; name: string; candidates: Candidate[] }; profilePosts++;
      const created = { ...profile, id: body.profile_id, name: body.name, candidates: body.candidates, projects: [] };
      profiles = { ...profiles, revision: "13", profiles: [...profiles.profiles, created] }; return HttpResponse.json(saved(body.operation_id, created));
    }), http.post("/api/settings/intelligence/structure", async ({ request }) => {
      const body = await request.json() as Record<string, unknown>; assignments.push(body);
      if (assignments.length === 1) { metadata = { ...metadata, revision: "4", catalog_revision: "13", routing_markdown: "Concurrent policy" }; return HttpResponse.json({ error: "conflict", message: "Settings changed." }, { status: 409 }); }
      metadata = { ...metadata, revision: "5", assignments: body.assignments as typeof metadata.assignments };
      return HttpResponse.json({ ...metadata, operation_id: body.operation_id, disposition: "saved" });
    }));
  renderApp("/settings?tab=intelligence"); await screen.findByLabelText("Standard description"); await userEvent.click(screen.getByText("Standard variations"));
  await userEvent.click(screen.getByRole("button", { name: "Add variation: Standard Medium" }));
  const row = screen.getByRole("row", { name: "Standard Medium" }); await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard Medium" }));
  const retryAssignment = await screen.findByRole("button", { name: "Reload and save assignment" });
  expect(within(row).getByLabelText("Model")).toBeDisabled();
  await userEvent.click(retryAssignment);
  await waitFor(() => expect(assignments).toHaveLength(2)); expect(profilePosts).toBe(1);
  expect(assignments[1]).toMatchObject({ expected_revision: "4", expected_catalog_revision: "13", routing_markdown: "Concurrent policy" });
});

test("a new variation retains a failed cap draft and assigns only after the cap retry confirms", async () => {
  let profiles = snapshot(); let metadata = structureSnapshot(); let limits = limitsSnapshot(); let profilePosts = 0; let capPosts = 0; let assignmentPosts = 0; let createdId = "";
  server.use(http.get("/api/settings/intelligence", () => HttpResponse.json(profiles)), http.get("/api/settings/intelligence/structure", () => HttpResponse.json(metadata)),
    http.get("/api/settings/swarm", () => HttpResponse.json(limits)), http.post("/api/settings/intelligence", async ({ request }) => {
      const body = await request.json() as { operation_id: string; profile_id: string; name: string; candidates: Candidate[] }; profilePosts++; createdId = body.profile_id;
      const created = { ...profile, id: createdId, name: body.name, candidates: body.candidates, projects: [] };
      profiles = { ...profiles, revision: "13", profiles: [...profiles.profiles, created] };
      limits = { ...limits, catalog_revision: "3", cells: [...limits.cells, { ...limits.cells[0]!, intelligence_class: createdId, display_name: body.name, effective_limit: null }] };
      return HttpResponse.json(saved(body.operation_id, created));
    }), http.post("/api/settings/swarm/limits", () => {
      capPosts++; if (capPosts === 1) return HttpResponse.json({ error: "invalid", message: "Limit rejected." }, { status: 422 });
      limits = { ...limits, revision: "13", cell_limits: [...limits.cell_limits, { provider: "anthropic", intelligence_class: createdId, limit: 3 }], cells: limits.cells.map(cell => cell.intelligence_class === createdId ? { ...cell, effective_limit: 3 } : cell) }; return HttpResponse.json(limits);
    }), http.post("/api/settings/intelligence/structure", async ({ request }) => {
      const body = await request.json() as Record<string, unknown>; assignmentPosts++;
      metadata = { ...metadata, revision: "3", catalog_revision: "13", assignments: body.assignments as typeof metadata.assignments };
      return HttpResponse.json({ ...metadata, operation_id: body.operation_id, disposition: "saved" });
    }));
  renderApp("/settings?tab=intelligence"); await screen.findByLabelText("Standard description"); await userEvent.click(screen.getByText("Standard variations"));
  await userEvent.click(screen.getByRole("button", { name: "Add variation: Standard Medium" }));
  const row = screen.getByRole("row", { name: "Standard Medium" }); await userEvent.selectOptions(within(row).getByLabelText("Model"), "anthropic:configured-model");
  await userEvent.type(within(row).getByRole("spinbutton"), "3"); await userEvent.click(within(row).getByRole("button", { name: "Save Standard Medium" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Profile saved. Max agents were not saved. Limit rejected.");
  expect(within(row).getByRole("spinbutton")).toHaveValue(3); expect(assignmentPosts).toBe(0);
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard Medium" }));
  await waitFor(() => expect(assignmentPosts).toBe(1)); expect(profilePosts).toBe(1); expect(capPosts).toBe(2);
});


test("editing the first provider preserves candidate preference order", async () => {
  const data = snapshot();
  data.model_choices.push({ ...anthropic, harness: "claude", reasoning: "low", reasoning_configuration_reference: "low@1" });
  read(data); let submitted: { candidates: Candidate[] } | undefined;
  server.use(http.post("/api/settings/intelligence", async ({ request }) => {
    const body = await request.json() as { operation_id: string; candidates: Candidate[] }; submitted = body;
    return HttpResponse.json(saved(body.operation_id, { candidates: body.candidates }));
  }));
  const row = await open(); await userEvent.selectOptions(within(row).getByLabelText("Reasoning effort"), "low@1:claude");
  await userEvent.click(within(row).getByRole("button", { name: "Save Standard" })); await within(row).findByText("Saved.");
  expect(submitted?.candidates).toEqual([{ ...anthropic, reasoning_configuration_reference: "low@1" }, openai]);
});
