import { http, HttpResponse } from "msw";
import type { Bootstrap, Envelope } from "../api/wire/proposed";
import { scenario } from "./scenarios";

function envelope<T>(data: T): Envelope<T> {
  return {
    api_version: "proposed-0",
    request_id: "mock",
    server_time: "2026-10-31T12:00:00.000Z",
    scope: { kind: "all_authorized" },
    data,
    observation: {
      observed_at: "2026-10-31T12:00:00.000Z",
      fresh_until: "2026-10-31T12:01:00.000Z",
      source: "mock",
      quality: "reported",
      coverage: "complete",
    },
    pending_operations: [],
    coverage: { state: "complete" },
  };
}

/** MSW handlers serving PROPOSED fixtures for one scenario. */
export function handlersFor(name: string | null | undefined) {
  const s = scenario(name);
  return [
    http.get("/api/v1/bootstrap", () => HttpResponse.json(envelope<Bootstrap>(s.bootstrap))),
    http.get("/api/v1/provider-usage", () =>
      s.providerUsage.kind === "ok"
        ? HttpResponse.json(s.providerUsage.body)
        : HttpResponse.json(s.providerUsage.body, { status: s.providerUsage.status }),
    ),
  ];
}
