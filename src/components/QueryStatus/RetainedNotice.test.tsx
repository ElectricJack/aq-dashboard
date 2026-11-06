import { act, render, screen } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { RetainedNotice } from "./RetainedNotice";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

function setOnline(value: boolean) {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(value);
  window.dispatchEvent(new Event(value ? "online" : "offline"));
}

test("SO-13: a failed refresh marks the retained read with its age", () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-11-06T12:00:00Z"));
  const read = Date.parse("2026-11-06T11:57:00Z");
  render(<RetainedNotice query={{ data: {}, dataUpdatedAt: read, isError: true }} />);
  expect(screen.getByRole("status")).toHaveTextContent("Refresh failed. Showing data read 3m ago, which may be out of date.");
  act(() => { vi.setSystemTime(new Date("2026-11-06T12:02:00Z")); vi.advanceTimersByTime(15_000); });
  expect(screen.getByRole("status")).toHaveTextContent("Showing data read 5m ago");
});

test("SO-13: offline marks retained data even though paused queries never fail", () => {
  setOnline(false);
  render(<RetainedNotice query={{ data: {}, dataUpdatedAt: Date.now() - 20_000, isError: false }} />);
  expect(screen.getByRole("status")).toHaveTextContent(/^Offline\. Showing data read 20s ago; it will refresh when you reconnect\.$/);
});

test("a current read, or no retained data, shows nothing", () => {
  setOnline(true);
  const { container, rerender } = render(<RetainedNotice query={{ data: {}, dataUpdatedAt: Date.now(), isError: false }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<RetainedNotice query={{ data: undefined, dataUpdatedAt: 0, isError: true }} />);
  expect(container).toBeEmptyDOMElement();
});
