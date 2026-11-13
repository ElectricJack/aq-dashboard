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
    await expect(page.getByText("Saved changes are compiled and take effect when they compile.")).toBeVisible();
    await expect(page.getByRole("switch", { name: "Route tasks with this policy" })).toBeDisabled();
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

test("a saved policy compiles, shows how it routes, and routing can be turned on", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const policy = page.getByRole("region", { name: "Routing policy" });
  const toggle = policy.getByRole("switch", { name: "Route tasks with this policy" });
  // The first read waits for the mock network and every Settings panel to load.
  await expect(toggle).toBeDisabled({ timeout: 15_000 });
  await policy.getByLabel("Markdown").fill("# Routing\n\nBug fixes are Standard, high effort.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(policy.getByText("Compiling…")).toBeVisible();
  const summary = policy.getByRole("region", { name: "How this policy routes" });
  await expect(summary).toContainText("Fixture: Bug fixes: Standard, high effort; Complex, high effort after 1 failed attempt.", { timeout: 10_000 });
  await expect(policy.getByText("Compiling…")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Route tasks with this policy" })).toBeChecked();
});

test("a failed compile keeps the previous policy and says what could not be resolved", async ({ page }) => {
  await page.goto("/settings?tab=intelligence&scenario=routing-compile-failed");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await expect(policy.getByText("This version did not compile. The previous policy is still routing.")).toBeVisible({ timeout: 15_000 });
  await expect(policy.getByRole("list", { name: "Unresolved sentences" })).toContainText("Fixture: Art and visual design go to the plotter.");
  await expect(policy.getByRole("list", { name: "Compile problems" })).toContainText("kinds.docs.class");
  await expect(policy.getByRole("region", { name: "How this policy routes" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
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

test("internal work default and a purpose override persist across reload", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const panel = page.getByRole("region", { name: "Internal work" });
  await expect(panel.getByText("No profile is set. Internal work will fail until one is chosen.")).toBeVisible();
  await panel.getByLabel("Default profile", { exact: true }).selectOption({ label: "Fixture standard" });
  await panel.getByLabel("Playbook compilation", { exact: true }).selectOption({ label: "Fixture advanced" });
  await panel.getByRole("button", { name: "Save internal work", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(panel.getByLabel("Default profile", { exact: true })).toHaveValue("fixture-standard");
  await expect(panel.getByLabel("Playbook compilation", { exact: true })).toHaveValue("fixture-advanced");
  await expect(panel.getByLabel("Playbook calls", { exact: true })).toHaveValue("");
});
