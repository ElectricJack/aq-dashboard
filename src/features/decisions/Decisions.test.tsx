import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { decisionDetail, decisionId, decisionPage } from "../../test/decisions";
import { renderApp } from "../../test/renderApp";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function setup(enabled = true, resolve = false) {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: decisionId(9) }, capabilities: [...bootstrap.data.capabilities.filter(c => !["decisions.read", "decisions.resolve"].includes(c.name)), { name: "decisions.read", version: "1", enabled, reason: "Review owner is unavailable" }, { name: "decisions.resolve", version: "1", enabled: resolve }] } })),
    http.get("/api/reviews/decisions", () => HttpResponse.json(decisionPage())), http.get("/api/reviews/decisions/:id", () => HttpResponse.json(decisionDetail())));
}
test("capability absence prevents protected decision requests", async () => {
  setup(false); let calls = 0; server.use(http.get("/api/reviews/decisions", () => { calls++; return HttpResponse.json(decisionPage()); }));
  renderApp("/decisions"); await screen.findByText("Review owner is unavailable"); expect(calls).toBe(0);
});
test("renders actual-shaped inbox, exact criteria, source and evidence panes", async () => {
  setup(); renderApp(`/decisions/${decisionId(1)}`);
  await screen.findByText("Recovery tests retained"); expect(screen.getByRole("heading", { name: "Decision context" })).toBeInTheDocument();
  expect(screen.getByText("Resulting object")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /Approve revision/ })).toBeNull();
});
test("empty page and unavailable read are distinct", async () => {
  setup(); server.use(http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })));
  renderApp("/decisions"); await screen.findByText("No available reviews in this page.");
});
test("unknown response retries exact frozen answer bytes and preserves note", async () => {
  setup(true, true); const sent: unknown[] = [];
  server.use(http.post("/api/reviews/decisions/:id/resolve", async ({ request }) => { sent.push(await request.json()); return HttpResponse.json({}, { status: 503 }); }));
  renderApp(`/decisions/${decisionId(1)}`); await screen.findByText("Recovery tests retained");
  await userEvent.type(screen.getByRole("textbox", { name: "Decision note" }), "Keep recovery evidence");
  await userEvent.click(screen.getByRole("button", { name: "Approve revision 1" }));
  await screen.findByText(/Delivery is unknown/); await userEvent.click(screen.getByRole("button", { name: "Retry same answer" }));
  await screen.findByText(/Delivery is unknown/); expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
  expect(screen.getByRole("textbox", { name: "Decision note" })).toHaveValue("Keep recovery evidence");
});
test("successful answer requires the exact actor operation and recorded receipt", async () => {
  setup(true, true); let resolved = false;
  const makeReceipt = (q: Record<string, unknown>) => ({ schema_version: 1, decision_id: decisionId(1), decision_revision: 2, recorded_at_ms: 11000, request_digest: "a".repeat(64), subject: decisionDetail().request.subject, review_policy: decisionDetail().request.review_policy, eligibility_project_revision: 1, finality: { kind: "human_answer", owner_user_id: decisionId(9), operation_id: q.operation_id, choice: q.choice } });
  server.use(http.post("/api/reviews/decisions/:id/resolve", async ({ request }) => { const q = await request.json() as Record<string, unknown>; resolved = true; return HttpResponse.json(makeReceipt(q)); }), http.get("/api/reviews/decisions/:id", () => HttpResponse.json(resolved ? { ...decisionDetail(), decision_revision: 2, state: "answered", receipt: makeReceipt({ operation_id: decisionId(10), choice: "approve" }) } : decisionDetail())));
  renderApp(`/decisions/${decisionId(1)}`); await screen.findByText("Recovery tests retained");
  await userEvent.click(screen.getByRole("button", { name: "Approve revision 1" })); await screen.findByText("Recorded decision: approve");
  expect(screen.queryByRole("button", { name: "Approve revision 1" })).toBeNull();
});
test("revision conflict retains the note and offers explicit evidence refresh", async () => {
  setup(true, true); server.use(http.post("/api/reviews/decisions/:id/resolve", () => HttpResponse.json({}, { status: 409 })));
  renderApp(`/decisions/${decisionId(1)}`); await screen.findByText("Recovery tests retained");
  await userEvent.type(screen.getByRole("textbox", { name: "Decision note" }), "Retained note");
  await userEvent.click(screen.getByRole("button", { name: "Request changes" })); await screen.findByText(/The review changed/);
  expect(screen.getByRole("textbox", { name: "Decision note" })).toHaveValue("Retained note"); expect(screen.getByRole("button", { name: "Refresh evidence" })).toBeInTheDocument();
});
