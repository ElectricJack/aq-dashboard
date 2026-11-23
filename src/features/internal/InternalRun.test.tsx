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
/** By default the read of one run is not found; a run with no transcript to show must still render. */
const server = setupServer(http.get("/api/internal-work/runs/:id", () => HttpResponse.json({ error: "not_found", message: "Internal run not found" }, { status: 404 })));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open() {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><InternalRun affectedKind="task" affectedId="T-1" pollMs={20} /></QueryClientProvider>);
}
/** Like the server: the list never carries transcripts, the read of one run does. */
const runs = (...items: unknown[]) => [
  http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: items.map(({ transcripts: _omitted, ...rest }: any) => rest), next_cursor: null })),
  http.get("/api/internal-work/runs/:id", ({ params }) => { const item = items.find((one: any) => one.id === params.id); return item ? HttpResponse.json(item) : HttpResponse.json({ error: "not_found", message: "no" }, { status: 404 }); }),
];

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
  server.use(...runs(failed));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Failed: provider error - HTTP 500");
  const attempts = within(screen.getByLabelText("Attempts")).getAllByRole("listitem");
  expect(attempts[0]!).toHaveTextContent("openai · gpt-x (API), 300 ms: provider unavailable - HTTP 429");
  expect(attempts[1]!).toHaveTextContent("anthropic · claude-y (API), 500 ms: provider error - HTTP 500");
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

test("renders nothing when the item has no run", async () => {
  let asked = 0;
  server.use(http.get("/api/internal-work/runs", () => { asked++; return HttpResponse.json({ runs: [], next_cursor: null }); }));
  open();
  await waitFor(() => expect(asked).toBe(1));
  await waitFor(() => expect(screen.queryByText("Internal work could not be loaded.")).not.toBeInTheDocument());
  expect(screen.queryByLabelText("Internal work")).not.toBeInTheDocument();
  expect(screen.queryByText("Internal work")).not.toBeInTheDocument();
  expect(asked).toBe(1);
});

test("a running run is followed until it is answered, then polling stops", async () => {
  let reads = 0;
  server.use(http.get("/api/internal-work/runs", () => { reads++; return HttpResponse.json({ runs: [reads === 1 ? { ...base, status: "running", attempts: [] } : answered], next_cursor: null }); }));
  open();
  expect(await screen.findByText("A model is working on it.")).toBeVisible();
  expect(await screen.findByText(/Answered by openai/)).toBeVisible();
  const settled = reads;
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(reads).toBe(settled);
});

test("a run already in a final state is read once", async () => {
  let reads = 0;
  server.use(http.get("/api/internal-work/runs", () => { reads++; return HttpResponse.json({ runs: [failed], next_cursor: null }); }));
  open();
  await screen.findByRole("button", { name: "Retry" });
  await new Promise(resolve => setTimeout(resolve, 100));
  expect(reads).toBe(1);
});

test("Retry posts for the failed run, then follows the new run to its outcome", async () => {
  const fresh = { ...base, id: "00000000-0000-4000-8000-0000000000b1", status: "queued", attempts: [], retry_of: ID };
  let retried: string | null = null, header: string | null = null;
  let modelAnswered = false;
  server.use(
    http.get("/api/internal-work/runs", () => {
      if (!retried) return HttpResponse.json({ runs: [failed], next_cursor: null });
      return HttpResponse.json({ runs: [modelAnswered ? { ...fresh, ...answered, id: fresh.id, retry_of: ID } : fresh], next_cursor: null });
    }),
    http.post("/api/internal-work/runs/:id/retry", ({ params, request }) => { retried = String(params.id); header = request.headers.get("X-AQ-Request"); return HttpResponse.json({ id: fresh.id }); }),
  );
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Waiting for a model.")).toBeVisible();
  expect(retried).toBe(ID);
  expect(header).toBe("1");
  modelAnswered = true;
  expect(await screen.findByText(/Answered by openai/)).toBeVisible();
  expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
});

