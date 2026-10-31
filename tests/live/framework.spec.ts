import { expect, test } from "@playwright/test";

// Read-only smoke against an explicitly configured actual AQ human listener.
// No MSW, route interception, provider calls or domain mutations.
test("production dashboard connects to AQ and supports direct navigation", async ({ page, request }) => {
  const response = await request.get("/api/v1/bootstrap");
  expect(response.status()).toBe(200);
  const bootstrap = await response.json();
  expect(bootstrap.api_version).toBe("dashboard-read-1");
  expect(bootstrap.data.capabilities.find((c: { name: string }) => c.name === "sessions.read").enabled).toBe(true);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const [path, title] of [["/overview", "Overview"], ["/agents", "Agents"], ["/settings", "Settings"]]) {
    await page.goto(path!);
    await expect(page.getByRole("heading", { level: 1, name: title! })).toBeVisible();
    await expect(page.getByRole("banner").getByText("Connected", { exact: true })).toBeVisible();
    await expect(page.getByText(/Mock data/)).toHaveCount(0);
  }
  await expect(page.getByText("Daemon: ok")).toBeVisible();
  const workers = await (await request.get("/api/workers")).json();
  if (workers.length) {
    await expect(page.getByRole("list", { name: "Worker nodes" })).toContainText(workers[0].name);
  } else {
    await expect(page.getByText("No worker nodes enrolled.")).toBeVisible();
  }
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("unsupported features are explicit and unknown API routes stay JSON errors", async ({ page, request }) => {
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "Work is not available" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Search/ })).toBeDisabled();
  const response = await request.get("/api/v1/not-a-route");
  expect(response.status()).toBe(404);
  expect(response.headers()["content-type"]).toContain("application/json");
  const missing = await request.get("/assets/missing.js");
  expect(missing.status()).toBe(404);
  expect(missing.headers()["content-type"]).not.toContain("text/html");
});

test("live settings remains usable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Framework connection" })).toBeVisible();
  await expect(page.getByText("Daemon: ok")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});
