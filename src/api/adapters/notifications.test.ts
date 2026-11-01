import { adaptNotificationDetail, adaptNotificationPage, mergeNotificationPages } from "./notifications";
import { notificationDetail, notificationRecipient, notificationRow, notifyId } from "../../test/notificationInspection";
const page = (items = [notificationRow()], next_after: number | null = null) => ({ items, next_after });
test("inbox retains exact own-recipient scope and no-route is distinct from delivery", () => {
  const row = notificationRow(); row.external_state = "no_external_route";
  const p = adaptNotificationPage(page([row]), notificationRecipient, 0);
  expect(p.items[0]!.routing).toBe("no_external_route");
  expect(adaptNotificationDetail(notificationDetail("queued", row), p.items[0]!).deliveries).toEqual([]);
});
test.each(["queued", "dispatching", "accepted_by_transport", "delivery_unknown", "retry_scheduled", "permanently_failed", "suppressed"])("%s status remains separate from human acknowledgment", kind => {
  const detail = adaptNotificationDetail(notificationDetail(kind), adaptNotificationPage(page(), notificationRecipient, 0).items[0]!);
  expect(detail.deliveries[0]!.kind).toBe(kind); expect(detail.deliveries[0]!.human).toBe("Not acknowledged"); expect(detail.deliveries[0]!.decision).toBe("No decision attached");
});
test("future delivery state stays unsupported", () => {
  expect(adaptNotificationDetail(notificationDetail("future_state"), adaptNotificationPage(page(), notificationRecipient, 0).items[0]!).deliveries[0]!.label).toBe("Unsupported delivery status");
});
test("foreign recipient, unsafe counters, wrong detail or changed message refuse", () => {
  expect(() => adaptNotificationPage(page(), notifyId(9), 0)).toThrow();
  expect(() => adaptNotificationPage(page([{ ...notificationRow(), sequence: Number.MAX_SAFE_INTEGER + 1 }]), notificationRecipient, 0)).toThrow();
  const expected = adaptNotificationPage(page(), notificationRecipient, 0).items[0]!;
  const changed = notificationDetail(); changed.message.summary = "changed private body";
  expect(() => adaptNotificationDetail(changed, expected)).toThrow();
  const foreign = notificationDetail(); foreign.message.scope.workspace_id = notifyId(90);
  expect(() => adaptNotificationDetail(foreign, expected)).toThrow();
});
test("cursor and cross-page ordering/id bounds prevent invented or duplicate pages", () => {
  expect(() => adaptNotificationPage(page([notificationRow(2), notificationRow(1)]), notificationRecipient, 0)).toThrow();
  expect(() => adaptNotificationPage(page([notificationRow()], 1), notificationRecipient, 0)).toThrow();
  const one = adaptNotificationPage(page(), notificationRecipient, 0);
  expect(() => mergeNotificationPages([one, one])).toThrow();
  const rows = Array.from({ length: 16 }, (_, i) => notificationRow(i + 1));
  expect(adaptNotificationPage(page(rows, 16), notificationRecipient, 0).next).toBe(16);
});
test("malformed summaries, clocks and oversized responses refuse", () => {
  const row = notificationRow(); row.message.summary = "x\u0000";
  expect(() => adaptNotificationPage(page([row]), notificationRecipient, 0)).toThrow();
  row.message.summary = "x".repeat(1601);
  expect(() => adaptNotificationPage(page([row]), notificationRecipient, 0)).toThrow();
  row.message.summary = "valid"; row.message.expires_at_ms = row.message.created_at_ms;
  expect(() => adaptNotificationPage(page([row]), notificationRecipient, 0)).toThrow();
  expect(() => adaptNotificationPage({ ...page(), extra: "x".repeat(131072) }, notificationRecipient, 0)).toThrow();
});
