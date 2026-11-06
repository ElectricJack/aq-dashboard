/** Recovery from stale hashed route chunks after the dashboard bundle is rebuilt or the server restarts. */

const STORAGE_KEY = "aq-dashboard:chunk-reload-at";
/** A second chunk failure within this window shows the friendly state instead of reloading again. */
export const RELOAD_GUARD_MS = 30_000;

const CHUNK_ERROR = /Unable to preload CSS|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (CSS )?chunk [^\s]+ failed/i;

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === "string" ? error : "";
  return CHUNK_ERROR.test(message);
}

/**
 * Reloads the page once so it picks up the new index. Returns false (without reloading)
 * when a reload already happened within the guard window, so failures never loop.
 */
export function reloadOnceForUpdate(now: number = Date.now(), reload: () => void = () => window.location.reload()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(STORAGE_KEY));
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(STORAGE_KEY, String(now));
  } catch {
    // Storage unavailable: we cannot guard against loops, so do not auto-reload.
    return false;
  }
  reload();
  return true;
}

/** Handles Vite's `vite:preloadError`, which fires when a chunk or its CSS fails to preload. */
export function installPreloadErrorHandler(): () => void {
  const handler = (event: Event) => {
    if (reloadOnceForUpdate()) event.preventDefault();
  };
  window.addEventListener("vite:preloadError", handler);
  return () => window.removeEventListener("vite:preloadError", handler);
}
