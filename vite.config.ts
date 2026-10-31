import react from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { defineConfig } from "vitest/config";

const daemon = process.env.AQ_DAEMON_URL;
if (daemon) {
  const url = new URL(daemon);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AQ_DAEMON_URL must be an HTTP(S) origin without credentials");
  }
}
// Keep the browser on one origin. Preserve Origin and auth headers: the daemon
// continues to enforce its own authentication and mutation CSRF policy.
const proxy = daemon ? Object.fromEntries(["/api", "/healthz", "/readyz"].map((path) => [path, {
  target: daemon, changeOrigin: false, timeout: 15_000, proxyTimeout: 15_000,
}])) : undefined;

export default defineConfig({
  plugins: [react(), msw()],
  build: { sourcemap: false },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  // Pre-bundle the lazily imported mock worker so a cold dev server never
  // reloads mid-page after discovering it.
  optimizeDeps: { include: ["msw/browser"] },
  test: {
    // Keep cold jsdom/module work bounded while Rust components build nearby.
    // Assertion deadlines remain unchanged.
    maxWorkers: 4,
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
