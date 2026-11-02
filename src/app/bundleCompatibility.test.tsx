import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";
import { supervisorActor, supervisorDiscovery, supervisorHistory } from "../test/supervisor";
import { graphEnvelope, graphProject } from "../test/humanGraph";
import liveBootstrap from "../../contracts/live/fixtures/bootstrap.json";
import { vi } from "vitest";
import { webcrypto } from "node:crypto";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => { sessionStorage.clear(); vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => server.close());
const oldDigest = `sha256:${"a".repeat(64)}`, newDigest = `sha256:${"b".repeat(64)}`;

function setup(initial: string | null = oldDigest) {
  let digest = initial, principal = supervisorActor, revision = "1", signedOut = false;
  server.use(
    http.get("/api/v1/bootstrap", () => signedOut ? HttpResponse.json({}, { status: 401 }) : HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data,
      principal: { ...bootstrap.data.principal, id: principal, authorization_revision: revision }, product: { ...bootstrap.data.product, dashboard_digest: digest },
      capabilities: [...bootstrap.data.capabilities, ...["supervisor.history.read", "supervisor.message.enqueue", "human.graph.read", "tasks.create"].map(name => ({ name, version: "1", enabled: true }))] } })),
    http.get("/api/human/conversations/global", () => HttpResponse.json(supervisorDiscovery)),
    http.get(`/api/human/conversations/${supervisorDiscovery.conversation.id}/messages`, () => HttpResponse.json(supervisorHistory([]))),
    http.get(`/api/human/projects/${graphProject}/tasks`, () => HttpResponse.json(graphEnvelope({ items: [], next_cursor: null }))),
  );
  return { digest: (value: string | null) => { digest = value; }, identity: (id: string, auth = revision) => { principal = id; revision = auth; }, logout: () => { signedOut = true; } };
}
const composer = () => screen.findByRole("textbox", { name: "Message the global supervisor" });
async function refresh(app: ReturnType<typeof renderApp>) { await act(() => app.queryClient.refetchQueries({ queryKey: ["bootstrap"] })); }

test("digest_change_prompts_reload_preserving_draft", async () => {
  const backend = setup(); const app = renderApp("/supervisor");
  fireEvent.change(await composer(), { target: { value: "Unsent upgrade draft" } });
  backend.digest(newDigest); await refresh(app);
  expect(await screen.findByText(/A new dashboard version is available/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Reload" })).toBeEnabled();
  expect(await composer()).toHaveValue("Unsent upgrade draft");
  expect(app.router.state.location.search).not.toContain("Unsent");
  // A fresh React/query/router tree models the new page load, retaining only sessionStorage.
  app.unmount(); app.queryClient.clear(); const reloaded = renderApp("/supervisor");
  expect(await composer()).toHaveValue("Unsent upgrade draft");
  expect(screen.queryByText(/A new dashboard version is available/)).not.toBeInTheDocument();
  expect(reloaded.router.state.location.search).toBe("");
});

test.each([[null, newDigest], [oldDigest, oldDigest], [oldDigest, null]])("digest %s followed by %s does not prompt", async (initial, next) => {
  const backend = setup(initial); const app = renderApp("/supervisor"); await composer(); backend.digest(next); await refresh(app);
  expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();
});

test("restores all task fields in the same project without putting their values in the URL", async () => {
  setup(); const path = `/work?scope=project:${graphProject}`; const app = renderApp(path);
  await userEvent.click(await screen.findByRole("button", { name: "Create task" }));
  const dialog = screen.getByRole("dialog");
  for (const [name, value] of [["Title", "Preserved title"], ["Description", "Private body"], ["Acceptance criteria", "Private criteria"]]) fireEvent.change(within(dialog).getByRole("textbox", { name }), { target: { value } });
  fireEvent.change(within(dialog).getByRole("combobox", { name: "Initial task state" }), { target: { value: "active" } });
  app.unmount(); app.queryClient.clear(); const fresh = renderApp(path);
  await userEvent.click(await screen.findByRole("button", { name: "Create task" }));
  const restored = screen.getByRole("dialog");
  expect(within(restored).getByRole("textbox", { name: "Title" })).toHaveValue("Preserved title");
  expect(within(restored).getByRole("textbox", { name: "Description" })).toHaveValue("Private body");
  expect(within(restored).getByRole("textbox", { name: "Acceptance criteria" })).toHaveValue("Private criteria");
  expect(within(restored).getByRole("combobox", { name: "Initial task state" })).toHaveValue("active");
  expect(fresh.router.state.location.search).not.toMatch(/Private|Preserved/);
});

test.each(["principal", "revision", "logout"])("erases stored drafts on %s change", async kind => {
  const backend = setup(); const app = renderApp("/supervisor");
  fireEvent.change(await composer(), { target: { value: "Sensitive draft" } });
  expect(JSON.stringify(sessionStorage)).toContain("Sensitive draft");
  if (kind === "logout") backend.logout(); else backend.identity(kind === "principal" ? "other-user" : supervisorActor, kind === "revision" ? "2" : "1");
  await refresh(app);
  await waitFor(() => expect(JSON.stringify(sessionStorage)).not.toContain("Sensitive draft"));
  if (kind !== "logout") expect(await composer()).toHaveValue("");
});

test("missing required contracts disable API features while keeping navigation and upgrade guidance", async () => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...liveBootstrap, data: { ...liveBootstrap.data, contracts: [] } })));
  renderApp("/overview");
  expect(await screen.findByRole("heading", { name: "Overview is not available" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.getByRole("note", { name: "Dashboard version" })).toHaveTextContent("Install compatible versions, then reload.");
});

