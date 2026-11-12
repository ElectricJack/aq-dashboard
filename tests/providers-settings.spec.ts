import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
for (const width of [1440, 390, 320]) {
  test(`Providers settings fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings?tab=providers");
    await expect(page.getByRole("region", { name: "Providers", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove Anthropic", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map(v => v.id)).toEqual([]);
  });
}
test("remove and add persist through the page Save and reload", async ({ page }) => {
  await page.goto("/settings?tab=providers");
  await page.getByRole("button", { name: "Remove OpenAI", exact: true }).click();
  await expect(page.getByText("Removal pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Settings save status", exact: true })).toHaveText("Saved.");
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove OpenAI", exact: true })).toHaveCount(0);
  await page.getByRole("combobox", { name: "Provider to add", exact: true }).selectOption("openai");
  await page.getByRole("button", { name: "Add provider", exact: true }).click();
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Settings save status", exact: true })).toHaveText("Saved.");
  await page.reload();
  await page.getByRole("tab", { name: "Providers", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remove OpenAI", exact: true })).toBeVisible();
});
test("provider changes warn on navigation and reload", async ({ page }) => {
  await page.goto("/settings?tab=providers");
  await page.getByRole("button", { name: "Remove OpenAI", exact: true }).click();
  const beforeUnload = page.waitForEvent("dialog");
  const reload = page.reload({ timeout: 2000 }).catch(() => null);
  const dialog = await beforeUnload; expect(dialog.type()).toBe("beforeunload"); await dialog.dismiss(); await reload;
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const warning = page.getByRole("alertdialog", { name: "Leave Settings with unsaved changes?" });
  await expect(warning).toBeVisible(); await warning.getByRole("button", { name: "Stay in Settings" }).click();
  await page.getByRole("tab", { name: "Providers", exact: true }).click();
  await expect(page.getByText("Removal pending", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await warning.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/\/overview/);
});

test("one Save includes both Intelligence and provider edits", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByLabel("Standard description", { exact: true }).fill("Use for ordinary implementation tasks");
  await page.getByRole("tab", { name: "Providers", exact: true }).click();
  await page.getByRole("button", { name: "Remove OpenAI", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Settings save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Remove OpenAI", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByLabel("Standard description", { exact: true })).toHaveValue("Use for ordinary implementation tasks");
});
