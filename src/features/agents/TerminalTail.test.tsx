import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { SERVER_TIME, SESSIONS } from "../../mocks/inspectionData";
import { renderApp } from "../../test/renderApp";
import { vi } from "vitest";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const terminal = { terminal_id: id(1), epoch: 1, session: { kind: "remote", node_id: id(2), boot_id: id(3), attempt_id: id(4), assignment_generation: 1, session_id: id(5) } };
const headers = { "aq-terminal-server-time-ms": "10000" };
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.resetHandlers(); vi.useRealTimers(); });
afterAll(() => server.close());
async function frame(sequence: number, text: string) {
  const bytes = [...new TextEncoder().encode(text)];
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return { terminal, sequence, bytes, byte_length: bytes.length, digest: Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, "0")).join("") };
}
type PageOptions = { status?: number; notRetained?: boolean; gap?: boolean; disconnected?: boolean; text?: string };
function holdFollowingReads(first: PageOptions, following: PageOptions) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { release, options: async (n: number) => { if (n === 1) return first; await gate; return following; } };
}
function setup(options: (n: number) => PageOptions | Promise<PageOptions> = () => ({})) {
  const expires = 25000;
  let subscription = "", reads = 0, watches = 0;
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "terminal.watch"), { name: "terminal.watch", version: "1", enabled: true }] } })),
    http.get("/api/v1/sessions/:id", () => HttpResponse.json({ api_version: "proposed-0", request_id: "tail-test", server_time: SERVER_TIME, scope: { kind: "all_authorized" }, coverage: { state: "complete" }, data: { ...SESSIONS[0], terminal: { type: "terminal", id: terminal.terminal_id } } })),
    http.get("/api/v1/terminals/:id", () => HttpResponse.json({ terminal, session_revision: 1 }, { headers })),
    http.post("/api/v1/terminals/:id/mutations", async ({ request }) => {
      const q = await request.json() as { kind: string; body: { operation_id: string; expires_at_ms: number } };
      expect(q.kind).toBe("watch"); expect(q.body.expires_at_ms).toBe(25000);
      watches++; subscription = q.body.operation_id;
      return HttpResponse.json({ kind: "watch", body: { terminal, operation_id: subscription, subscription_id: subscription, session_revision: 1, expires_at_ms: expires } }, { headers });
    }),
    http.get("/api/v1/terminals/:id/tail", async ({ request }) => {
      const url = new URL(request.url); expect(url.searchParams.get("subscription_id")).toBe(subscription);
      const o = await options(++reads);
      if (o.status) return HttpResponse.json({ error: "refused" }, { status: o.status });
      const after = Number(url.searchParams.get("after_sequence"));
      return HttpResponse.json({ terminal, subscription_id: subscription, session_revision: 1, expires_at_ms: expires, server_time_ms: 10000, last_observed_at_ms: 9999,
        availability: o.notRetained ? "not_retained" : "resident_tail", initial_incomplete: true, disconnected: o.disconnected ?? false,
        frames: o.notRetained || (reads > 1 && !o.gap) ? [] : [await frame(o.gap ? after + 2 : 1, o.text ?? "hello <img src=x>\x1b[2J")],
        gaps: o.gap ? [{ terminal, first_missing: after + 1, last_missing: after + 1 }] : [], next_sequence: o.notRetained ? after : o.gap ? after + 2 : Math.max(1, after), more: true,
      }, { headers });
    }),
  );
  renderApp("/agents/sess-07");
  return { watches: () => watches };
}
async function transcript() { await userEvent.click(await screen.findByRole("button", { name: "Transcript" })); }
async function start() {
  if (!screen.queryByRole("button", { name: /Watch output for/ })) await transcript();
  await userEvent.click(await screen.findByRole("button", { name: /Watch output for/ }));
}

test("registered terminal only watches on explicit action; renders escaped literal bytes and clears on stop", async () => {
  const q = setup();
  await transcript();
  await screen.findByRole("button", { name: /Watch output for/ }); expect(q.watches()).toBe(0);
  await start();
  const output = await screen.findByText("hello <img src=x>\\u001b[2J");
  expect(output.querySelector("img")).toBeNull(); expect(screen.getByText(/not a terminal screen or snapshot/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Stop watching" }));
  expect(output).not.toHaveTextContent("hello"); expect(q.watches()).toBe(1);
});
test("reported gaps discard preceding text and distinguish disconnection", async () => {
  const held = holdFollowingReads({ text: "before gap" }, { gap: true, disconnected: true, text: "after gap" });
  setup(held.options);
  await start(); await screen.findByText("before gap");
  held.release();
  await screen.findByText("after gap"); expect(screen.queryByText("before gap")).toBeNull();
  expect(screen.getByText(/Output gaps or sequence discontinuities/)).toBeInTheDocument();
  expect(within(screen.getByRole("dialog", { name: "Transcript" })).getByText(/Disconnected —/)).toBeInTheDocument();
});
test("not-retained output does not invent a snapshot or replay old bytes", async () => {
  setup(() => ({ notRetained: true })); await start();
  await screen.findByText("Output not retained in this daemon runtime");
  expect(screen.getByText("No output bytes available")).toBeInTheDocument();
});
test.each([401, 403, 404, 503])("a subsequent %s clears previously visible output", async status => {
  const held = holdFollowingReads({ text: "private worker bytes" }, { status });
  setup(held.options); await start();
  await screen.findByText("private worker bytes");
  held.release();
  await waitFor(() => expect(screen.queryByText("private worker bytes")).toBeNull());
  if (status === 401) expect(screen.getByRole("heading", { name: "Sign in required" })).toBeInTheDocument();
  // QA §2A: one refused read stays in its view; the dashboard shell remains.
  else expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
});
test("Watch expiry clears output without automatic renewal", async () => {
  const q = setup(() => ({ text: "temporary bytes" })); await transcript();
  // Exercise the real 15s deadline without racing a 500ms fixture expiry or
  // spending 15s of wall time. Keep MSW and the actual Watch/tail path.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const started = performance.now();
  fireEvent.click(screen.getByRole("button", { name: /Watch output for/ }));
  await vi.waitFor(async () => {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByText("temporary bytes")).toBeInTheDocument();
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(14_999 - (performance.now() - started)); });
  expect(screen.getByText("temporary bytes")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(screen.getByText("Watch expired — output cleared")).toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
  expect(screen.queryByText("temporary bytes")).toBeNull(); expect(q.watches()).toBe(1);
});
