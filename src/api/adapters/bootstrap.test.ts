import type { Bootstrap } from "../wire/proposed";
import { adaptBootstrap } from "./bootstrap";

function bootstrap(overrides: Partial<Bootstrap> = {}): Bootstrap {
  return {
    principal: { id: "u-1", display_name: "Jack", authorization_revision: "9007199254740993" },
    product: { version: "0.0.0", dashboard_digest: "sha256:00" },
    contracts: [],
    capabilities: [
      { name: "dashboard.inspect", version: "1", enabled: true },
      { name: "provider.quota", version: "1", enabled: false, reason: "No qualified source" },
    ],
    limits: { page_size: 25 },
    default_scope: { kind: "all_authorized" },
    global_supervisor: { status: "unconfigured", conversation_id: null },
    ...overrides,
  };
}

test("keeps the authorization revision as an exact string", () => {
  expect(adaptBootstrap(bootstrap()).principal.authorizationRevision).toBe("9007199254740993");
});

test("rejects a non-decimal authorization revision", () => {
  const raw = bootstrap();
  (raw.principal as { authorization_revision: unknown }).authorization_revision = 12;
  expect(() => adaptBootstrap(raw)).toThrow(/contract/i);
});

test("reports enabled capabilities", () => {
  expect(adaptBootstrap(bootstrap()).capability("dashboard.inspect")).toEqual({ enabled: true });
});

test("keeps the server reason for a disabled capability", () => {
  expect(adaptBootstrap(bootstrap()).capability("provider.quota")).toEqual({
    enabled: false,
    reason: "No qualified source",
  });
});

test("treats a capability the server did not negotiate as disabled", () => {
  expect(adaptBootstrap(bootstrap()).capability("results.read")).toEqual({
    enabled: false,
    reason: "Not offered by this AQ server",
  });
});

test("renders an unrecognised supervisor status as unsupported", () => {
  const raw = bootstrap();
  (raw.global_supervisor as { status: string }).status = "warming";
  expect(adaptBootstrap(raw).globalSupervisor.status).toBe("unsupported");
});
