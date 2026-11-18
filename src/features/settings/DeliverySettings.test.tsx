import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { DeliverySettings } from "./DeliverySettings";

vi.mock("../../app/session", () => ({ useSession: () => ({ queryContext: { principalId: "p", authorizationRevision: "1", contractVersion: "1" } }) }));
// The delivery routes: GET {markdown, revision} / {limits, revision}; PUT {..., expected_revision, operation_id} answers {revision}.
const documentPath = "/api/settings/delivery-document";
const limitsPath = "/api/settings/delivery-limits";
const document = () => ({ markdown: "# Delivery\n", revision: "1" });
const limits = () => ({ limits: { main_sync_interval_ms: 30_000, main_freshness_ms: 120_000, decision_repeat_ms: 60_000, longest_check_wait_ms: 1_800_000, git_transfer_timeout_ms: 300_000, max_push_bytes: 104_857_600 }, revision: "5" });
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><DeliverySettings /></QueryClientProvider>);
  return client;
}
const readable = () => server.use(http.get(documentPath, () => HttpResponse.json(document())), http.get(limitsPath, () => HttpResponse.json(limits())));

test("a server without delivery shows the unavailable notice, not an error", async () => {
  server.use(http.get(documentPath, () => HttpResponse.json({ error: "not_found", message: "no" }, { status: 404 })), http.get(limitsPath, () => HttpResponse.json({ error: "not_found", message: "no" }, { status: 404 })));
  open();
  expect(await screen.findByText("Delivery is not available on this server")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByLabelText("Markdown")).toBeNull();
  expect(screen.queryByRole("button", { name: /Try again/ })).toBeNull();
});

