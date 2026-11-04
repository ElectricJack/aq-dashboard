import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// KN-B (reference 07-knowledge-v2.png): page header with "Add record" on the title row,
// document header with one action slot, short dates and no disabled-button wall.
const project = "00000000-0000-0000-0000-000000000001";
const record = "00000000-0000-0000-0000-000000000005";
const library = `/knowledge?scope=project:${project}`;
const documentPath = `/knowledge/${record}?scope=project:${project}`;
const evidence = "docs/evidence/kn-b-2026-11-03";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function expectAddRecordOnTitleRow(page: Page) {
  const h1 = await box(page.getByRole("heading", { level: 1, name: "Knowledge" }));
  const add = page.getByRole("button", { name: "Add record" });
  await expect(add).toBeDisabled();
  await expect(add).toHaveAccessibleDescription("Not offered by this AQ server");
  expect(Math.abs((await box(add)).y - h1.y)).toBeLessThanOrEqual(16);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("library header keeps Add record on the title row without a caption", async ({ page }) => {
      await page.goto(library);
      await expect(page.getByRole("list", { name: "Knowledge records" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Find the decisions, procedures, and evidence behind the work.", { exact: true })).toBeVisible();
      await expectAddRecordOnTitleRow(page);
      await expect(page.getByText("Not offered by this AQ server")).toHaveCount(0);
      // Tap/focus reveals the reason as a tooltip tied to the button.
      await page.getByRole("button", { name: "Add record" }).focus();
      await expect(page.getByRole("tooltip")).toHaveText("Not offered by this AQ server");
      await page.getByRole("button", { name: "Add record" }).blur();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/knowledge-library-${vp.name}.png` });
    });

    test("document header has one action slot, short dates and no caption wall", async ({ page }) => {
      await page.goto(documentPath);
      const title = page.getByRole("heading", { level: 2, name: "Fixture: execution ownership" });
      await expect(title).toBeVisible({ timeout: 15_000 });
      await expectAddRecordOnTitleRow(page);
      await expect(page.getByText("Not offered by this AQ server")).toHaveCount(0);
      for (const name of ["Correct record", "Verify record", "Retire record"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
      const updated = page.locator("time[datetime='2026-11-01T00:00:00Z']").first();
      await expect(updated).toHaveText("Nov 1");
      await expect(updated).toHaveAttribute("title", "2026-11-01T00:00:00Z");
      await expect(page.getByText("Decision", { exact: true }).filter({ visible: true }).first()).toBeVisible();
      // Arrival focus is for screen readers; it draws no ring.
      await expect(title).toBeFocused();
      expect(await title.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("none");
      expect((await box(page.getByRole("heading", { name: "Decision", exact: true }))).y).toBeLessThan(844);
      const actions = page.getByRole("button", { name: "Actions" });
      if (vp.name === "d") {
        const h2 = await box(title);
        const slot = await box(actions);
        expect(slot.x).toBeGreaterThan(h2.x + h2.width);
        expect(Math.abs(slot.y - h2.y)).toBeLessThanOrEqual(16);
      }
      await expect(actions).toHaveAttribute("aria-expanded", "false");
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/knowledge-document-${vp.name}.png` });
      await actions.click();
      const menu = page.getByRole("list", { name: "Record actions" });
      await expect(menu.getByRole("listitem")).toHaveCount(3);
      await expect(menu).toContainText("Correct record");
      const list = await box(menu);
      expect(list.x).toBeGreaterThanOrEqual(0);
      expect(list.x + list.width).toBeLessThanOrEqual(vp.width);
      await expect(menu.getByText("Not offered by this AQ server")).toHaveCount(3);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/knowledge-document-menu-${vp.name}.png` });
      await page.keyboard.press("Escape");
      await expect(menu).toHaveCount(0);
      await expect(actions).toBeFocused();
    });

    test("failed reads keep the header action slot in place", async ({ page }) => {
      await page.goto(`/knowledge?scenario=reads-failed&scope=project:${project}`);
      await expect(page.getByRole("alert")).toBeVisible({ timeout: 15_000 });
      await expectAddRecordOnTitleRow(page);
      await expect(page.getByText("Not offered by this AQ server")).toHaveCount(0);
    });
  });
}
