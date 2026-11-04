import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Gap WK-B / KN-A: project-scope states on Work and Knowledge are honest.
const project = "00000000-0000-0000-0000-000000000001";
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of ["/work", "/knowledge"]) {
      test(`${path} without projects.read explains instead of loading`, async ({ page }) => {
        await page.goto(`${path}?scenario=projects-unlisted`);
        const main = page.locator("#content");
        const status = main.getByRole("status").filter({ hasText: "isn't offered" });
        await expect(status).toContainText("Project listing is not offered by this AQ server");
        await expect(main.getByRole("region", { name: "Choose a project" }).getByText(/not offered/i)).toBeVisible();
        await page.waitForTimeout(2000);
        await expect(page.getByText(/Loading projects/)).toBeHidden();
        await expectAxeClean(page);
      });
    }

    test("/knowledge lists the fixture project and opens its library", async ({ page }) => {
      await page.goto("/knowledge");
      const link = page.locator("#content").getByRole("link", { name: "Contract fixture" });
      await expect(link).toBeVisible();
      await expectAxeClean(page);
      await link.click();
      await expect(page.getByRole("heading", { name: /record/ }).first()).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`scope=project(:|%3A)${project}`));
    });

    for (const path of ["/work", "/knowledge"]) {
      test(`${path} failed read shows no zero count`, async ({ page }) => {
        await page.goto(`${path}?scenario=reads-failed&scope=project:${project}`);
        const title = path === "/work" ? "Tasks unavailable" : "Records unavailable";
        // The client retries a 503 read before reporting it, so allow the retry budget.
        await expect(page.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 15_000 });
        await expect(page.getByRole("alert")).toContainText("Couldn't load");
        await expect(page.getByText("0 tasks loaded")).toHaveCount(0);
        await expect(page.getByText("0 records loaded")).toHaveCount(0);
        await expectAxeClean(page);
      });
    }
  });
}
