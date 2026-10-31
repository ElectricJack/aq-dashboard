import react from "@vitejs/plugin-react";
import { msw } from "msw/vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), msw()],
  build: { sourcemap: true },
  // Pre-bundle the lazily imported mock worker so a cold dev server never
  // reloads mid-page after discovering it.
  optimizeDeps: { include: ["msw/browser"] },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
