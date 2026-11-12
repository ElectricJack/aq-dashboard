import { expect, test } from "@playwright/test";

const provider = "fixture-provider";
const sliderName = `${provider} concurrent agents`;

for (const width of [320, 390, 1440]) {
  test(`provider sliders and Intelligence settings reflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/agents/swarm");
    const status = page.getByRole("region", { name: "Swarm status" });
    await expect(status.getByRole("slider", { name: sliderName })).toBeVisible();
    await expect(status).toContainText(/burn estimate|usage history/i);
    await expect(status.getByRole("button", { name: /show details|apply/i })).toHaveCount(0);
    await expect(status.getByRole("checkbox")).toHaveCount(0);
    await expect(page.getByRole("switch", { name: /reduced usage/i })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.goto("/settings?tab=intelligence");
    await expect(page.getByRole("tab", { name: "Intelligence", selected: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Swarm" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Max agents" })).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Apply max agents/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("autosaving a provider cap keeps the tree and selected machine", async ({ page }) => {
  await page.goto("/agents/swarm?select=machine:desktop");
  const pane = page.getByRole("complementary", { name: "Properties" });
  const tree = page.getByRole("region", { name: "Swarm tree" });
  await expect(pane).toContainText("desktop");
  await tree.evaluate(element => { (element as HTMLElement & { testMarker?: string }).testMarker = "same tree"; });
  const slider = page.getByRole("slider", { name: sliderName });
  const saved = page.waitForResponse(response => response.url().endsWith("/api/settings/swarm/limits") && response.request().method() === "POST");
  await slider.fill("0");
  await expect(page.getByRole("region", { name: "Swarm status" })).toContainText("0 concurrent · paused");
  expect((await (await saved).json()).provider_limits.find((v: { provider: string }) => v.provider === provider).limit).toBe(0);
  expect(await tree.evaluate(element => (element as HTMLElement & { testMarker?: string }).testMarker)).toBe("same tree");
  await expect(pane).toContainText("desktop");
});

test("pending provider update preserves its draft until confirmation", async ({ page }) => {
  await page.goto("/agents/swarm?scenario=swarm-settings-pending");
  const slider = page.getByRole("slider", { name: sliderName });
  await slider.fill("5");
  await expect(page.getByRole("status").filter({ hasText: "Updating limits" })).toBeVisible();
  await expect(slider).toHaveValue("5");
  await expect(page.getByRole("status").filter({ hasText: "Updating limits" })).toBeHidden({ timeout: 10_000 });
  await expect(slider).toHaveValue("5");
});

for (const scenario of ["swarm-settings-conflict", "swarm-settings-error"]) {
  test(`${scenario} preserves the provider draft`, async ({ page }) => {
    await page.goto(`/agents/swarm?scenario=${scenario}`);
    const slider = page.getByRole("slider", { name: sliderName });
    await slider.fill("5");
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(slider).toHaveValue("5");
  });
}

test("Intelligence row saves max agents, including zero and unlimited", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const input = page.getByRole("spinbutton", { name: "Max agents for Fixture standard" });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await expect(input).toBeEnabled();
  await input.fill("0");
  await save.click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(input).toHaveValue("0");
  await input.fill("");
  await save.click();
  await expect(input).toHaveValue("");
  await expect(save).toBeDisabled();
});

test("Intelligence conflict preserves the edited max agents", async ({ page }) => {
  await page.goto("/settings?scenario=swarm-settings-conflict&tab=intelligence");
  const input = page.getByRole("spinbutton", { name: "Max agents for Fixture standard" });
  await input.fill("5");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("5");
});

test("two provider changes are serialized using the confirmed revision", async ({ page }) => {
  const requests: { provider: { provider: string; limit: number }; expected_revision: string }[] = [];
  page.on("request", request => {
    if (request.url().endsWith("/api/settings/swarm/limits") && request.method() === "POST") requests.push(request.postDataJSON());
  });
  await page.goto("/agents/swarm?scenario=swarm-two-providers");
  const first = page.getByRole("slider", { name: sliderName });
  const second = page.getByRole("slider", { name: "fixture-provider-two concurrent agents" });
  await expect(second).toBeVisible();
  await first.fill("3");
  await second.fill("4");
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => page.getByRole("status").filter({ hasText: "Updating limits" }).count()).toBe(0);
  expect(requests.map(request => request.provider)).toEqual([{ provider, limit: 3 }, { provider: "fixture-provider-two", limit: 4 }]);
  expect(Number(requests[1].expected_revision)).toBe(Number(requests[0].expected_revision) + 1);
});
