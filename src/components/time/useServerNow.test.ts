import { act, renderHook } from "@testing-library/react";
import { vi } from "vitest";
import { useServerNow } from "./useServerNow";

afterEach(() => vi.useRealTimers());

test("advances from the server anchor by monotonic elapsed time and re-renders on a tick", () => {
  vi.useFakeTimers();
  let mono = 1_000;
  const { result } = renderHook(() =>
    useServerNow(
      { serverTime: "2026-10-31T12:00:00.000Z", receivedAt: 1_000 },
      { now: () => mono, tickMs: 10_000 },
    ),
  );
  expect(result.current).toBe("2026-10-31T12:00:00.000Z");
  mono = 91_000;
  act(() => vi.advanceTimersByTime(10_000));
  expect(result.current).toBe("2026-10-31T12:01:30.000Z");
});

test("returns null without an anchor", () => {
  const { result } = renderHook(() => useServerNow(undefined));
  expect(result.current).toBeNull();
});
