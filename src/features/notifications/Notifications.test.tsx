import { screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import bootstrap from "../../../contracts/proposed/bootstrap.json";
import { handlersFor } from "../../mocks/handlers";
import { renderApp } from "../../test/renderApp";
import { notificationRecipient, notificationRow, notificationDetail } from "../../test/notificationInspection";
const server = setupServer(...handlersFor("default"));
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers()); afterAll(() => server.close());
function setup(enabled = true) {
  server.use(http.get("/api/v1/bootstrap", () => HttpResponse.json({ ...bootstrap, data: { ...bootstrap.data, principal: { ...bootstrap.data.principal, id: notificationRecipient }, capabilities: [...bootstrap.data.capabilities.filter(c => c.name !== "notifications.read"), { name: "notifications.read", version: "1", enabled, reason: "Notification inspection unavailable" }] } })));
}
test("disabled capability never requests notifications", async () => {
  setup(false); let calls = 0; server.use(http.get("/api/notifications", () => { calls++; return HttpResponse.json({}); }));
  renderApp("/settings"); await screen.findByText("Notification inspection unavailable"); expect(calls).toBe(0);
});
test("successful empty inbox differs from failure and no send controls are offered", async () => {
  setup(); server.use(http.get("/api/notifications", () => HttpResponse.json({ items: [], next_after: null })));
  renderApp("/settings"); await screen.findByText("No notifications in this inbox.");
  expect(screen.queryByRole("button", { name: /Send notification|Retry delivery/ })).toBeNull();
});
test("detail requires explicit selection and distinguishes accepted transport from human acknowledgment", async () => {
  setup(); let inspections = 0;
  server.use(http.get("/api/notifications", ({ request }) => { const q = new URL(request.url).searchParams; expect(q.has("recipient")).toBe(false); expect(q.get("limit")).toBe("16"); return HttpResponse.json({ items: [notificationRow()], next_after: null }); }),
    http.get("/api/notifications/:id", () => { inspections++; return HttpResponse.json(notificationDetail("accepted_by_transport")); }));
  renderApp("/settings"); const inbox = await screen.findByRole("list", { name: "Notification inbox" }); expect(inspections).toBe(0);
  await userEvent.click(within(inbox).getByRole("button")); const detail = await screen.findByRole("region", { name: "Notification delivery details" });
  await within(detail).findByText("Accepted by transport"); expect(detail).toHaveTextContent("Not acknowledged · No decision attached"); expect(inspections).toBe(1);
  expect(within(detail).queryByRole("button", { name: /retry/i })).toBeNull();
});
test("uncertain delivery shows actual duplicate risk and literal summary text", async () => {
  setup(); const row = notificationRow(); row.message.summary = "<img src=x> private summary";
  server.use(http.get("/api/notifications", () => HttpResponse.json({ items: [row], next_after: null })), http.get("/api/notifications/:id", () => HttpResponse.json(notificationDetail("delivery_unknown", row))));
  renderApp("/settings"); const inbox = await screen.findByRole("list", { name: "Notification inbox" }); await userEvent.click(within(inbox).getByRole("button"));
  const detail = await screen.findByRole("region", { name: "Notification delivery details" }); await within(detail).findByText("Delivery unknown");
  expect(detail).toHaveTextContent("Duplicate-risk retries: 1"); expect(detail.querySelector("img")).toBeNull();
});
test("paging is explicit, uses exact safe sequence and keeps recipient implicit", async () => {
  setup(); let calls = 0;
  server.use(http.get("/api/notifications", ({ request }) => { calls++; const q = new URL(request.url).searchParams; expect(q.has("recipient")).toBe(false);
    return q.get("after") === "0" ? HttpResponse.json({ items: Array.from({ length: 16 }, (_, i) => notificationRow(i + 1)), next_after: 16 }) : HttpResponse.json({ items: [notificationRow(17)], next_after: null }); }));
  renderApp("/settings"); await screen.findByText("Notification 16: inspect recorded delivery"); expect(calls).toBe(1);
  await userEvent.click(screen.getByRole("button", { name: "Load more notifications" })); await screen.findByText("Notification 17: inspect recorded delivery"); expect(calls).toBe(2);
});
test("refused detail clears its body instead of retaining successful private content", async () => {
  setup(); let reads = 0;
  server.use(http.get("/api/notifications", () => HttpResponse.json({ items: [notificationRow()], next_after: null })), http.get("/api/notifications/:id", () => ++reads === 1 ? HttpResponse.json(notificationDetail()) : HttpResponse.json({}, { status: 404 })));
  renderApp("/settings"); await userEvent.click(within(await screen.findByRole("list", { name: "Notification inbox" })).getByRole("button")); const detail = await screen.findByRole("region", { name: "Notification delivery details" }); await within(detail).findByText("Queued");
  await userEvent.click(within(detail).getByRole("button", { name: "Refresh delivery" })); await within(detail).findByText(/does not exist or is not available/); expect(within(detail).queryByText("Queued")).toBeNull();
});
test("failed inbox does not look empty and explicit refresh recovers", async () => {
  setup(); let reads = 0; server.use(http.get("/api/notifications", () => ++reads === 1 ? HttpResponse.json({}, { status: 503 }) : HttpResponse.json({ items: [], next_after: null })));
  renderApp("/settings"); const panel = await screen.findByRole("region", { name: "Your notifications" }); await within(panel).findByRole("alert"); expect(screen.queryByText("No notifications in this inbox.")).toBeNull();
  await userEvent.click(within(panel).getByRole("button", { name: "Try again" })); await within(panel).findByText("No notifications in this inbox.");
});
test("foreign-recipient response is a protected contract failure", async () => {
  setup(); const row = notificationRow(); row.message.recipient_user_id = "foreign";
  server.use(http.get("/api/notifications", () => HttpResponse.json({ items: [row], next_after: null })));
  renderApp("/settings"); await waitFor(() => expect(screen.getByRole("heading", { name: "Dashboard update required" })).toBeInTheDocument()); expect(screen.queryByRole("list", { name: "Notification inbox" })).toBeNull();
});
