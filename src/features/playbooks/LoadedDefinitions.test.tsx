import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { loadedDefinitions, loadedDefinition } from "../../test/loadedDefinitions";
import { renderApp } from "../../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function capability(on = true) { server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data,
  capabilities: [...bootstrap.data.capabilities.filter(cap => !["playbooks.inspect", "playbooks.loaded-definitions.read"].includes(cap.name)),
    { name: "playbooks.inspect", version: "1", enabled: true }, { name: "playbooks.loaded-definitions.read", version: "1", enabled: on, reason: "Loaded startup definitions are not provided" }] } }))); }
test("direct Definitions navigation does not read engine runs or admissions", async () => {
  capability(); let engineReads = 0, metadataReads = 0;
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => { metadataReads++; return HttpResponse.json(loadedDefinitions()); }),
    http.get("/api/playbooks/inspection/runs", () => { engineReads++; return HttpResponse.json({}); }),
    http.get("/api/playbooks/inspection/admissions", () => { engineReads++; return HttpResponse.json({}); }));
  renderApp("/playbooks?view=definitions");
  await screen.findByRole("list", { name: "Loaded playbook definitions" });
  expect(metadataReads).toBe(1); expect(engineReads).toBe(0);
});
test("separate capability disables metadata reads without inventing an empty catalog", async () => {
  capability(false); let reads = 0;
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => { reads++; return HttpResponse.json(loadedDefinitions()); }));
  renderApp("/playbooks?view=definitions");
  await screen.findByText("Loaded startup definitions are not provided"); expect(reads).toBe(0);
  expect(screen.queryByText("No definitions installed")).toBeNull();
});
test("definition selection has exact pins, startup provenance and no installed/activation claim", async () => {
  capability(); let reads = 0;
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", ({ request }) => { expect(new URL(request.url).searchParams.has("limit")).toBe(false); reads++; return HttpResponse.json(loadedDefinitions()); }));
  const { router } = renderApp("/playbooks?view=definitions");
  const list = await screen.findByRole("list", { name: "Loaded playbook definitions" });
  await userEvent.click(within(list).getByRole("button", { name: "Inspect definition coding-policy" }));
  const detail = await screen.findByRole("region", { name: "Definition coding-policy" });
  expect(router.state.location.search).toContain(`definition=sha256%3A${"a".repeat(64)}`);
  expect(within(detail).getByText(`sha256:${"b".repeat(64)}`)).toBeInTheDocument();
  expect(within(detail).getByText(`sha256:${"d".repeat(64)}`)).toBeInTheDocument();
  expect(within(detail).getByText("This startup configuration does not report current installation or activation.")).toBeInTheDocument();
  expect(reads).toBe(1); expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "All definitions" }));
  await waitFor(() => expect(within(list).getByRole("button", { name: "Inspect definition coding-policy" })).toHaveFocus());
});
test("exact definition deep link renders literal text and truncated purpose explicitly", async () => {
  capability(); const raw = { ...loadedDefinition(), purpose: "<img src=x onerror=alert(1)>", purpose_truncated: true };
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => HttpResponse.json(loadedDefinitions([raw]))));
  renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(raw.artifact)}`);
  const detail = await screen.findByRole("region", { name: "Definition coding-policy" });
  expect(within(detail).getByText(raw.purpose)).toBeInTheDocument(); expect(document.querySelector('img[src="x"]')).toBeNull();
  expect(within(detail).getByText("Showing the first 4096 UTF-8 bytes of purpose text.")).toBeInTheDocument();
});
test("definition outside loaded set is not a current catalog absence assertion", async () => {
  capability(); server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => HttpResponse.json(loadedDefinitions())));
  renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(`sha256:${"f".repeat(64)}`)}`);
  await screen.findByText("This artifact is not in the loaded startup configuration.");
  expect(screen.queryByText("Not installed")).toBeNull();
});
test("failed refresh removes protected metadata instead of retaining an old detail", async () => {
  capability(); server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => HttpResponse.json(loadedDefinitions())));
  renderApp(`/playbooks?view=definitions&definition=${encodeURIComponent(loadedDefinition().artifact)}`);
  await screen.findByRole("region", { name: "Definition coding-policy" });
  server.use(http.get("/api/playbooks/inspection/loaded-definitions", () => HttpResponse.json({}, { status: 503 })));
  await userEvent.click(screen.getByRole("button", { name: "Refresh definitions" }));
  await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "Definition coding-policy" })).toBeNull();
});
