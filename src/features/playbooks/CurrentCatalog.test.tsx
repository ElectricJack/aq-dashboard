import { vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { activationCatalog, catalogActivation, catalogDefinition, definitionCatalog } from "../../test/playbookCatalog";
import { loadedDefinitions } from "../../test/loadedDefinitions";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => { server.resetHandlers(); vi.restoreAllMocks(); }); afterAll(() => server.close());
function capability(enabled = true) { server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(cap => !["playbooks.inspect", "playbooks.catalog.read", "playbooks.loaded-definitions.read"].includes(cap.name)), { name: "playbooks.inspect", version: "1", enabled: true }, { name: "playbooks.catalog.read", version: "1", enabled, reason: "Current namespace catalog is unavailable" }, { name: "playbooks.loaded-definitions.read", version: "1", enabled: true }] } }))); }
function definitions() { capability(); server.use(http.get("/api/playbooks/inspection/catalog/definitions", () => HttpResponse.json(definitionCatalog()))); }
test("direct current Definitions reads neither runs, admissions nor historical startup metadata", async () => {
  definitions(); let unrelated = 0;
  server.use(http.get("/api/playbooks/inspection/runs", () => { unrelated++; return HttpResponse.json({}); }), http.get("/api/playbooks/inspection/admissions", () => { unrelated++; return HttpResponse.json({}); }), http.get("/api/playbooks/inspection/loaded-definitions", () => { unrelated++; return HttpResponse.json({}); }));
  renderApp("/playbooks?view=definitions");
  // Bootstrap/session activation and page mount precede the first catalog read.
  // Observe each stage before starting the list's normal assertion deadline.
  await screen.findByRole("navigation", { name: "Primary" });
  await screen.findByRole("heading", { level: 1, name: "Playbooks" });
  await screen.findByRole("list", { name: "Current playbook definitions" }); expect(unrelated).toBe(0); expect(screen.queryByText(/Runtime startup configuration/)).toBeNull();
});
test("selection makes an exact stamped read, shows immutable pins, and restores roster focus", async () => {
  capability(); const requests: URLSearchParams[] = [];
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => { requests.push(new URL(request.url).searchParams); return HttpResponse.json(definitionCatalog()); }));
  const { router } = renderApp("/playbooks?view=definitions"); const list = await screen.findByRole("list", { name: "Current playbook definitions" });
  const select = within(list).getByRole("button", { name: /^contract-fixture/ }); await userEvent.click(select);
  const detail = await screen.findByRole("region", { name: "Definition contract-fixture" }); expect(within(detail).getByText("Namespace artifact")).toBeInTheDocument();
  expect(requests).toHaveLength(2); expect(requests[1]?.get("exact")).toBe(catalogDefinition().key); expect(requests[1]?.get("incarnation")).toBe("2"); expect(requests[1]?.get("metadata_revision")).toBe("5"); expect(router.state.location.search).toContain("definition=sha256");
  expect(screen.queryByRole("button", { name: /^Activate$/ })).toBeNull(); await userEvent.click(screen.getByRole("link", { name: "All definitions" })); await waitFor(() => expect(select).toHaveFocus());
});
test("activation detail shows actual stored controls and navigates to exact bound artifact", async () => {
  capability(); server.use(http.get("/api/playbooks/inspection/catalog/activations", () => HttpResponse.json(activationCatalog())), http.get("/api/playbooks/inspection/catalog/definitions", () => HttpResponse.json(definitionCatalog())));
  renderApp(`/playbooks?view=activations&activation=${encodeURIComponent(catalogActivation().key)}`);
  const detail = await screen.findByRole("region", { name: "Activation catalog-contract-binding" }); const controls = within(detail).getByRole("heading", { name: "Stored controls" }).closest("section")!;
  expect(controls).toHaveTextContent("Event startsDisabled"); expect(controls).toHaveTextContent("Artifact execution deniedNo"); expect(within(detail).getByText("3")).toBeInTheDocument();
  await userEvent.click(within(detail).getByRole("button", { name: "Inspect bound definition" })); await screen.findByRole("region", { name: "Definition contract-fixture" });
});
test("capability absence retains explicitly historical Definitions and makes no current query", async () => {
  capability(false); let reads = 0; server.use(http.get("/api/playbooks/inspection/catalog/definitions", () => { reads++; return HttpResponse.json(definitionCatalog()); }), http.get("/api/playbooks/inspection/loaded-definitions", () => HttpResponse.json(loadedDefinitions())));
  renderApp("/playbooks?view=definitions"); await screen.findByRole("list", { name: "Loaded playbook definitions" }); expect(reads).toBe(0);
  await userEvent.click(screen.getByRole("tab", { name: "Activations" })); await screen.findByText("Current namespace catalog is unavailable"); expect(reads).toBe(0);
});
test("current read failure never falls back to startup history or invents an empty set", async () => {
  capability(); let historical = 0; server.use(http.get("/api/playbooks/inspection/catalog/definitions", () => HttpResponse.json({}, { status: 503 })), http.get("/api/playbooks/inspection/loaded-definitions", () => { historical++; return HttpResponse.json(loadedDefinitions()); }));
  renderApp("/playbooks?view=definitions"); await screen.findByRole("alert"); expect(historical).toBe(0); expect(screen.queryByText("No definitions represented in this namespace.")).toBeNull();
});
test("refresh failure removes protected catalog details", async () => {
  definitions(); renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(catalogDefinition().key)}`); await screen.findByRole("region", { name: "Definition contract-fixture" });
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", () => HttpResponse.json({}, { status: 503 })));
  await userEvent.click(screen.getByRole("button", { name: "Refresh definitions" })); await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "Definition contract-fixture" })).toBeNull();
});
test("continuation sends exact stamp and changed catalog refuses mixed rows", async () => {
  capability(); const first = catalogDefinition(), second = catalogDefinition(`sha256:${"b".repeat(64)}`);
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => { const query = new URL(request.url).searchParams; if (query.has("after")) { expect(query.get("after")).toBe(first.key); expect(query.get("metadata_revision")).toBe("5"); return HttpResponse.json({ ...definitionCatalog([second]), metadata_revision: "6" }); } return HttpResponse.json(definitionCatalog([first], first.key)); }));
  renderApp("/playbooks?view=definitions"); await screen.findByRole("list", { name: "Current playbook definitions" }); await userEvent.click(screen.getByRole("button", { name: "Load more definitions" })); await screen.findByRole("heading", { name: "Dashboard update required" }); expect(screen.queryByRole("list", { name: "Current playbook definitions" })).toBeNull();
});
test("exact deep link outside roster still checks current namespace and renders literal purpose", async () => {
  capability(); const selected = catalogDefinition(`sha256:${"d".repeat(64)}`); selected.record.metadata.purpose = "<img src=x onerror=alert(1)>";
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => HttpResponse.json(new URL(request.url).searchParams.has("exact") ? definitionCatalog([selected]) : definitionCatalog())));
  renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(selected.key)}`); const detail = await screen.findByRole("region", { name: "Definition contract-fixture" }); expect(within(detail).getByText(selected.record.metadata.purpose)).toBeInTheDocument(); expect(document.querySelector('img[src="x"]')).toBeNull();
  await userEvent.click(screen.getByRole("link", { name: "All definitions" })); await waitFor(() => expect(screen.getByText(/Current namespace metadata/)).toHaveFocus());
});

