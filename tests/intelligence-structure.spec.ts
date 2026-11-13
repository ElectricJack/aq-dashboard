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
    const low = page.locator('tr[data-profile-id="fixture-standard"]');
    const high = page.locator('tr[data-profile-id="fixture-advanced"]');
    await expect(low.getByLabel("Model")).toBeVisible();
    await expect(high.getByLabel("Reasoning effort")).toBeVisible();
    await expect(low.getByLabel(/Max agents/)).toHaveValue("4");
    await expect(high.getByLabel(/Max agents/)).toHaveValue("2");
    await expect(page.getByRole("table", { name: "Intelligence variations", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
    await expect(page.getByRole("combobox", { name: "Variation to add" })).toContainText("Standard · Medium");
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
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByLabel("Markdown").fill("# Saved routing\n\nUse Standard for ordinary work.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByLabel("Standard description", { exact: true })).toHaveValue("Saved description");
  await expect(page.getByLabel("Markdown")).toHaveValue("# Saved routing\n\nUse Standard for ordinary work.");
});

test("variation limits save independently", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  const low = page.locator('tr[data-profile-id="fixture-standard"]');
  const high = page.locator('tr[data-profile-id="fixture-advanced"]');
  await low.getByLabel(/Max agents/).fill("7");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(low.getByRole("status")).toHaveText("Saved.");
  await expect(high.getByLabel(/Max agents/)).toHaveValue("2");
  await expect(low.getByLabel(/Max agents/)).toHaveValue("7");
});

test("a missing variation can be configured and remains assigned", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await page.getByLabel("Variation to add", { exact: true }).selectOption("standard:medium");
  await page.getByRole("button", { name: "Add variation: Standard Medium" }).click();
  const row = page.getByRole("row", { name: "Standard Medium", exact: true });
  await row.getByLabel("Model").selectOption({ label: "fixture-model" });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Add variation: Standard Medium" })).toHaveCount(0);
  await expect(row.getByLabel("Model")).toHaveValue("fixture-provider:fixture-model");
  await page.reload();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByRole("row", { name: "Standard Medium", exact: true })).toBeVisible();
});

test("one Save includes multiple row edits, descriptions and Markdown", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const low = page.locator('tr[data-profile-id="fixture-standard"]');
  const high = page.locator('tr[data-profile-id="fixture-advanced"]');
  await low.getByLabel(/Max agents/).fill("6");
  await high.getByLabel(/Max agents/).fill("3");
  await page.getByLabel("Simple description", { exact: true }).fill("Small routine work");
  await page.getByLabel("Standard description", { exact: true }).fill("Everyday work");
  await page.getByLabel("Markdown").fill("# Routing\n\nChoose a parent type.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await expect(low.getByLabel(/Max agents/)).toHaveValue("6");
  await expect(high.getByLabel(/Max agents/)).toHaveValue("3");
  await expect(page.getByLabel("Simple description", { exact: true })).toHaveValue("Small routine work");
  await expect(page.getByLabel("Standard description", { exact: true })).toHaveValue("Everyday work");
  await expect(page.getByLabel("Markdown")).toHaveValue("# Routing\n\nChoose a parent type.");
});

test("leaving Settings warns, staying and switching tabs retain drafts", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByLabel("Standard description", { exact: true }).fill("Unsaved description");
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const warning = page.getByRole("alertdialog", { name: "Leave Settings with unsaved changes?" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Stay in Settings" }).click();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByLabel("Standard description", { exact: true })).toHaveValue("Unsaved description");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/\/overview/);
});

test("reloading warns until Intelligence changes are saved", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByLabel("Markdown").fill("# Unsaved source");
  const dialog = page.waitForEvent("dialog");
  // A cancelled reload has no navigation to satisfy Playwright's load wait.
  const reload = page.reload({ timeout: 2000 }).catch(() => null);
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await reload;
  await expect(page.getByLabel("Markdown")).toHaveValue("# Unsaved source");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  const dialogs: string[] = [];
  page.on("dialog", async current => { dialogs.push(current.type()); await current.dismiss(); });
  await page.reload();
  expect(dialogs).toEqual([]);
  await expect(page.getByLabel("Markdown")).toHaveValue("# Unsaved source");
});
