import { defineConfig, devices } from "@playwright/test";

// G11 visual acceptance suite (`pnpm test:visual`).
// - fixture: labelled deterministic mock contract served by `vite --mode mock`.
// - live: set AQ_VISUAL_LIVE_URL to a preview of the compiled bundle proxied to a local daemon
//   (`AQ_DAEMON_URL=<daemon> pnpm preview`); live.spec.ts verifies the served bundle digest.
const PORT = Number(process.env.VISUAL_PORT ?? 4188);
const live = process.env.AQ_VISUAL_LIVE_URL;

export default defineConfig({
  testDir: "tests/visual",
  outputDir: "test-results/visual-run",
  fullyParallel: true,
  workers: process.env.VISUAL_WORKERS ? Number(process.env.VISUAL_WORKERS) : 2,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: { trace: "retain-on-failure", reducedMotion: "reduce" },
  projects: [
    {
      name: "fixture",
      testIgnore: "**/live.spec.ts",
      use: { ...devices["Desktop Chrome"], baseURL: `http://127.0.0.1:${PORT}` },
    },
    ...(live ? [{ name: "live", testMatch: "**/live.spec.ts", use: { ...devices["Desktop Chrome"], baseURL: live } }] : []),
  ],
  webServer: {
    command: `pnpm exec vite --mode mock --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
});