test("shows the document and the limits in human units", async () => {
  readable(); open();
  expect(await screen.findByLabelText("Markdown")).toHaveValue("# Delivery\n");
  expect(await screen.findByLabelText("Main sync interval")).toHaveValue("30");
  expect(screen.getByLabelText("Main freshness")).toHaveValue("120");
  expect(screen.getByLabelText("Decision repeat")).toHaveValue("60");
  expect(screen.getByLabelText("Longest check wait")).toHaveValue("30");
  expect(screen.getByLabelText("Git transfer timeout")).toHaveValue("300");
  expect(screen.getByLabelText("Largest push")).toHaveValue("100");
  expect(screen.getByRole("button", { name: "Save the delivery document" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Save the delivery limits" })).toBeDisabled();
});

test("saves the exact Markdown at the revision read just before the save", async () => {
  let data = document(); let submitted: Record<string, unknown> | undefined;
  server.use(http.get(documentPath, () => HttpResponse.json(data)), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(documentPath, async ({ request }) => { submitted = await request.json() as Record<string, unknown>; return HttpResponse.json({ revision: "3" }); }));
  open(); const editor = await screen.findByLabelText("Markdown");
  fireEvent.change(editor, { target: { value: "  # Héllo\n\n" } });
  // Another settings change moved the revision; the text is the one the edit started from.
  data = { ...data, revision: "2" };
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery document" }));
  expect(await screen.findByText("Delivery document saved.")).toBeVisible();
  expect(submitted).toEqual({ operation_id: expect.any(String), expected_revision: "2", markdown: "  # Héllo\n\n" });
});

test("a reverted edit is not a change", async () => {
  readable(); open(); const editor = await screen.findByLabelText("Markdown");
  fireEvent.change(editor, { target: { value: "changed" } });
  expect(screen.getByRole("button", { name: "Save the delivery document" })).toBeEnabled();
  fireEvent.change(editor, { target: { value: "# Delivery\n" } });
  expect(screen.getByRole("button", { name: "Save the delivery document" })).toBeDisabled();
});

test("a stale document save keeps the draft until the owner reloads", async () => {
  let data = document();
  server.use(http.get(documentPath, () => HttpResponse.json(data)), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(documentPath, () => HttpResponse.json({}, { status: 409 })));
  open(); const editor = await screen.findByLabelText("Markdown"); fireEvent.change(editor, { target: { value: "draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery document" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("edits are preserved"); expect(editor).toHaveValue("draft");
  data = { markdown: "latest", revision: "2" };
  await userEvent.click(screen.getByRole("button", { name: "Reload the delivery document" }));
  await waitFor(() => expect(editor).toHaveValue("latest"));
});

test("a document that changed elsewhere since the edit started is not overwritten", async () => {
  let data = document(); let puts = 0;
  server.use(http.get(documentPath, () => HttpResponse.json(data)), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(documentPath, () => { puts++; return HttpResponse.json({ revision: "3" }); }));
  open(); fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "draft" } });
  data = { markdown: "someone else", revision: "2" };
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery document" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("changed elsewhere"); expect(puts).toBe(0);
});

test("checking a save whose answer was lost sends the exact operation again", async () => {
  const requests: Record<string, unknown>[] = [];
  server.use(http.get(documentPath, () => HttpResponse.json(document())), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(documentPath, async ({ request }) => {
    requests.push(await request.json() as Record<string, unknown>);
    return requests.length === 1 ? HttpResponse.error() : HttpResponse.json({ revision: "2" });
  }));
  open(); fireEvent.change(await screen.findByLabelText("Markdown"), { target: { value: "draft" } });
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery document" }));
  await userEvent.click(await screen.findByRole("button", { name: "Check save status" }));
  await screen.findByText("Delivery document saved."); expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0]);
});

test("limits are sent in milliseconds and bytes with the revision read", async () => {
  let submitted: Record<string, unknown> | undefined;
  server.use(http.get(documentPath, () => HttpResponse.json(document())), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(limitsPath, async ({ request }) => { submitted = await request.json() as Record<string, unknown>; return HttpResponse.json({ revision: "6" }); }));
  open();
  fireEvent.change(await screen.findByLabelText("Main sync interval"), { target: { value: "45" } });
  fireEvent.change(screen.getByLabelText("Longest check wait"), { target: { value: "0.5" } });
  fireEvent.change(screen.getByLabelText("Largest push"), { target: { value: "2" } });
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery limits" }));
  expect(await screen.findByText("Delivery limits saved.")).toBeVisible();
  expect(submitted).toEqual({ operation_id: expect.any(String), expected_revision: "5", limits: { ...limits().limits, main_sync_interval_ms: 45_000, longest_check_wait_ms: 30_000, max_push_bytes: 2_097_152 } });
  expect(screen.getByRole("button", { name: "Save the delivery limits" })).toBeDisabled();
});

test("an invalid limit says why and cannot be saved", async () => {
  readable(); open();
  const field = await screen.findByLabelText("Main freshness");
  fireEvent.change(field, { target: { value: "soon" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Main freshness: Enter a number");
  expect(field).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("button", { name: "Save the delivery limits" })).toBeDisabled();
  fireEvent.change(field, { target: { value: "0" } });
  expect(screen.getByRole("alert")).toHaveTextContent("Must be more than zero");
  fireEvent.change(field, { target: { value: "120" } });
  expect(screen.queryByRole("alert")).toBeNull();
});

test("a refused limits save shows the server's words and keeps the edit", async () => {
  server.use(http.get(documentPath, () => HttpResponse.json(document())), http.get(limitsPath, () => HttpResponse.json(limits())), http.put(limitsPath, () => HttpResponse.json({ error: "invalid", message: "Largest push is above what this server allows" }, { status: 422 })));
  open();
  fireEvent.change(await screen.findByLabelText("Largest push"), { target: { value: "99999" } });
  await userEvent.click(screen.getByRole("button", { name: "Save the delivery limits" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Largest push is above what this server allows");
  expect(screen.getByLabelText("Largest push")).toHaveValue("99999");
});
