import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { installPreloadErrorHandler } from "./app/chunkReload";
import { applyPreferences, readPreferences } from "./app/preferences";
import "./components/tokens.css";
import "./components/base.css";

// Display preferences apply before first paint so text size and motion never flash.
applyPreferences(readPreferences());
installPreloadErrorHandler();

async function start() {
  // Mock code is excluded from the production build; explicit fixture builds support compiled visual review.
  if (import.meta.env.MODE === "mock" && (import.meta.env.DEV || import.meta.env.VITE_FIXTURE_BUILD === "true")) {
    const { startMocks } = await import("./mocks/browser");
    await startMocks();
  }
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing #root element");
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
