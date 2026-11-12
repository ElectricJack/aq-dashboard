import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390, 320]) {
  test(`intelligence structure is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
    for (const name of ["Simple", "Standard", "Complex", "Deep"]) {
      await expect(page.getByRole("region", { name: `${name} intelligence` })).toBeVisible();
      await expect(page.getByLabel(`${name} description`, { exact: true })).toBeVisible();
    }
    await page.getByText("Standard variations", { exact: false }).click();
    const low = page.locator('tr[data-profile-id="fixture-standard"]');
    const high = page.locator('tr[data-profile-id="fixture-advanced"]');
    await expect(low.getByLabel("Model")).toBeVisible();
    await expect(high.getByLabel("Reasoning effort")).toBeVisible();
    await expect(low.getByLabel(/Max agents/)).toHaveValue("4");
    await expect(high.getByLabel(/Max agents/)).toHaveValue("2");
    await expect(page.getByRole("row", { name: "Standard Medium not configured" })).toBeVisible();
    await expect(page.getByText("Saved policy source; playbook execution will be connected later.")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
  });
}

test("parent description and routing markdown persist across reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await page.getByLabel("Standard description", { exact: true }).fill("Saved description");
  await page.getByRole("button", { name: "Save Standard description" }).click();
  await expect(page.getByRole("region", { name: "Standard intelligence" }).getByRole("status")).toHaveText("Saved.");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByLabel("Markdown").fill("# Saved routing\n\nUse Standard for ordinary work.");
  await policy.getByRole("button", { name: "Save", exact: true }).click();
  await expect(policy.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByLabel("Standard description", { exact: true })).toHaveValue("Saved description");
  await expect(page.getByLabel("Markdown")).toHaveValue("# Saved routing\n\nUse Standard for ordinary work.");
});

test("variation limits save independently", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await page.getByText("Standard variations", { exact: false }).click();
  const low = page.locator('tr[data-profile-id="fixture-standard"]');
  const high = page.locator('tr[data-profile-id="fixture-advanced"]');
  await low.getByLabel(/Max agents/).fill("7");
  await low.getByRole("button", { name: "Save" }).click();
  await expect(low.getByRole("status")).toHaveText("Saved.");
  await expect(high.getByLabel(/Max agents/)).toHaveValue("2");
  await expect(low.getByLabel(/Max agents/)).toHaveValue("7");
});

test("a missing variation can be configured and remains assigned", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await page.getByText("Standard variations", { exact: false }).click();
  await page.getByRole("button", { name: "Add variation: Standard Medium" }).click();
  const row = page.getByRole("row", { name: "Standard Medium", exact: true });
  await row.getByLabel("Model").selectOption({ label: "fixture-model" });
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("button", { name: "Add variation: Standard Medium" })).toHaveCount(0);
  await expect(row.getByLabel("Model")).toHaveValue("fixture-provider:fixture-model");
  await page.reload();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await page.getByText("Standard variations", { exact: false }).click();
  await expect(page.getByRole("row", { name: "Standard Medium", exact: true })).toBeVisible();
});
