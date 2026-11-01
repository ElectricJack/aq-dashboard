import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { activationCatalog, catalogActivation, catalogDefinition, definitionCatalog } from "../../test/playbookCatalog";
import { loadedDefinitions } from "../../test/loadedDefinitions";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function capability(enabled = true) { server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(cap => !["playbooks.inspect", "playbooks.catalog.read", "playbooks.loaded-definitions.read"].includes(cap.name)), { name: "playbooks.inspect", version: "1", enabled: true }, { name: "playbooks.catalog.read", version: "1", enabled, reason: "Current namespace catalog is unavailable" }, { name: "playbooks.loaded-definitions.read", version: "1", enabled: true }] } }))); }
function definitions() { capability(); server.use(http.get("/api/playbooks/inspection/catalog/definitions", () => HttpResponse.json(definitionCatalog()))); }
test("direct current Definitions reads neither runs, admissions nor historical startup metadata", async () => {
  definitions(); let unrelated = 0;
  server.use(http.get("/api/playbooks/inspection/runs", () => { unrelated++; return HttpResponse.json({}); }), http.get("/api/playbooks/inspection/admissions", () => { unrelated++; return HttpResponse.json({}); }), http.get("/api/playbooks/inspection/loaded-definitions", () => { unrelated++; return HttpResponse.json({}); }));
  renderApp("/playbooks?view=definitions"); await screen.findByRole("list", { name: "Current playbook definitions" }); expect(unrelated).toBe(0); expect(screen.queryByText(/Runtime startup configuration/)).toBeNull();
});
test("selection makes an exact stamped read, shows immutable pins, and restores roster focus", async () => {
  capability(); const requests: URLSearchParams[] = [];
  server.use(http.get("/api/playbooks/inspection/catalog/definitions", ({ request }) => { requests.push(new URL(request.url).searchParams); return HttpResponse.json(definitionCatalog()); }));
  const { router } = renderApp("/playbooks?view=definitions"); const list = await screen.findByRole("list", { name: "Current playbook definitions" });
  const select = within(list).getByRole("button", { name: "Inspect definition contract-fixture" }); await userEvent.click(select);
  const detail = await screen.findByRole("region", { name: "Definition contract-fixture" }); expect(within(detail).getByText("Namespace artifact")).toBeInTheDocument();
  expect(requests).toHaveLength(2); expect(requests[1]?.get("exact")).toBe(catalogDefinition().key); expect(requests[1]?.get("incarnation")).toBe("2"); expect(requests[1]?.get("metadata_revision")).toBe("5"); expect(router.state.location.search).toContain("definition=sha256");
  expect(screen.queryByRole("button", { name: /^Activate$/ })).toBeNull(); await userEvent.click(screen.getByRole("button", { name: "All definitions" })); await waitFor(() => expect(select).toHaveFocus());
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
  await userEvent.click(screen.getByRole("button", { name: "Activations" })); await screen.findByText("Current namespace catalog is unavailable"); expect(reads).toBe(0);
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
  await userEvent.click(screen.getByRole("button", { name: "All definitions" })); await waitFor(() => expect(screen.getByText(/Current namespace metadata/)).toHaveFocus());
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
