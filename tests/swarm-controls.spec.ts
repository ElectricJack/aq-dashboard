import { expect, test, type Page } from "@playwright/test";

const provider = "fixture-provider";
async function openAllocation(page: Page) {
  await page.getByRole("button", { name: /show details/i }).click();
  const slider = page.getByRole("slider", { name: `${provider} concurrent agents` });
  await expect(slider).toBeVisible();
  return slider.locator("../..");
}

for (const width of [320, 390, 1440]) {
  test(`provider allocation and Intelligence settings reflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto("/agents/swarm");
    const status = page.getByRole("region", { name: "Swarm status" });
    await expect(status.getByRole("button", { name: /show details/i })).toHaveAttribute("aria-expanded", "false");
    const row = await openAllocation(page);
    await expect(row).toContainText(provider);
    await expect(row).toContainText(/burn estimate|usage history/i);
    await expect(page.getByRole("switch", { name: /reduced usage/i })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByRole("link", { name: "Intelligence settings" }).click();
    await expect(page).toHaveURL(/\/settings\?tab=intelligence/);
    await expect(page.getByRole("tab", { name: "Intelligence", selected: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Swarm" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Max agents" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  });
}

test("disclosure persists without remounting the tree or resetting selection", async ({ page }) => {
  await page.goto("/agents/swarm?select=machine:desktop");
  const pane = page.getByRole("complementary", { name: "Properties" });
  const tree = page.getByRole("region", { name: "Swarm tree" });
  await expect(pane).toContainText("desktop");
  await tree.evaluate(element => { (element as HTMLElement & { testMarker?: string }).testMarker = "same tree"; });
  await openAllocation(page);
  await page.getByRole("button", { name: /hide details/i }).click();
  expect(await tree.evaluate(element => (element as HTMLElement & { testMarker?: string }).testMarker)).toBe("same tree");
  await expect(pane).toContainText("desktop");
  await page.reload();
  await expect(page.getByRole("button", { name: /show details/i })).toHaveAttribute("aria-expanded", "false");
  await openAllocation(page);
  await page.reload();
  await expect(page.getByRole("button", { name: /hide details/i })).toHaveAttribute("aria-expanded", "true");
});

test("provider cap is confirmed, including zero and unlimited", async ({ page }) => {
  await page.goto("/agents/swarm");
  const row = await openAllocation(page);
  const input = row.getByRole("spinbutton", { name: `${provider} limit` });
  const unlimited = row.getByRole("checkbox", { name: "Unlimited" });
  await expect(unlimited).toBeChecked();
  await unlimited.uncheck();
  await input.fill("5");
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(row.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await expect(input).toHaveValue("5");
  await input.fill("0");
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(row).toContainText("0 concurrent · paused");
  await expect(row.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
  await unlimited.check();
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(unlimited).toBeChecked();
  await expect(row.getByRole("button", { name: "Apply", exact: true })).toBeDisabled();
});

test("pending provider update preserves the draft until confirmation", async ({ page }) => {
  await page.goto("/agents/swarm?scenario=swarm-settings-pending");
  const row = await openAllocation(page);
  await row.getByRole("checkbox", { name: "Unlimited" }).uncheck();
  const input = row.getByRole("spinbutton", { name: `${provider} limit` });
  await input.fill("5");
  await row.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(row.getByRole("button", { name: "Applying…" })).toBeDisabled();
  await expect(input).toHaveValue("5");
  await expect(row.getByRole("button", { name: "Apply", exact: true })).toBeDisabled({ timeout: 10_000 });
  await expect(input).toHaveValue("5");
});

for (const scenario of ["swarm-settings-conflict", "swarm-settings-error"]) {
  test(`${scenario} preserves the provider draft`, async ({ page }) => {
    await page.goto(`/agents/swarm?scenario=${scenario}`);
    const row = await openAllocation(page);
    await row.getByRole("checkbox", { name: "Unlimited" }).uncheck();
    const input = row.getByRole("spinbutton", { name: `${provider} limit` });
    await input.fill("5");
    await row.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(row.getByRole("alert").first()).toBeVisible();
    await expect(input).toHaveValue("5");
  });
}

test("Intelligence row applies max agents independently, including zero and unlimited", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const input = page.getByRole("spinbutton", { name: "Max agents for Fixture standard" });
  const apply = page.getByRole("button", { name: "Apply max agents for Fixture standard" });
  await expect(input).toBeEnabled();
  await input.fill("0");
  await apply.click();
  await expect(page.getByText("Limit saved.")).toBeVisible();
  await expect(input).toHaveValue("0");
  await input.fill("");
  await apply.click();
  await expect(input).toHaveValue("");
  await expect(apply).toBeDisabled();
});

test("Intelligence conflict preserves the edited max agents", async ({ page }) => {
  await page.goto("/settings?scenario=swarm-settings-conflict&tab=intelligence");
  const input = page.getByRole("spinbutton", { name: "Max agents for Fixture standard" });
  await input.fill("5");
  await page.getByRole("button", { name: "Apply max agents for Fixture standard" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("5");
});
