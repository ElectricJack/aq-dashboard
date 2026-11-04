import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// PB-F (reference 06-playbooks.png, "Waiting on" and "Child workflows"): typed wait and joined child rows on mock fixtures.
const evidence = "docs/evidence/playbooks-pb-f";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`${vp.width}x${vp.height} waiting run shows typed wait and child workflow rows`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/playbooks/runs/${waiting}`);
    const inspector = page.getByRole("region", { name: `Run ${waiting}` });
    const wait = inspector.getByRole("region", { name: "Waiting on" });
    const children = inspector.getByRole("region", { name: "Child workflows" });
    await expect(children.getByText("Completed")).toBeVisible({ timeout: 30_000 });

    await wait.scrollIntoViewIfNeeded();
    await expect(page.getByText("Human decision")).toBeVisible();
    await expect(wait.getByText(/Implementation stays paused/)).toBeVisible();
    await expect(wait.getByRole("list", { name: "Pending operations" }).getByText("decision.request")).toBeVisible();
    // The inspection read supplies no decision target, so no "Open decision" action is drawn.
    await expect(wait.getByRole("link")).toHaveCount(0);

    await expect(children.getByText("validate-recovery-inputs")).toBeVisible();
    await expect(children.getByText(/Owned child/)).toBeVisible();
    await expect(children.getByRole("link", { name: /run-285/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);

    await page.screenshot({ path: `${evidence}/playbooks-run-${vp.name}.png`, fullPage: true });
    await wait.locator("..").screenshot({ path: `${evidence}/playbooks-relations-${vp.name}.png` });
  });

  test(`${vp.width}x${vp.height} child run links back to its parent`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`/playbooks/runs/${waiting}`);
    await page.getByRole("region", { name: "Child workflows" }).getByRole("link", { name: /run-285/ }).click({ timeout: 30_000 });
    await expect(page).toHaveURL(/run-0000000000000285/);
    const children = page.getByRole("region", { name: "Child workflows" });
    await expect(children.getByText("No child workflows recorded.")).toBeVisible({ timeout: 30_000 });
    await expect(children.getByRole("link", { name: /run-284/ })).toBeVisible();
  });
}
