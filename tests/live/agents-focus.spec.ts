import { expect, test } from "@playwright/test";

// Real human listener only. This check never acquires Watch or mutates a domain.
test("focused session uses actual scoped navigation and a readable responsive output workspace", async ({ page, request }) => {
  const response = await request.get("/api/v1/sessions?limit=25");
  expect(response.status()).toBe(200);
  const actual = await response.json();
  const sessions = actual.data.items as { id: string; label: string }[];
  test.skip(sessions.length === 0, "No actual visible session to inspect");
  const session = sessions[0]!;
  const inspected = await (await request.get(`/api/v1/sessions/${encodeURIComponent(session.id)}`)).json();
  const bootstrap = await (await request.get("/api/v1/bootstrap")).json();
  const mutations: string[] = [], errors: string[] = [];
  page.on("request", r => { if (!["GET", "HEAD"].includes(r.method())) mutations.push(r.method()); });
  page.on("pageerror", e => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`/agents/${encodeURIComponent(session.id)}`);
  const detail = page.getByRole("region", { name: session.label, exact: true });
  await expect(detail).toBeVisible();
  if (inspected.data.task && bootstrap.data.capabilities.some((c: { name: string; enabled: boolean }) => c.name === "tasks.read" && c.enabled)) {
    await expect(detail.getByRole("link", { name: inspected.data.task.title, exact: true })).toHaveAttribute("href", `/work/${encodeURIComponent(inspected.data.task.id)}?scope=project%3A${encodeURIComponent(inspected.data.project.id)}`);
  }
  const switcher = detail.getByRole("navigation", { name: "Session switcher" });
  const current = switcher.getByRole("link", { name: session.label, exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  await expect(detail.getByRole("button", { name: "Session details" })).toHaveAttribute("aria-expanded", "false");
  await expect(detail.getByRole("list", { name: "Effective permissions" })).toBeHidden();
  const output = detail.locator("pre[aria-label='Literal worker output']");
  if (await output.count()) {
    const dimensions = await output.boundingBox();
    expect(dimensions!.width).toBeGreaterThan(600);
    expect(dimensions!.height).toBeGreaterThanOrEqual(300);
    await expect(detail.getByRole("region", { name: "Read-only output tail" }).getByRole("status")).toHaveText("Not watching");
  } else await expect(detail.getByText("Terminal is not available", { exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("focused-agents-desktop.png"), fullPage: true });
  await detail.getByRole("button", { name: "Session details" }).click();
  await detail.getByRole("navigation", { name: "Session operations" }).getByRole("button", { name: "Profile" }).click();
  await expect(detail.getByRole("list", { name: "Effective permissions" })).toBeVisible();
  await expect(detail.getByRole("list", { name: "Profile revisions" })).toBeVisible();
  await detail.getByRole("button", { name: "Session details" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("navigation", { name: "Primary (compact)", includeHidden: true })).toBeHidden();
  await expect(detail.getByRole("link", { name: "All sessions" })).toBeVisible();
  if (await output.count()) {
    const phoneOutput = await output.boundingBox();
    expect(phoneOutput!.y).toBeLessThanOrEqual(420);
    expect(Math.min(phoneOutput!.y + phoneOutput!.height, 844) - phoneOutput!.y).toBeGreaterThanOrEqual(300);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await page.screenshot({ path: test.info().outputPath("focused-agents-mobile.png"), fullPage: true });
  await detail.getByRole("link", { name: "All sessions" }).click();
  await expect(page.getByRole("navigation", { name: "Primary (compact)" })).toBeVisible();
  expect(mutations).toEqual([]);
  expect(errors).toEqual([]);
});
