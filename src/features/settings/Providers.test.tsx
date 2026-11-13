import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import type { ProviderSettings, SaveProviders } from "../../api/providerSettings";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
const initial = (): ProviderSettings => ({ revision: "4", available_revision: "a".repeat(64), providers: ["anthropic"], available: [
  { id: "anthropic", name: "Anthropic", accounts: ["Team"], credential_status: "present" },
  { id: "openai", name: "OpenAI", accounts: ["Work"], credential_status: "missing" },
] });
function fixture() {
  let data = initial(); const posts: SaveProviders[] = [];
  server.use(http.get("/api/settings/providers", () => HttpResponse.json(data)), http.post("/api/settings/providers", async ({ request }) => {
    const body = await request.json() as SaveProviders; posts.push(body); data = { ...data, revision: String(Number(data.revision) + 1), providers: body.providers };
    return HttpResponse.json({ ...data, operation_id: body.operation_id });
  }));
  return posts;
}
async function open() { renderApp("/settings?tab=providers"); return screen.findByRole("list", { name: "Added providers" }); }
test("add and remove are staged and use the single Settings Save", async () => {
  const posts = fixture(); const list = await open();
  expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }));
  expect(within(list).getByText("OpenAI")).toBeVisible(); expect(posts).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  expect(within(list).getByText("Removal pending")).toBeVisible(); expect(posts).toHaveLength(0);
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(posts).toHaveLength(1));
  expect(posts[0]).toMatchObject({ expected_revision: "4", expected_available_revision: "a".repeat(64), providers: ["openai"] });
  expect(await screen.findByRole("status", { name: "Settings save status" })).toHaveTextContent("Saved.");
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(within(list).queryByText("Anthropic")).toBeNull();
});
test("undoing provider removal clears the draft and the leave warning", async () => {
  fixture(); await open();
  await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  await userEvent.click(screen.getByRole("button", { name: "Undo removal of Anthropic" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  await userEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);
  expect(screen.queryByRole("alertdialog")).toBeNull();
});
test("provider drafts survive tab switches and warn before leaving Settings", async () => {
  fixture(); await open();
  await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  await userEvent.click(screen.getByRole("tab", { name: "Display" }));
  await userEvent.click(screen.getAllByRole("link", { name: "Overview" })[0]!);
  const warning = await screen.findByRole("alertdialog", { name: "Leave Settings with unsaved changes?" });
  await userEvent.click(within(warning).getByRole("button", { name: "Stay in Settings" }));
  await userEvent.click(screen.getByRole("tab", { name: "Providers" }));
  expect(screen.getByText("Removal pending")).toBeVisible();
  expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(1);
});
test("one Save persists a provider draft from another Settings tab", async () => {
  const posts = fixture(); await open(); await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  await userEvent.click(screen.getByRole("tab", { name: "Display" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(posts[0]?.providers).toEqual([]));
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  expect(await screen.findByRole("status", { name: "Settings save status" })).toHaveTextContent("Saved.");
});
test("conflicts preserve provider drafts until an explicit discard and reload", async () => {
  fixture(); server.use(http.post("/api/settings/providers", () => HttpResponse.json({ error: "conflict", message: "Providers changed; reload before saving." }, { status: 409 })));
  await open(); await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Providers changed"); expect(screen.getByText("Removal pending")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Discard provider edits and reload" }));
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(screen.queryByText("Removal pending")).toBeNull();
});
test("an unconfirmed provider save locks edits and retries the exact operation", async () => {
  const posts: SaveProviders[] = []; const data = initial();
  server.use(http.get("/api/settings/providers", () => HttpResponse.json(data)), http.post("/api/settings/providers", async ({ request }) => {
    const body = await request.json() as SaveProviders; posts.push(body);
    if (posts.length === 1) return HttpResponse.error();
    return HttpResponse.json({ ...data, revision: "5", providers: body.providers, operation_id: body.operation_id });
  }), http.get("/api/settings/providers/operations/:id", () => HttpResponse.json({ error: "not_found", message: "Not recorded" }, { status: 404 })));
  await open(); await userEvent.click(screen.getByRole("button", { name: "Remove Anthropic" }));
  await userEvent.click(screen.getByRole("button", { name: "Save" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check provider save status" }));
  expect(screen.getByRole("button", { name: "Undo removal of Anthropic" })).toBeDisabled();
  await userEvent.click(await screen.findByRole("button", { name: "Retry same provider save" }));
  await waitFor(() => expect(posts).toHaveLength(2)); expect(posts[1]).toEqual(posts[0]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Save" })).toBeDisabled());
  expect(await screen.findByText("Providers saved.")).toBeVisible();
});

test("Google can be added before connection setup and shows Setup required", async () => {
  const data = initial(); data.available.push({ id: "google", name: "Google", accounts: [], credential_status: "not_configured" });
  server.use(http.get("/api/settings/providers", () => HttpResponse.json(data)));
  const list = await open(); await userEvent.selectOptions(screen.getByLabelText("Provider to add"), "google");
  await userEvent.click(screen.getByRole("button", { name: "Add provider" }));
  expect(within(list).getByText("Google")).toBeVisible(); expect(within(list).getByText("Setup required")).toBeVisible();
});
test("account references appear only in account details, beneath consistent provider names", async () => {
  fixture(); const list = await open();
  expect(within(list).getByText("Anthropic")).toBeVisible();
  const account = within(list).getByText("Account references: Team"); expect(account).not.toBeVisible();
  await userEvent.click(within(list).getByText("Account details")); expect(account).toBeVisible();
});