test("a valid catalog-change conflict hides old rows and refreshes from a fresh first page", async () => {
  capability(); let firstReads = 0; const first = catalogDefinition();
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => {
    if (new URL(request.url).searchParams.has("after")) return HttpResponse.json({ code: "playbook_identity_conflict" }, { status: 409 });
    firstReads++; return HttpResponse.json(definitionCatalog([first], firstReads === 1 ? first.key : null));
  }));
  renderApp("/playbooks?view=definitions"); await screen.findByRole("list", { name: "Current playbook definitions" });
  await userEvent.click(screen.getByRole("button", { name: "Load more definitions" })); await screen.findByRole("alert"); expect(screen.queryByRole("list", { name: "Current playbook definitions" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("list", { name: "Current playbook definitions" }); expect(firstReads).toBe(2);
});


test.each([401, 403])("held %s headers clear prior catalog even with bootstrap503 and no historical fallback", async status => {
  definitions(); let historical = 0, cancelled = false;
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => { historical++; return HttpResponse.json(loadedDefinitions()); }));
  const app = renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(catalogDefinition().key)}`);
  await screen.findByRole("region", { name: "Definition contract-fixture" });
  server.use(http.get("/api/v1/bootstrap", () => new HttpResponse(null, { status: 503 })));
  // MSW buffers its stream before returning headers; return a genuine streamed
  // Response directly to exercise the browser's headers-first fetch semantics.
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => typeof input === "string" && input.startsWith("/api/playbooks/inspection/catalog/")
    ? Promise.resolve(new Response(new ReadableStream({ cancel() { cancelled = true; return new Promise(() => undefined); } }), { status, headers: { "content-type": "application/json" } }))
    : originalFetch(input, init));
  await userEvent.click(screen.getByRole("button", { name: "Refresh definitions" }));
  await screen.findByRole("heading", { name: status === 401 ? "Sign in required" : "Access not confirmed" });
  await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] }));
  expect(screen.queryByRole("region", { name: "Definition contract-fixture" })).toBeNull(); expect(screen.queryByRole("list", { name: "Current playbook definitions" })).toBeNull(); expect(historical).toBe(0); expect(cancelled).toBe(true);
});

test("exact409 invalidates its currently painted roster until a fresh epoch", async () => {
  capability(); let lists = 0; const first = catalogDefinition(), added = catalogDefinition(`sha256:${"b".repeat(64)}`); added.record.metadata.name = "fresh-definition";
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => {
    const query = new URL(request.url).searchParams;
    if (query.has("exact")) return query.get("metadata_revision") === "5" ? HttpResponse.json({}, { status: 409 }) : HttpResponse.json({ ...definitionCatalog([first]), metadata_revision: "6" });
    lists++; return HttpResponse.json(lists === 1 ? definitionCatalog([first]) : { ...definitionCatalog([first, added]), metadata_revision: "6" });
  }));
  renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(first.key)}`); await screen.findByRole("alert"); expect(screen.queryByRole("list", { name: "Current playbook definitions" })).toBeNull();
  // Clearing selection through the tab must not resurrect a known stale roster.
  await userEvent.click(screen.getByRole("tab", { name: "Definitions" })); expect(screen.queryByRole("list", { name: "Current playbook definitions" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Try again" })); const list = await screen.findByRole("list", { name: "Current playbook definitions" }); expect(within(list).getByText("fresh-definition")).toBeInTheDocument(); expect(lists).toBe(2);
});
test("late exact409 from a replaced stamp cannot hide a freshly read roster", async () => {
  capability(); let release!: () => void, firstExact = false, lists = 0; const gate = new Promise<void>(resolve => { release = resolve; });
  const first = catalogDefinition(), added = catalogDefinition(`sha256:${"b".repeat(64)}`); added.record.metadata.name = "fresh-definition";
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", async ({ request }) => {
    const query = new URL(request.url).searchParams;
    if (query.has("exact")) { if (query.get("metadata_revision") === "5") { firstExact = true; await gate; return HttpResponse.json({}, { status: 409 }); } return HttpResponse.json({ ...definitionCatalog([first]), metadata_revision: "6" }); }
    lists++; return HttpResponse.json(lists === 1 ? definitionCatalog([first]) : { ...definitionCatalog([first, added]), metadata_revision: "6" });
  }));
  const app = renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(first.key)}`); await waitFor(() => expect(firstExact).toBe(true));
  await act(() => app.queryClient.invalidateQueries({ predicate: query => query.queryKey.includes("playbook-current-catalog") }));
  await screen.findByText("fresh-definition"); await screen.findByRole("region", { name: "Definition contract-fixture" });
  await act(async () => { release(); await gate; });
  expect(screen.getByRole("list", { name: "Current playbook definitions" })).toHaveTextContent("fresh-definition"); expect(screen.queryByRole("alert")).toBeNull();
});


test("capability loss and gain cannot repaint the old incarnation while its new first page is held", async () => {
  capability(); let nextSource = false, requested = false, release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const oldBinding = catalogActivation(), newBinding = catalogActivation(); newBinding.record.metadata.revision = "4"; newBinding.record.metadata.controls.calls_enabled = false; newBinding.record.metadata.controls.event_starts_enabled = true;
  const exactIncarnations: (string | null)[] = [];
  server.use(http.get("/api/playbooks/inspection/catalog/activations", async ({ request }) => {
    const query = new URL(request.url).searchParams; if (query.has("exact")) exactIncarnations.push(query.get("incarnation"));
    if (!nextSource) return HttpResponse.json(activationCatalog([oldBinding]));
    requested = true; await gate; return HttpResponse.json({ ...activationCatalog([newBinding]), incarnation: "3", metadata_revision: "6" });
  }));
  const app = renderApp(`/playbooks?view=activations&activation=${encodeURIComponent(oldBinding.key)}`); await screen.findByRole("region", { name: "Activation catalog-contract-binding" });
  capability(false); await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await screen.findByText("Current namespace catalog is unavailable");
  expect(screen.queryByRole("region", { name: "Activation catalog-contract-binding" })).toBeNull();
  nextSource = true; capability(true); await act(() => app.queryClient.invalidateQueries({ queryKey: ["bootstrap"] })); await waitFor(() => expect(requested).toBe(true));
  expect(screen.queryByRole("list", { name: "Current playbook activations" })).toBeNull(); expect(screen.queryByRole("region", { name: "Activation catalog-contract-binding" })).toBeNull();
  await act(async () => { release(); await gate; }); const detail = await screen.findByRole("region", { name: "Activation catalog-contract-binding" });
  expect(within(detail).getByText("4")).toBeInTheDocument(); expect(within(detail).queryByText("3")).toBeNull(); expect(exactIncarnations.at(-1)).toBe("3");
  expect(within(detail).getByRole("region", { name: "Stored controls" })).toHaveTextContent("New callsDisabled"); expect(within(detail).getByRole("region", { name: "Stored controls" })).toHaveTextContent("Event startsEnabled");
});
