import { markStale } from "./useProviderUsage";
import type { ProviderUsageResult } from "../api/adapters/providerUsage";

test("failed refresh marks reset credits stale independently of windows", () => {
  const data: ProviderUsageResult = { serverTime: "2026-11-11T00:00:00Z", coverage: { state: "complete" }, providers: [{ providerId: "codex", accountRef: "a", accountLabel: "Codex", scope: "provider_account", windows: [], preferredWindowId: null, resetCredits: { state: "known", availableCount: 2, grants: null, freshness: "fresh", observedAt: "2026-11-11T00:00:00Z", freshUntil: "2026-11-11T00:01:00Z", quality: "reported" } }] };
  expect(markStale(data).providers[0]?.resetCredits).toMatchObject({ availableCount: 2, freshness: "stale", observedAt: "2026-11-11T00:00:00Z" });
  expect(data.providers[0]?.resetCredits?.freshness).toBe("fresh");
});
