import { defineConfig, devices } from "@playwright/test";

if (!process.env.AQ_LIVE_URL) throw new Error("AQ_LIVE_URL must name the running AQ human listener");
export default defineConfig({
  testDir: "tests/live",
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [["list"]],
  use: { baseURL: process.env.AQ_LIVE_URL, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
