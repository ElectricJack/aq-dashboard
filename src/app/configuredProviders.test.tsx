import { act, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
const page = { schema_version: 1, contract: "human-provider-accounts-1", source: "startup_configuration", server_time_ms: 123, revision: 1, accounts: [{ provider: "openai", account_reference: "team", enabled: true, provisionable: true, credential_profiles: 1 }] };
function capabilities(enabled = true, version = "1") {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "provider.quota" && c.name !== "providers.configured.read"), { name: "provider.quota", version: "1", enabled: false, reason: "No quota collector" }, { name: "providers.configured.read", version, enabled, reason: "Owner access required" }] } })));
}
test("configured account appears without quota RPC or authentication claims", async () => {
  capabilities(); let quotas = 0;
  server.use(http.get("/api/v1/provider-usage", () => { quotas++; return HttpResponse.json({}); }), http.get("/api/human/provider-accounts", () => HttpResponse.json(page)));
  renderApp("/overview");
  const summary = await screen.findByText("OpenAI", { selector: "summary span span:first-child" });
  expect(summary).toBeInTheDocument();
  const header = await screen.findByRole("banner");
  expect(header.querySelector("summary")).toHaveTextContent("Enabled · server key present · quota unavailable");
  expect(header).not.toHaveTextContent("% used");
  expect(quotas).toBe(0);
  const details = header.querySelector("details")!; details.open = true;
  expect(within(await screen.findByRole("region", { name: "Provider usage (account-wide)" })).getByText(/authentication and model readiness are not checked/)).toBeInTheDocument();
});
test("absent configuration is an honest empty state", async () => {
  capabilities(); server.use(http.get("/api/human/provider-accounts", () => HttpResponse.json({ ...page, revision: null, accounts: [] })));
  renderApp("/overview"); await screen.findByText("No providers configured", { selector: "summary" });
});
test("disabled or unsupported configured capability makes no account request", async () => {
  capabilities(true, "99"); let calls = 0;
  server.use(http.get("/api/human/provider-accounts", () => { calls++; return HttpResponse.json(page); }));
  renderApp("/overview"); await screen.findByText("Usage unavailable", { selector: "summary" }); expect(calls).toBe(0);
});
test("a revoked read never leaves cached configured accounts visible", async () => {
  capabilities(); server.use(http.get("/api/human/provider-accounts", () => HttpResponse.json(page)));
  const { queryClient } = renderApp("/overview"); await screen.findByText("OpenAI", { selector: "summary span span:first-child" });
  server.use(http.get("/api/human/provider-accounts", () => HttpResponse.json({}, { status: 403 })));
  await act(async () => { await queryClient.refetchQueries({ queryKey: ["aq"], type: "active" }); });
  await waitFor(() => expect(screen.queryByText("OpenAI", { selector: "summary span span:first-child" })).not.toBeInTheDocument());
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
});
