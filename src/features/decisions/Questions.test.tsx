import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import proposal from "../../../contracts/proposed/question-inbox.json";
import actionSchema from "../../../contracts/live/dashboard-actions/schema.json";
import confirmed from "../../../contracts/live/dashboard-actions/fixtures/operation-confirmed.json";
import { adaptQuestion, adaptQuestions } from "../../api/adapters/questions";
import { handlersFor } from "../../mocks/handlers";
import { decisionId, decisionPage } from "../../test/decisions";
import { renderApp } from "../../test/renderApp";
import { freezeQuestionAnswer } from "./questionAnswer";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" })); afterEach(() => server.resetHandlers()); afterAll(() => server.close());

const QUESTION = proposal.list.items[0]!;
const ID = QUESTION.decision_id;
const answeredItem = (answer: string) => ({ ...QUESTION, decision_revision: "2", state: "answered", answer, answered_at_ms: proposal.list.server_time_ms + 1000, delivery: { kind: "wait" } });
const page = (items: unknown[]) => ({ ...proposal.list, items });
const detail = (item: unknown) => ({ api_version: "question-inbox-1", server_time_ms: proposal.list.server_time_ms, item });
const operation = (body: { operation_id: string }, disposition = "confirmed") => ({ ...confirmed, data: { ...confirmed.data, operation_id: body.operation_id, disposition,
  scope: { kind: "project", project_id: QUESTION.project_id }, subject_refs: [{ type: "decision", id: ID, revision: "1" }],
  receipt_refs: disposition === "confirmed" ? [{ type: "decision_receipt", id: ID, revision: "2" }] : [], affected_entities: [] } });

function setup({ questions = true, answer = true }: { questions?: boolean; answer?: boolean } = {}) {
  const extra = [{ name: "dashboard.actions", version: "1", enabled: true }, ...(questions ? [{ name: "questions.read", version: "1", enabled: true }] : []),
    ...(answer ? [{ name: "questions.answer", version: "1", enabled: true }] : [])];
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: decisionId(9) },
    capabilities: [...bootstrap.data.capabilities.filter(c => !["dashboard.actions", "questions.read", "questions.answer"].includes(c.name)), ...extra] } })),
    http.get("/api/reviews/decisions", () => HttpResponse.json({ ...decisionPage(), items: [] })));
}

test("the proposed read adapts and the frozen answer matches the live question.answer schema", () => {
  expect(adaptQuestions(proposal.list, true, QUESTION.project_id).items[0]).toMatchObject({ decisionId: ID, revision: "1", state: "pending", answer: null });
  expect(adaptQuestion(proposal.detail, proposal.detail.item.decision_id).item.delivery).toEqual({ kind: "task_mail", messageId: proposal.detail.item.delivery.message_id });
  expect(() => adaptQuestions(proposal.list, false)).toThrow();
  expect(() => adaptQuestions(page([{ ...QUESTION, answer: "early" }]), true)).toThrow();
  const q = adaptQuestions(proposal.list, true).items[0]!;
  const frozen = freezeQuestionAnswer(q, "  Keep the first event.  ");
  const body = JSON.parse(frozen.bytes);
  expect(body).toEqual({ operation_id: frozen.id, kind: "question.answer", subject: { type: "decision", id: ID, revision: "1" }, expected_versions: { decision: "1" },
    payload: { operation_id: frozen.id, expected_revision: "1", answer: "Keep the first event." } });
  const kind = actionSchema.$defs.ActionRequest.oneOf.find(k => k.properties.kind.const === "question.answer")!;
  const schema = kind.properties.payload as { required: string[]; properties: Record<string, unknown> };
  expect(Object.keys(body.payload).sort()).toEqual(Object.keys(schema.properties).sort());
  expect([...schema.required].sort()).toEqual(Object.keys(body.payload).sort());
  expect(() => freezeQuestionAnswer(q, "   ")).toThrow();
});

test("without questions.read the inbox requests no questions", async () => {
  setup({ questions: false }); let calls = 0;
  server.use(http.get("/api/questions/decisions", () => { calls++; return HttpResponse.json(proposal.list); }));
  renderApp("/decisions"); await screen.findByText("No open reviews"); expect(calls).toBe(0);
  expect(screen.queryByRole("list", { name: "Agent questions" })).toBeNull();
});

