import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PB-C (reference 06-playbooks.png, Recent runs region): compact two-line rows, state/time filters, relative ages.
const evidence = "docs/evidence/playbooks-pb-c";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  // The phone hides the roster while a run is focused, so the list is reviewed at /playbooks there.
  { name: "d", width: 1440, height: 900, path: `/playbooks/runs/${waiting}` },
  { name: "m", width: 390, height: 844, path: "/playbooks" },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("recent runs render compact rows with relative ages and loaded-row filters", async ({ page }) => {
      await page.goto(vp.path);
      const list = page.getByRole("list", { name: "Playbook runs" });
      const links = list.getByRole("link", { name: /run-/ });
      await expect(links.first()).toBeVisible({ timeout: 30_000 });
      const count = await links.count();
      expect(count).toBeGreaterThan(0);

      const row = list.getByRole("link", { name: new RegExp(waiting) });
      // Visible line 2 is `run-284 · 18m ago`; the full id stays in title and (visually hidden) in the accessible name.
      await expect(row.getByTitle(waiting)).toHaveText("run-284");
      await expect(row.locator("time")).toHaveText("18m ago");
      await expect(row.locator("time")).toHaveAttribute("dateTime", /^\d{4}-\d{2}-\d{2}T/);
      if (vp.name === "d") {
        await expect(row).toHaveAttribute("aria-current", "page");
        for (let i = 0; i < count; i++) expect((await links.nth(i).boundingBox())!.height).toBeLessThanOrEqual(80);
      }
      // No raw ISO instants in visible list text; they live only in dateTime/title.
      expect(await list.innerText()).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
      const clipped = await list.locator("strong, span:not(.visually-hidden), time").evaluateAll((els) => els.filter((el) => getComputedStyle(el).textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1).length);
      expect(clipped).toBe(0);

      await expect(page.getByRole("combobox", { name: /run state/i })).toHaveValue("all");
      const range = page.getByRole("combobox", { name: /time range/i });
      await expect(range).toHaveValue("24h");
      // The default window is named by its own control; nothing announces filtering (ISSUE-005).
      await expect(page.getByText("Filtering loaded runs")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh runs" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/after-runs-${vp.name}.png` });

      await range.selectOption("all");
      await expect(page.getByText("Filtering loaded runs")).toBeHidden();
      await expect(links).toHaveCount(count);
    });
  });
}
