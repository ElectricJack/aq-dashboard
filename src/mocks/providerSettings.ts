import { http, HttpResponse } from "msw";
import type { ProviderSettings, SaveProviders } from "../api/providerSettings";
/** Labelled fixture accounts, never live credentials. */
export function providerSettingsHandlers() {
  const storageKey = "aq.fixture.provider-settings";
  let snapshot: ProviderSettings = { revision: "0", available_revision: "a".repeat(64), providers: ["anthropic", "openai", "fixture-provider"], available: [
    { id: "anthropic", name: "Anthropic", accounts: ["Fixture team"], credential_status: "present" },
    { id: "openai", name: "OpenAI", accounts: ["Fixture work"], credential_status: "missing" },
    { id: "fixture-provider", name: "Fixture provider", accounts: ["Labelled fixture"], credential_status: "present" },
  ] };
  try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null") as ProviderSettings | null; if (saved) snapshot = saved; } catch { /* Fresh fixture. */ }
  const receipts = new Map<string, { body: string; result: ProviderSettings & { operation_id: string } }>();
  return [http.get("/api/settings/providers", () => HttpResponse.json(snapshot)),
    http.get("/api/settings/providers/operations/:id", ({ params }) => {
      const receipt = receipts.get(String(params.id)); return receipt ? HttpResponse.json(receipt.result) : HttpResponse.json({ error: "not_found", message: "Save not recorded" }, { status: 404 });
    }), http.post("/api/settings/providers", async ({ request }) => {
      const body = await request.json() as SaveProviders; const previous = receipts.get(body.operation_id);
      if (previous) return previous.body === JSON.stringify(body) ? HttpResponse.json(previous.result) : HttpResponse.json({ error: "conflict", message: "Save identity reused" }, { status: 409 });
      if (body.expected_revision !== snapshot.revision || body.expected_available_revision !== snapshot.available_revision) return HttpResponse.json({ error: "conflict", message: "Providers changed. Reload before saving." }, { status: 409 });
      snapshot = { ...snapshot, providers: body.providers, revision: String(Number(snapshot.revision) + 1) };
      const result = { ...snapshot, operation_id: body.operation_id }; receipts.set(body.operation_id, { body: JSON.stringify(body), result });
      sessionStorage.setItem(storageKey, JSON.stringify(snapshot)); return HttpResponse.json(result);
    })];
}
