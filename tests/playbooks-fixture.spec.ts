import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PB-A (reference 06-playbooks.png): labelled mock-mode fixtures make the Playbooks page reviewable.
const evidence = "docs/evidence/playbooks-pb-a";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("recent runs list labelled fixture runs in every state", async ({ page }) => {
      await page.goto("/playbooks");
      const runs = page.getByRole("list", { name: "Playbook runs" });
      await expect(page.getByRole("link", { name: /worker-recovery/i })).toBeVisible({ timeout: 30_000 });
      await expect(runs.getByRole("listitem")).toHaveCount(6);
      for (const state of [/Completed/, /Running/, /Needs attention/, /Waiting/]) await expect(runs.getByText(state).first()).toBeAttached();
      await expect(page.getByText(/Fixture: project coding policy/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/playbooks-${vp.name}.png` });
    });

    test("waiting run shows pinned execution, receipts, decision wait and child", async ({ page }) => {
      await page.goto(`/playbooks/runs/${waiting}`);
      await expect(page.getByRole("heading", { name: /Recorded execution/ })).toBeVisible({ timeout: 30_000 });
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      await expect(inspector.getByRole("heading", { name: "Pinned execution" })).toBeAttached();
      await expect(inspector.getByText(/^sha256:a81c9e/).first()).toBeAttached();
      await expect(inspector.getByRole("list", { name: "Execution timeline" }).getByRole("listitem")).toHaveCount(4);
      await expect(inspector.getByText("Human decision")).toBeAttached();
      await expect(inspector.getByRole("link", { name: "run-285" })).toBeAttached();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/playbooks-run-${vp.name}.png`, fullPage: true });
    });

    test("definitions and activations each list one current catalog row", async ({ page }) => {
      for (const kind of ["definitions", "activations"]) {
        await page.goto(`/playbooks?view=${kind}`);
        const list = page.getByRole("list", { name: `Current playbook ${kind}` });
        await expect(list.getByRole("listitem")).toHaveCount(1, { timeout: 30_000 });
        await expect(list.getByText(/worker-recovery/).first()).toBeVisible();
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-${kind}-${vp.name}.png` });
      }
    });
  });
}

test("empty, failed and unavailable scenarios switch playbook reads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/playbooks?scenario=empty");
  await expect(page.getByText("No runs recorded in this configured namespace.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/playbooks?scenario=failed");
  await expect(page.getByText("Couldn't load playbook runs.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /worker-recovery/i })).toHaveCount(0);
  await page.goto("/playbooks?scenario=unavailable");
  await expect(page.getByText(/Playbooks is not available/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/playbook runtime is not configured/)).toBeVisible();
});
