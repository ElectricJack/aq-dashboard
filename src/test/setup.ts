import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => { cleanup(); if (typeof sessionStorage !== "undefined") sessionStorage.clear(); });

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