test.each(["missing", "version"])("a %s required capability refuses only its feature with an upgrade path", async kind => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...liveBootstrap, data: { ...liveBootstrap.data, capabilities: liveBootstrap.data.capabilities.filter(cap => cap.name !== "sessions.read").concat(kind === "version" ? [{ name: "sessions.read", version: "99", enabled: true }] : []) } })));
  renderApp("/agents");
  expect(await screen.findByRole("heading", { name: "Agents is not available" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.getByRole("note", { name: "Dashboard version" })).toHaveTextContent("Install compatible versions, then reload.");
});

test("426 blocks message enqueue, preserves its draft, and leaves the shell and history available", async () => {
  setup();
  server.use(http.post(`/api/human/conversations/${supervisorDiscovery.conversation.id}/messages`, () => new HttpResponse(null, { status: 426 })));
  const app = renderApp("/supervisor"); fireEvent.change(await composer(), { target: { value: "Keep this rejected message" } });
  await userEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled());
  expect(await composer()).toHaveValue("Keep this rejected message");
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.getByRole("note", { name: "Dashboard version" })).toHaveTextContent("Install compatible versions, then reload.");
  app.unmount(); app.queryClient.clear();
  renderApp(`/supervisor?operation=00000000-0000-4000-8000-000000000002&message=00000000-0000-4000-8000-000000000003`);
  expect(await composer()).toHaveValue("Keep this rejected message");
});

test("storage quota failure retains current text and refuses an unsafe reload", async () => {
  const backend = setup(); const app = renderApp("/supervisor"); await composer();
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) { if (this === sessionStorage) throw new DOMException("Quota exceeded", "QuotaExceededError"); original.call(this, key, value); });
  fireEvent.change(await composer(), { target: { value: "Copy me first" } }); backend.digest(newDigest); await refresh(app);
  await userEvent.click(await screen.findByRole("button", { name: "Reload" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Copy your drafts before reloading");
  expect(await composer()).toHaveValue("Copy me first");
});

test("invalid stored task data is ignored instead of being rendered or submitted", async () => {
  setup(); const path = `/work?scope=project:${graphProject}`; const app = renderApp(path);
  await userEvent.click(await screen.findByRole("button", { name: "Create task" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Original draft" } });
  app.unmount(); app.queryClient.clear();
  const key = Object.keys(sessionStorage).find(key => sessionStorage.getItem(key)?.includes("Original draft"))!;
  sessionStorage.setItem(key, '{"title":34,"body":[],"task_state":"auto-run"}');
  renderApp(path); await userEvent.click(await screen.findByRole("button", { name: "Create task" }));
  expect(screen.getByRole("textbox", { name: "Title" })).toHaveValue("");
});
