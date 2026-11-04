import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// KN-C (reference 07-knowledge-v2.png, library region): filters, list header and rows.
// Mock mode serves one labelled fixture record ("Fixture: execution ownership").
const project = "00000000-0000-0000-0000-000000000001";
const library = `/knowledge?scope=project:${project}`;
const evidence = "docs/evidence/knowledge-kn-c";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function openLibrary(page: Page) {
  await page.goto(library);
  await expect(page.getByRole("list", { name: "Knowledge records" })).toBeVisible({ timeout: 15_000 });
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("library filters, list header and rows match the reference", async ({ page }) => {
      await openLibrary(page);
      // Search has a leading icon and submits on Enter; no visible Search submit in the page.
      const search = page.getByRole("searchbox", { name: "Search knowledge" });
      await expect(search).toBeVisible();
      await expect(page.getByRole("main").getByRole("button", { name: "Search", exact: true })).toHaveCount(0);

      await expect(page.getByRole("combobox", { name: /category/i })).toHaveValue("");
      await expect(page.getByRole("combobox", { name: /lifecycle/i })).toHaveValue("active");
      await expect(page.getByRole("combobox", { name: /verification/i })).toHaveValue("");
      for (const name of [/category/i, /lifecycle/i, /verification/i, /sort/i]) {
        const options = await page.getByRole("combobox", { name }).locator("option").allTextContents();
        expect(options.join("|")).not.toMatch(/loaded/i);
      }
      await expect(page.getByRole("combobox", { name: /category/i }).locator("option:checked")).toHaveText("All categories");
      await expect(page.getByRole("combobox", { name: /lifecycle/i }).locator("option:checked")).toHaveText("Active records");
      await expect(page.getByRole("combobox", { name: /verification/i }).locator("option:checked")).toHaveText("Any verification");

      await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
      const relationships = page.getByRole("button", { name: "Relationships" });
      await expect(relationships).toBeDisabled();
      await expect(relationships).toHaveAttribute("title", "Relationship browsing is not offered by this read contract");

      await expect(page.getByText("1 record loaded")).toBeVisible();
      await expect(page.getByRole("combobox", { name: /sort/i }).locator("option:checked")).toHaveText("Updated recently");
      await expect(page.getByRole("button", { name: "Refresh list" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh list" })).toHaveText("");

      const row = page.getByRole("link", { name: /Fixture: execution ownership/ });
      await expect(row).toContainText("Decision");
      await expect(row).toContainText("Active");
      await expect(row).toContainText("Unverified");
      await expect(row).toContainText("r1");
      await expect(row.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
      await expect(row.locator("svg").first()).toBeVisible();

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (vp.name === "d") {
        // The list pane stretches to the document pane's height at >=1200px.
        const list = await page.getByRole("region", { name: /record loaded/ }).boundingBox();
        const doc = await page.getByRole("region", { name: "Project knowledge" }).boundingBox();
        expect(Math.abs(list!.y + list!.height - (doc!.y + doc!.height))).toBeLessThanOrEqual(1);
      }
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/knowledge-C-${vp.name}.png` });
    });

    test("lifecycle filter hides active records when set to retired, and Enter searches", async ({ page }) => {
      await openLibrary(page);
      await page.getByRole("combobox", { name: /lifecycle/i }).selectOption("retired");
      await expect(page.getByText("0 records loaded")).toBeVisible();
      await expect(page.getByText("No loaded records match these filters.")).toBeVisible();
      await page.getByRole("combobox", { name: /lifecycle/i }).selectOption("active");
      await page.getByRole("searchbox", { name: "Search knowledge" }).fill("ownership");
      await page.getByRole("searchbox", { name: "Search knowledge" }).press("Enter");
      await expect(page).toHaveURL(/[?&]q=ownership/);
      await expect(page.getByText("1 record loaded")).toBeVisible();
    });
  });
}
