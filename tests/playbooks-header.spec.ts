import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// PB-B (reference 06-playbooks.png): page header rhythm, a one-row view tab bar, and one
// shared phone back control above the detail H2 with the view toolbar hidden.
const evidence = "docs/evidence/pb-b-2026-11-04";
const run = "/playbooks/runs/run-0000000000000284";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900, phone: false },
  { name: "m", width: 390, height: 844, phone: true },
];

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
async function openActivation(page: Page) {
  await page.goto("/playbooks?view=activations");
  const list = page.getByRole("list", { name: "Current playbook activations" });
  await list.getByRole("button").first().click({ timeout: 30_000 });
  await expect(page).toHaveURL(/[?&]activation=/);
}
async function backControl(page: Page) {
  const back = page.getByRole("link", { name: /^All (runs|activations)$/ });
  await expect(back).toBeVisible();
  return { tag: await back.evaluate((el) => el.tagName), className: await back.getAttribute("class") };
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("subtitle sits 4-8px under the H1 and the view tabs stay on one row", async ({ page }) => {
      await page.goto("/playbooks");
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeVisible({ timeout: 30_000 });
      const h1 = await box(page.getByRole("heading", { level: 1, name: "Playbooks" }));
      const subtitle = await box(page.getByText("Inspect policy and follow each execution.", { exact: true }));
      const gap = subtitle.y - (h1.y + h1.height);
      expect(gap).toBeGreaterThanOrEqual(4);
      expect(gap).toBeLessThanOrEqual(8);
      const tablist = page.getByRole("tablist", { name: "Playbook views" });
      expect((await box(tablist)).height).toBeLessThan(56);
      await expect(tablist.getByRole("tab")).toHaveText(["Runs", "Definitions", "Activations", "Admissions"]);
      await expect(tablist.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-selected", "true");
      // Arrow keys move between views (automatic activation).
      await tablist.getByRole("tab", { name: "Runs" }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(tablist.getByRole("tab", { name: "Definitions" })).toBeFocused();
      await expect(tablist.getByRole("tab", { name: "Definitions" })).toHaveAttribute("aria-selected", "true");
      await page.goto("/playbooks");
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeVisible({ timeout: 30_000 });
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/playbooks-${vp.name}.png` });
    });

    test("run detail and activation detail share one back control above the H2", async ({ page }) => {
      await page.goto(run);
      const runHeading = page.getByRole("heading", { level: 2, name: "worker-recovery" });
      await expect(runHeading).toBeVisible({ timeout: 30_000 });
      const tablist = page.getByRole("tablist", { name: "Playbook views" });
      if (vp.phone) {
        await expect(tablist).toBeHidden();
        await expect(page.getByRole("combobox", { name: "Loaded run states" })).toBeHidden();
        const runBack = await backControl(page);
        expect((await box(page.getByRole("link", { name: "All runs" }))).y).toBeLessThan((await box(runHeading)).y);
        expect((await box(runHeading)).y).toBeLessThan(844);
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-run-${vp.name}.png` });

        await openActivation(page);
        const activationHeading = page.getByRole("region", { name: /^Activation / }).getByRole("heading", { level: 2 }).first();
        await expect(activationHeading).toBeVisible({ timeout: 30_000 });
        await expect(tablist).toBeHidden();
        const activationBack = await backControl(page);
        expect(activationBack).toEqual(runBack);
        expect((await box(page.getByRole("link", { name: "All activations" }))).y).toBeLessThan((await box(activationHeading)).y);
        expect((await box(activationHeading)).y).toBeLessThan(844);
        await expectNoHorizontalOverflow(page);
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-act-${vp.name}.png` });
        // The back control returns to the activation list.
        await page.getByRole("link", { name: "All activations" }).click();
        await expect(page).not.toHaveURL(/[?&]activation=/);
        await expect(tablist).toBeVisible();
      } else {
        await expect(tablist).toBeVisible();
        expect((await box(tablist)).height).toBeLessThan(56);
        await expect(page.getByRole("link", { name: "All runs" })).toBeHidden();
        expect((await box(runHeading)).y).toBeLessThan(844);
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-run-${vp.name}.png` });
        await openActivation(page);
        await expect(page.getByRole("region", { name: /^Activation / }).getByRole("heading", { level: 2 }).first()).toBeVisible({ timeout: 30_000 });
        await expect(page.getByRole("link", { name: "All activations" })).toBeHidden();
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-act-${vp.name}.png` });
      }
    });
  });
}