test("a pending question shows in the inbox; answering submits question.answer and refreshes", async () => {
  setup(); const sent: Record<string, unknown>[] = []; let answer: string | null = null;
  server.use(
    http.get("/api/questions/decisions", ({ request }) => { const open = new URL(request.url).searchParams.get("state") !== "closed"; return HttpResponse.json(page(open && answer === null ? [QUESTION] : [])); }),
    http.get(`/api/questions/decisions/${ID}`, () => HttpResponse.json(detail(answer === null ? QUESTION : answeredItem(answer)))),
    http.post("/api/v1/actions", async ({ request }) => { const body = await request.json() as { operation_id: string; payload: { answer: string } }; sent.push(body); answer = body.payload.answer; return HttpResponse.json(operation(body)); }),
  );
  renderApp("/decisions");
  const list = await screen.findByRole("list", { name: "Agent questions" });
  const row = within(list).getByRole("link");
  expect(row).toHaveTextContent(QUESTION.question); expect(row).toHaveTextContent("· Question"); expect(row).toHaveTextContent(/Expires in \d+h/);
  expect(row.getAttribute("href")).toBe(`/decisions/${ID}?state=open&kind=question`);
  await userEvent.click(row);
  expect(await screen.findByText(QUESTION.question, { selector: "blockquote" })).toBeInTheDocument();
  expect(screen.getByText("Awaiting your answer")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("textbox", { name: "Answer" }), "Keep the legacy format.");
  await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
  expect(await screen.findByText("Keep the legacy format.", { selector: "blockquote" })).toBeInTheDocument();
  expect(screen.getByText("Delivered to the waiting agent.")).toBeInTheDocument();
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ kind: "question.answer", subject: { type: "decision", id: ID, revision: "1" }, expected_versions: { decision: "1" }, payload: { expected_revision: "1", answer: "Keep the legacy format." } });
  await screen.findByText("No open reviews or questions");
  expect(screen.queryByRole("textbox", { name: "Answer" })).toBeNull();
});

test("a stale revision keeps the draft and offers a deliberate refresh", async () => {
  setup(); const sent: { operation_id: string }[] = [];
  server.use(http.get("/api/questions/decisions", () => HttpResponse.json(page([QUESTION]))), http.get(`/api/questions/decisions/${ID}`, () => HttpResponse.json(detail(QUESTION))),
    http.post("/api/v1/actions", async ({ request }) => { sent.push(await request.json() as { operation_id: string }); return HttpResponse.json({ request_id: "x", code: "conflict", message: "stale", retryable: false }, { status: 409 }); }));
  renderApp(`/decisions/${ID}?kind=question`);
  await userEvent.type(await screen.findByRole("textbox", { name: "Answer" }), "Retained answer");
  await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await screen.findByText(/The question changed or was already answered/);
  expect(screen.getByRole("textbox", { name: "Answer" })).toHaveValue("Retained answer");
  await userEvent.click(screen.getByRole("button", { name: "Refresh question" }));
  await userEvent.click(await screen.findByRole("button", { name: "Send answer" }));
  await screen.findByText(/The question changed or was already answered/);
  expect(sent).toHaveLength(2); expect(sent[1]!.operation_id).not.toBe(sent[0]!.operation_id);
});

test("an unknown outcome retries the exact frozen bytes", async () => {
  setup(); const sent: string[] = [];
  server.use(http.get("/api/questions/decisions", () => HttpResponse.json(page([QUESTION]))), http.get(`/api/questions/decisions/${ID}`, () => HttpResponse.json(detail(QUESTION))),
    http.post("/api/v1/actions", async ({ request }) => { sent.push(await request.text()); return HttpResponse.json({}, { status: 503 }); }));
  renderApp(`/decisions/${ID}?kind=question`);
  await userEvent.type(await screen.findByRole("textbox", { name: "Answer" }), "Same answer");
  await userEvent.click(screen.getByRole("button", { name: "Send answer" }));
  await userEvent.click(await screen.findByRole("button", { name: "Retry same answer" }));
  await screen.findByText(/Delivery is unknown/);
  expect(sent).toHaveLength(2); expect(sent[1]).toBe(sent[0]);
});

test("answering names the reason when questions.answer is not offered", async () => {
  setup({ answer: false });
  server.use(http.get("/api/questions/decisions", () => HttpResponse.json(page([QUESTION]))), http.get(`/api/questions/decisions/${ID}`, () => HttpResponse.json(detail(QUESTION))));
  renderApp(`/decisions/${ID}?kind=question`);
  await screen.findByText("Not offered by this AQ server");
  expect(screen.queryByRole("button", { name: "Send answer" })).toBeNull();
});
