import { act, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import fixture from "../../contracts/proposed/bootstrap.json";
import { shouldRetryRead } from "../api/retry";
import { handlersFor } from "../mocks/handlers";
import { renderApp } from "../test/renderApp";

const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const unavailable = () => HttpResponse.json({ request_id: "r", code: "unavailable", message: "This request is temporarily unavailable", retryable: true }, { status: 503 });

/** The app's read retry policy (App.tsx) with a test-sized backoff. */
async function refuseSessionDetail(bootstrap: (read: number) => Response) {
  let reads = 0;
  const app = renderApp("/agents/sess-07");
  app.queryClient.setDefaultOptions({ queries: { ...app.queryClient.getDefaultOptions().queries, retry: shouldRetryRead, retryDelay: () => 5 } });
  await screen.findByRole("region", { name: "Worker 07" });
  server.use(
    http.get("/api/v1/sessions/sess-07", () => HttpResponse.json({}, { status: 403 })),
    http.get("/api/v1/bootstrap", () => bootstrap(++reads)),
  );
  await act(() => app.queryClient.refetchQueries({ predicate: (q) => q.queryKey[0] === "aq" && JSON.stringify(q.queryKey).includes("/api/v1/sessions/sess-07") }));
  return { ...app, reads: () => reads };
}

// WDR-02: one transient bootstrap 503 during the post-403 re-check must not replace the app.
test("the bootstrap re-check after a 403 retries a retryable 503 before concluding", async () => {
  const { reads } = await refuseSessionDetail((read) => read === 1 ? unavailable() : HttpResponse.json(fixture));
  expect(await screen.findByText("This item does not exist or is not available to you.")).toBeInTheDocument();
  await waitFor(() => expect(reads()).toBe(2));
  // Give the re-check time to settle: the refusal stays in its pane and the shell stays.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole("heading", { name: "Access not confirmed" })).not.toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Primary" })).toBeInTheDocument();
});

test("the re-check retries a 429 too, and fails closed only once retries are exhausted", async () => {
  const { reads } = await refuseSessionDetail(() => HttpResponse.json({ request_id: "r", code: "rate_limited", message: "Slow down", retryable: true }, { status: 429 }));
  expect(await screen.findByRole("heading", { name: "Access not confirmed" })).toBeInTheDocument();
  // The first read plus the policy's three retries.
  expect(reads()).toBe(4);
});

test("a definitive bootstrap refusal on the re-check is not retried", async () => {
  const { reads } = await refuseSessionDetail(() => HttpResponse.json({ request_id: "r", code: "forbidden", message: "No access", retryable: false }, { status: 403 }));
  expect(await screen.findByRole("heading", { name: "Access denied" })).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(reads()).toBe(1);
});

test("Try again on the gate uses the same retry policy", async () => {
  let fail = true;
  const { reads } = await refuseSessionDetail((read) => fail || read % 2 === 1 ? unavailable() : HttpResponse.json(fixture));
  expect(await screen.findByRole("heading", { name: "Access not confirmed" })).toBeInTheDocument();
  const before = reads();
  fail = false;
  // The next read fails once more (odd), then succeeds: one click is enough.
  await act(async () => { screen.getByRole("button", { name: "Try again" }).click(); });
  expect(await screen.findByRole("navigation", { name: "Primary" })).toBeInTheDocument();
  expect(reads()).toBeGreaterThan(before + 1);
});
