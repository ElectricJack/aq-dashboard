import { expect, test } from "@playwright/test";

test("configured playbook discovery opens actual pinned run and bounded receipts", async ({ page, request }, testInfo) => {
  const bootstrap = await (await request.get("/api/v1/bootstrap")).json();
  const available = bootstrap.data.capabilities.find((c: { name: string }) => c.name === "playbooks.inspect")?.enabled === true;
  test.skip(!available, "Actual configured playbook Driver and namespace-owner inspection are required");
  const response = await request.get("/api/playbooks/inspection/runs?limit=25");
  expect(response.status()).toBe(200); const runs = await response.json();
  expect(runs.api_version).toBe("playbooks-inspection-1");
  test.skip(runs.items.length === 0, "Actual configured namespace has no admitted run to inspect");
  const run = runs.items[0]; const detailResponse = await request.get(`/api/playbooks/inspection/runs/${encodeURIComponent(run.id)}?limit=25`);
  expect(detailResponse.status()).toBe(200); const detail = await detailResponse.json();
  const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("/playbooks");
  await page.getByRole("link", { name: `Inspect ${run.id}`, exact: true }).click();
  const inspector = page.getByRole("region", { name: `Run ${run.id}` });
  await expect(inspector).toBeVisible(); await expect(inspector.getByRole("region", { name: "Pinned execution", exact: true }).locator("dl").first().locator("dd").first()).toHaveText(run.artifact);
  await expect(inspector.getByText(run.step, { exact: true }).first()).toBeVisible();
  expect(detail.observation_is_atomic).toBe(false);
  await expect(page.getByText(/Mock data/)).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath("playbooks-desktop.png"), fullPage: true });
  await page.reload(); await expect(inspector).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("link", { name: "All runs", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("playbooks-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
