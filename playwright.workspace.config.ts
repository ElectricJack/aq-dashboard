import { defineConfig, devices } from "@playwright/test";

// Production bundle with deterministic HTTP/WebSocket fixtures. No live agent
// is launched or controlled. Run pnpm build before this suite.
const port = Number(process.env.WORKSPACE_PORT ?? 4260);
const external = process.env.WORKSPACE_PREVIEW_URL;
export default defineConfig({
  testDir: "tests/workspace",
  outputDir: "test-results/workspace",
  timeout: 45_000,
  workers: 1,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], baseURL: external ?? `http://127.0.0.1:${port}`, trace: "retain-on-failure" },
  webServer: external ? undefined : {
    command: `pnpm exec vite preview --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
  },
});
