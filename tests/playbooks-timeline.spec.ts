import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PB-E (reference 06-playbooks.png): inspector tabs, step timeline and Recent evidence table on labelled mock fixtures.
const evidence = "docs/evidence/playbooks-pb-e";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900, vertical: false },
  { name: "m", width: 390, height: 844, vertical: true },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("execution tab draws a step timeline ending at the waiting step", async ({ page }) => {
      await page.goto(`/playbooks/runs/${waiting}`);
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      await expect(inspector.getByRole("tab", { name: "Execution" })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
      await expect(inspector.getByRole("tab", { name: "Inputs & outputs" })).toHaveAttribute("title", "Not offered by this read contract");
      await expect(inspector.getByRole("tab", { name: "Inputs & outputs" })).toHaveAttribute("aria-disabled", "true");
      const timeline = inspector.getByRole("list", { name: "Execution timeline" });
      const steps = timeline.getByRole("listitem");
      await expect(steps).toHaveText([/Inspect attempt\s*Completed/, /Retain source\s*Completed/, /Request review\s*Waiting/]);
      const current = steps.filter({ hasText: "Request review" });
      await expect(current.getByText("Request review")).toBeVisible();
      await expect(current.getByText("Waiting", { exact: true })).toBeVisible();
      await expect(current).toHaveAttribute("aria-current", "step");

      const boxes = await steps.evaluateAll((items) => items.map((li) => li.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom })));
      const panel = (await inspector.getByRole("region", { name: "Recorded execution" }).boundingBox())!;
      for (const b of boxes) {
        expect(b.left).toBeGreaterThanOrEqual(panel.x);
        expect(b.right).toBeLessThanOrEqual(panel.x + panel.width);
        expect(b.bottom).toBeLessThanOrEqual(panel.y + panel.height);
      }
      // Horizontal graph on desktop (one row), vertical stack on phone; no scrolling either way.
      const tops = new Set(boxes.map((b) => Math.round(b.top)));
      expect(tops.size).toBe(vp.vertical ? 3 : 1);
      expect(await timeline.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const texts = await timeline.locator("strong, span").evaluateAll((els) => els.map((el) => ({ w: el.scrollWidth, cw: el.clientWidth })));
      for (const t of texts) expect(t.w).toBeLessThanOrEqual(t.cw + 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await expectNoAxeViolations(page);
      await inspector.getByRole("region", { name: "Recorded execution" }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/after-execution-${vp.name}.png` });
    });

    test("events tab lists receipts in the Recent evidence table", async ({ page }) => {
      await page.goto(`/playbooks/runs/${waiting}`);
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      const events = inspector.getByRole("tab", { name: "Events" });
      await events.click({ timeout: 30_000 });
      await expect(events).toHaveAttribute("aria-selected", "true");
      await expect(inspector.getByRole("tabpanel")).toHaveAttribute("aria-labelledby", await events.getAttribute("id") as string);
      const table = inspector.getByRole("table", { name: /Recent evidence/ });
      const rows = table.locator("tbody tr");
      expect(await rows.count()).toBeGreaterThanOrEqual(4);
      await expect(rows.first().locator("td").first()).toHaveText(/^\d{2}:\d{2}$/);
      await expect(rows.first()).toContainText("Command result · Inspect attempt");
      await expect(table.getByRole("link", { name: "Receipt 2844" })).toHaveAttribute("href", "#receipt-2844");
      await expect(inspector.getByRole("region", { name: "Recent evidence" }).getByText(/^Observed \d+[smhd] ago$/)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      // Arrow keys move between enabled tabs and skip the disabled one.
      await events.focus(); await page.keyboard.press("ArrowRight");
      await expect(inspector.getByRole("tab", { name: "Definition" })).toBeFocused();
      await expect(inspector.getByRole("link", { name: "Open in Definitions" })).toBeVisible();
      await page.keyboard.press("ArrowLeft");
      await expect(events).toHaveAttribute("aria-selected", "true");

      await expectNoAxeViolations(page);
      await table.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${evidence}/after-events-${vp.name}.png` });
    });
  });
}
