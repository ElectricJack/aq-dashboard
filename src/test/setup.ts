import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Bootstrap and lazy routes share CI CPU with other work. Allow their visible
// state to settle without weakening findBy/waitFor assertions.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => { cleanup(); if (typeof sessionStorage !== "undefined") sessionStorage.clear(); });

// MSW intercepts Node fetch at the socket level. Node's shared undici pool can
// open a connection for a request that is aborted before it writes (e.g. a page
// unmounting at the end of a test); the interceptor passes such a silent socket
// through to a real connect, and its later ECONNREFUSED fails whichever request
// the pool queues on it next — usually the next test's first page query. Give
// every fetch its own dispatcher so no connection outlives its request.
type Dispatcher = { dispatch: unknown; close(): Promise<void> };
type DispatcherConstructor = new (inner?: Dispatcher) => Dispatcher;
if (typeof globalThis.fetch === "function") {
  await globalThis.fetch("data:,"); // loads Node's undici and its global Agent
  const globals = globalThis as Record<symbol, { constructor: DispatcherConstructor } | undefined>;
  // Node's fetch reads the v1 slot. Newer undici (loaded here by jsdom) fills it
  // with a wrapper around its v2 Agent, so mirror whichever layout is present.
  const legacy = globals[Symbol.for("undici.globalDispatcher.1")]?.constructor;
  const current = globals[Symbol.for("undici.globalDispatcher.2")]?.constructor;
  const createDispatcher = (): Dispatcher => legacy && current && legacy !== current ? new legacy(new current()) : new legacy!();
  if (typeof legacy !== "function" || typeof createDispatcher().dispatch !== "function") throw new Error("Node fetch dispatcher is unavailable; test connections cannot be isolated");
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const dispatcher = createDispatcher();
    // close() waits for the response body, so a streamed read completes first.
    return nativeFetch(input, { ...init, dispatcher } as RequestInit).finally(() => { void dispatcher.close().catch(() => undefined); });
  };
}

// jsdom has no media-query engine. Keep the default desktop-independent,
// nonmatching state while supporting the listener API used by xterm.
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string): MediaQueryList => Object.assign(new EventTarget(), {
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
  });
}

// jsdom has no layout engine; browser checks cover measured terminal/graph sizing.
if (typeof window !== "undefined" && typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom does not implement modal dialogs. Real modal behaviour (inert
// background, focus containment) is covered by Playwright.
if (typeof HTMLDialogElement !== "undefined" && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
}
