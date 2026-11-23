import { http, HttpResponse } from "msw";

/**
 * Mock-only interactive terminal fixture. Every byte it serves is synthetic and
 * the first line labels it "Fixture"; it never stands in for a real session.
 */
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Fixture terminal id for a session's `term-<session>` reference (index-stable). */
export const fixtureTerminalId = (index: number) => uuid(100 + index);

const SESSION_REVISION = 2;
const LEASE_MS = 14000;

const fixtureText = (label: string) =>
  `# Fixture output for ${label} (synthetic, not a real session)\r\n` +
  "$ npm test -- replay\r\n" +
  "\x1b[32m PASS \x1b[0m src/replay/reconcile.test.ts (12 tests)\r\n" +
  "\x1b[32m PASS \x1b[0m src/replay/ledger.test.ts (8 tests)\r\n" +
  " FAIL  src/replay/merge.test.ts\r\n" +
  "   expected 3 entries, received 2\r\n" +
  "Tests: 1 failed, 20 passed, 21 total\r\n" +
  "$ ";

type Lease = { lease_id: string; generation: number; issued_at_ms: number; expires_at_ms: number; execution_expires_at_ms: number };
type State = { generation: number; lease: Lease | null; subscriptions: Map<string, number>; leases: number };

function grantLease(s: State, kind: "control" | "renew", requestedExpiry: number, now: number) {
  s.generation++;
  const expires = Math.min(requestedExpiry, now + LEASE_MS);
  const leaseId = kind === "renew" && s.lease ? s.lease.lease_id : uuid(900000 + ++s.leases);
  s.lease = { lease_id: leaseId, generation: s.generation, issued_at_ms: now, expires_at_ms: expires, execution_expires_at_ms: expires + 16000 };
}

function identity(id: string) {
  const n = Number(id.slice(-12));
  return { terminal_id: id, epoch: 1, session: { kind: "central" as const, authority_id: uuid(2), session_id: uuid(n + 1000), generation: 1 } };
}
const receipt = (terminal: ReturnType<typeof identity>, operation: string) => ({ terminal, operation_id: operation, disposition: "applied", input_paused: false, observed_at_ms: Date.now() });

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Handlers for `/api/v1/terminals/:id` (info, watch, control, renew, release,
 * resize, input, receipts and tail). `terminals` maps fixture terminal ids to
 * the session label printed in the fixture banner.
 */
export function terminalHandlers(terminals: ReadonlyMap<string, string>) {
  const states = new Map<string, State>();
  // The last fixture terminal's policy accepts no input, so Take control is disabled with its reason (N-07).
  const readOnly = new Set([...terminals.keys()].slice(-1));
  const stateOf = (id: string) => {
    let s = states.get(id);
    if (!s) states.set(id, (s = { generation: 0, lease: null, subscriptions: new Map(), leases: 0 }));
    return s;
  };
  const json = (body: unknown, at = Date.now()) =>
    HttpResponse.json(body as Record<string, unknown>, { headers: { "aq-terminal-server-time-ms": String(at) } });
  const control = (id: string) => {
    const s = stateOf(id), terminal = identity(id);
    return { terminal, session_revision: SESSION_REVISION, generation: s.generation, lease: s.lease && { terminal, ...s.lease }, fence_acknowledged: s.lease !== null, input_paused: false };
  };

  const missing = () => HttpResponse.json({ code: "not_found", message: "Terminal not found" }, { status: 404 });


  return [
    http.get("/api/v1/terminals/:id", ({ params }) => {
      const id = String(params.id);
      if (!terminals.has(id)) return missing();
      return json({ terminal: identity(id), session_revision: SESSION_REVISION, input_mode: "finite_v1", terminal_policy: { input_enabled: !readOnly.has(id), max_input_bytes: 4096, max_pending_input_bytes: 32768 }, disconnected: false, control: control(id) });
    }),
    http.get("/api/v1/terminals/:id/receipts/:operation", ({ params }) =>
      terminals.has(String(params.id)) ? json(receipt(identity(String(params.id)), String(params.operation))) : missing(),
    ),
    http.post("/api/v1/terminals/:id/mutations", async ({ params, request }) => {
      const id = String(params.id);
      if (!terminals.has(id)) return missing();
      const s = stateOf(id), terminal = identity(id);
      const { kind, body } = (await request.json()) as { kind: string; body: Record<string, unknown> & { operation_id: string } };
      const now = Date.now();
      switch (kind) {
        case "watch": {
          const subscription = uuid(500000 + s.subscriptions.size);
          const expires = Number(body.expires_at_ms);
          s.subscriptions.set(subscription, expires);
          return json({ kind: "watch", body: { terminal, operation_id: body.operation_id, subscription_id: subscription, session_revision: SESSION_REVISION, expires_at_ms: expires } }, now);
        }
        case "control":
        case "renew": {
          grantLease(s, kind, Number(body.expires_at_ms), now);
          // The relay answers both acquisition and renewal with a `control` reply.
          return json({ kind: "control", body: { operation_id: body.operation_id, status: control(id) } }, now);
        }
        case "release":
          s.lease = null;
          return json({ kind: "release", body: { operation_id: body.operation_id, status: control(id) } }, now);
        case "resize":
          return json({ kind: "resize", body: { terminal, operation_id: body.operation_id, sequence: body.sequence, disposition: "applied", observed_at_ms: now } }, now);
        case "input":
          return json({ kind: "input", body: receipt(terminal, body.operation_id) }, now);
        default:
          return HttpResponse.json({ code: "unsupported", message: "Unsupported terminal mutation" }, { status: 400 });
      }
    }),
    http.get("/api/v1/terminals/:id/tail", async ({ params, request }) => {
      const id = String(params.id);
      if (!terminals.has(id)) return missing();
      const url = new URL(request.url);
      const subscription = url.searchParams.get("subscription_id") ?? "";
      const expires = stateOf(id).subscriptions.get(subscription);
      if (expires === undefined) return HttpResponse.json({ code: "not_found", message: "Unknown subscription" }, { status: 404 });
      const after = Math.max(0, Number(url.searchParams.get("after_sequence") ?? 0) || 0);
      const terminal = identity(id);
      const frames = [];
      if (after === 0) {
        const bytes = new TextEncoder().encode(fixtureText(terminals.get(id)!));
        frames.push({ terminal, sequence: after + 1, bytes: [...bytes], byte_length: bytes.length, digest: await digest(bytes) });
      }
      const at = Math.min(Date.now(), expires - 1);
      return json({
        terminal, subscription_id: subscription, session_revision: SESSION_REVISION, expires_at_ms: expires, server_time_ms: at,
        last_observed_at_ms: null, availability: "resident_tail", disconnected: false, initial_incomplete: true, grid: [120, 40], more: false,
        next_sequence: frames.length ? after + 1 : after, frames, gaps: [],
      }, at);
    }),
  ];
}
