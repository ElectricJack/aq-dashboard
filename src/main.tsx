import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import "./components/tokens.css";
import "./components/base.css";

async function start() {
  // Statically false in production builds, so mock code is never bundled.
  if (import.meta.env.DEV && import.meta.env.MODE === "mock") {
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
