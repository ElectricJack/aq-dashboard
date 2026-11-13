import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { InternalRun } from "./InternalRun";

vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
const ID = "00000000-0000-4000-8000-0000000000a1";
const base = { id: ID, purpose: "routing_classification", affected: { kind: "task", id: "T-1", project_id: null }, instructions: "Classify the task.", input: "Task: fix the login page", created_at_ms: 1000, escalation: "none" };
const answered = { ...base, status: "answered", answer: { choice: "small" }, attempts: [{ provider: "openai", model: "gpt-x", way: "api", reason: null, detail: "", elapsed_ms: 2400 }], provider: "openai", model: "gpt-x", way: "api", elapsed_ms: 2400, finished_at_ms: 3400 };
const failed = { ...base, status: "failed", reason: "provider_error", detail: "HTTP 500", finished_at_ms: 2000,
  attempts: [{ provider: "openai", model: "gpt-x", way: "api", reason: "provider_unavailable", detail: "HTTP 429", elapsed_ms: 300 }, { provider: "anthropic", model: "claude-y", way: "api", reason: "provider_error", detail: "HTTP 500", elapsed_ms: 500 }] };
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InternalRun affectedKind="task" affectedId="T-1" /></QueryClientProvider>);
}
const runs = (...items: unknown[]) => http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: items, next_cursor: null }));

test("shows who answered, how long it took, the answer and the collapsed request", async () => {
  let search = "";
  server.use(http.get("/api/internal-work/runs", ({ request }) => { search = new URL(request.url).search; return HttpResponse.json({ runs: [answered], next_cursor: null }); }));
  open();
  expect(await screen.findByText(/Answered by openai · gpt-x \(API\) in 2\.4 s/)).toBeVisible();
  expect(search).toBe("?affected_kind=task&affected_id=T-1&limit=1");
  expect(screen.getByLabelText("Answer")).toHaveTextContent('"choice": "small"');
  const asked = screen.getByText("What was asked").closest("details")!;
  expect(asked).not.toHaveAttribute("open");
  expect(within(asked).getByText("Classify the task.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("a failed run shows the error and each attempt", async () => {
  server.use(runs(failed));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Failed: provider error - HTTP 500");
  const attempts = within(screen.getByLabelText("Attempts")).getAllByRole("listitem");
  expect(attempts[0]).toHaveTextContent("openai · gpt-x (API), 300 ms: provider unavailable - HTTP 429");
  expect(attempts[1]).toHaveTextContent("anthropic · claude-y (API), 500 ms: provider error - HTTP 500");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("renders nothing when the item has no run", async () => {
  let asked = false;
  server.use(http.get("/api/internal-work/runs", () => { asked = true; return HttpResponse.json({ runs: [], next_cursor: null }); }));
  open();
  await waitFor(() => expect(asked).toBe(true));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(screen.queryByLabelText("Internal work")).not.toBeInTheDocument();
  expect(screen.queryByText("Internal work")).not.toBeInTheDocument();
});

test("Retry posts for the failed run and then shows the new run", async () => {
  const fresh = { ...base, id: "00000000-0000-4000-8000-0000000000b1", status: "queued", attempts: [], retry_of: ID };
  let retried: string | null = null, header: string | null = null;
  server.use(
    http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [retried ? fresh : failed], next_cursor: null })),
    http.post("/api/internal-work/runs/:id/retry", ({ params, request }) => { retried = String(params.id); header = request.headers.get("X-AQ-Request"); return HttpResponse.json({ id: fresh.id }); }),
  );
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Waiting for a model.")).toBeVisible();
  expect(retried).toBe(ID);
  expect(header).toBe("1");
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("a refused retry says so and keeps the button", async () => {
  server.use(runs(failed), http.post("/api/internal-work/runs/:id/retry", () => HttpResponse.json({ error: "conflict", message: "Only a failed run can be retried" }, { status: 409 })));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("The retry could not be started.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});
