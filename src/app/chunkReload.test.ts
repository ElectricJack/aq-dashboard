import { vi } from "vitest";
import { installPreloadErrorHandler, isChunkLoadError, RELOAD_GUARD_MS, reloadOnceForUpdate } from "./chunkReload";

beforeEach(() => window.sessionStorage.clear());
afterEach(() => vi.restoreAllMocks());

test("recognises chunk and CSS preload failures only", () => {
  expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/overview-x.css"))).toBe(true);
  expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: /a.js"))).toBe(true);
  expect(isChunkLoadError(new Error("boom"))).toBe(false);
  expect(isChunkLoadError(undefined)).toBe(false);
});

test("reloads once, then refuses inside the guard window and allows again after it", () => {
  const reload = vi.fn();
  expect(reloadOnceForUpdate(1_000_000, reload)).toBe(true);
  expect(reloadOnceForUpdate(1_000_000 + 1000, reload)).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  expect(reloadOnceForUpdate(1_000_000 + RELOAD_GUARD_MS + 1, reload)).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});

test("does not reload when session storage is unavailable", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  const reload = vi.fn();
  expect(reloadOnceForUpdate(5, reload)).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

test("vite:preloadError is prevented only when a reload was started", () => {
  const reload = vi.fn();
  vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload } as Location);
  const remove = installPreloadErrorHandler();
  const first = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(first);
  expect(first.defaultPrevented).toBe(true);
  expect(reload).toHaveBeenCalledTimes(1);
  const second = new Event("vite:preloadError", { cancelable: true });
  window.dispatchEvent(second);
  expect(second.defaultPrevented).toBe(false);
  expect(reload).toHaveBeenCalledTimes(1);
  remove();
});
