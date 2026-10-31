import { formatAge, formatElapsed, formatUntil } from "./relative";

const NOW = "2026-10-31T12:00:00.000Z";

test.each([
  ["2026-10-31T12:00:40.000Z", "in 40s"],
  ["2026-10-31T12:05:00.000Z", "in 5m"],
  ["2026-10-31T18:00:00.000Z", "in 6h"],
  ["2026-11-02T12:00:00.000Z", "in 2d"],
])("formatUntil(%s) is %s", (target, expected) => {
  expect(formatUntil(NOW, target)).toBe(expected);
});

test("formatUntil reports a passed time as due", () => {
  expect(formatUntil(NOW, "2026-10-31T11:00:00.000Z")).toBe("due now");
});

test.each([
  ["2026-10-31T11:59:58.000Z", "2s ago"],
  ["2026-10-31T11:48:00.000Z", "12m ago"],
  ["2026-10-31T09:00:00.000Z", "3h ago"],
])("formatAge(%s) is %s", (observed, expected) => {
  expect(formatAge(NOW, observed)).toBe(expected);
});

test("unparseable timestamps format as unknown", () => {
  expect(formatAge(NOW, "garbage")).toBe("unknown time");
  expect(formatUntil(NOW, "garbage")).toBe("unknown time");
});

test("formatElapsed gives a bare duration", () => {
  expect(formatElapsed(NOW, "2026-10-31T11:42:00.000Z")).toBe("18m");
});