test("a refused retry says so and keeps the button", async () => {
  server.use(...runs(failed), http.post("/api/internal-work/runs/:id/retry", () => HttpResponse.json({ error: "conflict", message: "Only a failed run can be retried" }, { status: 409 })));
  open();
  await userEvent.click(await screen.findByRole("button", { name: "Retry" }));
  expect(await screen.findByText("The retry could not be started.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
});

const agentBase = { ...base, purpose: "playbook_compilation", instructions: "Author the playbook.", input: "Document: routing" };
const longOutput = `${"line of tool output ".repeat(60)}END-OF-CLIPPED-TEXT`;
const transcripts = [{ candidate_index: 0, events: [
  { kind: "text", text: "I will read the document." },
  { kind: "tool", tool: "shell", input: "cat docs/routing.md" },
  { kind: "result", output: longOutput, error: false, clipped: true },
  { kind: "tool", tool: "shell", input: "curl http://x" },
  { kind: "result", output: "no network", error: true },
  { kind: "text", text: "token is [credential redacted] here" },
  { kind: "error", text: "usage limit" },
  { kind: "clipped" },
] }];
const agentAnswered = { ...agentBase, status: "answered", answer: { question: "Which sentence?" }, provider: "anthropic", model: "claude-y", way: "login", elapsed_ms: 90_000,
  attempts: [{ provider: "anthropic", model: "claude-y", way: "login", reason: null, detail: "", elapsed_ms: 90_000 }], transcripts };

test("shows the agent's steps for an agent run", async () => {
  server.use(...runs(agentAnswered));
  open();
  const steps = await screen.findByLabelText("Agent steps");
  const items = within(steps).getAllByRole("listitem");
  expect(items[0]!).toHaveTextContent("I will read the document.");
  expect(items[1]!).toHaveTextContent("Tool: shell");
  expect(items[1]!).toHaveTextContent("cat docs/routing.md");
  expect(items[4]!).toHaveTextContent("Result (failed)");
  expect(items[4]!).toHaveTextContent("no network");
  expect(items[5]!).toHaveTextContent("[credential redacted]");
  expect(within(items[5]!).getByText("[credential redacted]").tagName).toBe("MARK");
  expect(items[6]!).toHaveTextContent("Error: usage limit");
  expect(steps).toHaveTextContent("The server cut this transcript short.");
  expect(screen.getByLabelText("Answer")).toHaveTextContent("Which sentence?");
});

test("clips long tool output, marks server clipping, and expands to the server text", async () => {
  server.use(...runs(agentAnswered));
  open();
  const steps = await screen.findByLabelText("Agent steps");
  const result = within(steps).getAllByRole("listitem")[2]!;
  expect(result).toHaveTextContent("clipped by the server");
  expect(result).not.toHaveTextContent("END-OF-CLIPPED-TEXT");
  await userEvent.click(within(result).getByRole("button", { name: "Show all" }));
  expect(result).toHaveTextContent("END-OF-CLIPPED-TEXT");
  await userEvent.click(within(result).getByRole("button", { name: "Show less" }));
  expect(result).not.toHaveTextContent("END-OF-CLIPPED-TEXT");
});

test("transcript text is shown as text, never as markup or links", async () => {
  const html = '<img src=x onerror="alert(1)"> <a href="javascript:alert(1)">go</a>';
  server.use(...runs({ ...agentAnswered, transcripts: [{ candidate_index: 0, events: [{ kind: "text", text: html }] }] }));
  open();
  const steps = await screen.findByLabelText("Agent steps");
  expect(steps).toHaveTextContent(html);
  expect(steps.querySelector("img, a")).toBeNull();
});

test("an agent run that saved nothing shows the server's reason and message", async () => {
  server.use(...runs({ ...agentBase, status: "failed", reason: "invalid_output", detail: "the agent ended without saving, asking or giving up", finished_at_ms: 5,
    attempts: [{ provider: "openai", model: "gpt-x", way: "login", reason: "login_busy", detail: "codex login busy", elapsed_ms: 5 }, { provider: "openai", model: "gpt-x", way: "login", reason: "timeout", detail: "codex did not finish within 3 s", elapsed_ms: 3000 }],
    transcripts: [{ candidate_index: 1, events: [{ kind: "text", text: "Working." }] }] }));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Failed: invalid output - the agent ended without saving, asking or giving up");
  const attempts = within(screen.getByLabelText("Attempts")).getAllByRole("listitem");
  expect(attempts[0]!).toHaveTextContent("login busy - codex login busy");
  expect(attempts[1]!).toHaveTextContent("codex did not finish within 3 s");
  expect(await screen.findByLabelText("Agent steps")).toHaveTextContent("Working.");
});

test("a run with no transcript shows no agent steps", async () => {
  server.use(...runs(answered));
  open();
  await screen.findByText(/Answered by openai/);
  expect(screen.queryByLabelText(/Agent steps/)).not.toBeInTheDocument();
  expect(screen.queryByText(/What the agent did/)).not.toBeInTheDocument();
});

test("when the steps cannot be read the run still shows its outcome", async () => {
  server.use(http.get("/api/internal-work/runs", () => HttpResponse.json({ runs: [agentAnswered], next_cursor: null })));
  open();
  expect(await screen.findByText(/Answered by anthropic/)).toBeVisible();
  await waitFor(() => expect(screen.queryByLabelText(/Agent steps/)).not.toBeInTheDocument());
});

test("one transcript is labelled without a number, several by position", async () => {
  server.use(...runs({ ...agentAnswered, transcripts: [{ candidate_index: 0, events: [{ kind: "text", text: "First." }] }, { candidate_index: 3, events: [{ kind: "text", text: "Second." }] }] }));
  open();
  expect(await screen.findByLabelText("Agent steps, run 1 of 2")).toHaveTextContent("First.");
  expect(screen.getByLabelText("Agent steps, run 2 of 2")).toHaveTextContent("Second.");
  expect(screen.getByText("What the agent did (run 2 of 2)")).toBeVisible();
});

test("a run that is not an agent run reads its detail only when the owner opens it", async () => {
  let reads = 0;
  server.use(http.get(`/api/internal-work/runs/${ID}`, () => { reads++; return HttpResponse.json(answered); }), ...runs(answered));
  open();
  await screen.findByText(/Answered by openai/);
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(reads).toBe(0);
  await userEvent.click(screen.getByText("What was asked"));
  await waitFor(() => expect(reads).toBe(1));
});

test("an agent run reads its detail without being opened", async () => {
  let reads = 0;
  server.use(http.get(`/api/internal-work/runs/${ID}`, () => { reads++; return HttpResponse.json(agentAnswered); }), ...runs(agentAnswered));
  open();
  await screen.findByLabelText("Agent steps");
  expect(reads).toBe(1);
});
