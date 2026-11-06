import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fixture from "../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

// QA 2026-11-06 §2A: one refused request must never replace the dashboard.
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const NOT_FOUND = "This item does not exist or is not available to you.";
const forbidden = { request_id: "r", code: "forbidden", message: "review is not available to this owner", retryable: false };

test("WD-12: an unknown decision id shows the neutral not-found view inside Decisions", async () => {
  let reads = 0;
  server.use(http.get("/api/reviews/decisions/:id", () => { reads++; return HttpResponse.json(forbidden, { status: 403 }); }));
  renderApp("/decisions/e0a20000-0000-4000-8000-00000000beef");
  const panel = await screen.findByRole("alert");
  expect(panel).toHaveTextContent(NOT_FOUND);
  expect(within(panel).queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "Access denied" })).toBeNull();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Decisions" })).toBeInTheDocument();
  expect(reads).toBe(1);
});

test("WD-13: a malformed question id shows the neutral not-found view, not a retryable error", async () => {
  server.use(
    http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...fixture, data: { ...fixture.data, capabilities: [...fixture.data.capabilities.filter(c => c.name !== "questions.read"), { name: "questions.read", version: "1", enabled: true }] } })),
    http.get("/api/questions/decisions", () => HttpResponse.json({}, { status: 503 })),
    http.get("/api/questions/decisions/:id", () => HttpResponse.json({ request_id: "r", code: "invalid_request", message: "bad id", retryable: false }, { status: 422 })),
  );
  renderApp("/decisions/not-a-uuid?kind=question");
  const status = await screen.findByText(NOT_FOUND);
  expect(status).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});

test("a bootstrap 403 is a genuine access failure: the access screen with a working Try again", async () => {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({}, { status: 403 })));
  renderApp("/overview");
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  expect(screen.getByText(/Your account does not have access to this dashboard/)).toBeInTheDocument();
  expect(document.title).toBe("Access denied — Agent Q");
  expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json(fixture)));
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
});

test("a resource 403 followed by a bootstrap 403 reaches the access screen and clears drafts", async () => {
  sessionStorage.setItem('aq.dashboard.draft:["x","1","k"]', '"private"');
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(
    http.get("/api/v1/sessions/sess-07", () => HttpResponse.json({}, { status: 403 })),
    http.get("/api/v1/bootstrap", () => HttpResponse.json({}, { status: 403 })),
  );
  await act(() => queryClient.refetchQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  await waitFor(() => expect(JSON.stringify(sessionStorage)).not.toMatch(/private/));
});

test("a 401 on any read is a sign-out: the sign-in screen, without Try again", async () => {
  const { queryClient } = renderApp("/agents/sess-07");
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(http.get("/api/v1/sessions/sess-07", () => HttpResponse.json({}, { status: 401 })));
  await act(() => queryClient.refetchQueries({ predicate: (q) => JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  expect(await screen.findByRole("heading", { name: "Sign in required" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
});
