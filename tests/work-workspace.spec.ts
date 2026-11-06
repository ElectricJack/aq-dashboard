import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WK-D: dedicated Work task workspace against the labelled mock fixture (src/mocks/humanGraph.ts).
const project = "00000000-0000-0000-0000-000000000001";
const scope = `scope=project:${project}`;
const evidence = process.env.EVIDENCE_DIR;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("state chip filters rows from the URL and survives reload", async ({ page }) => {
      await page.goto(`/work?${scope}&state=draft`);
      const rows = page.getByRole("list", { name: "Tasks" }).getByRole("listitem");
      await expect(rows).toHaveCount(2);
      // One line per task; the status is the bullet's accessible name (spec 0004 item 16).
      await expect(rows.getByRole("img", { name: "Draft" })).toHaveCount(2);
      for (const text of await rows.allTextContents()) expect(text).not.toMatch(/Draft|· r\d/);
      const draft = page.getByRole("group", { name: "Task state" }).getByRole("button", { name: "Draft" });
      await expect(draft).toHaveAttribute("aria-pressed", "true");
      await page.reload();
      await expect(draft).toHaveAttribute("aria-pressed", "true");
      await expect(rows).toHaveCount(2);
      await expect(page.getByRole("button", { name: "List", exact: true })).toHaveAttribute("aria-pressed", "true");
      if (evidence) await page.screenshot({ path: `${evidence}/work-workspace-list-${vp.name}.png` });
      await axe(page);
    });

    test("rows never repeat a word or show knowledge verification", async ({ page }) => {
      await page.goto(`/work?${scope}`);
      const rows = page.getByRole("list", { name: "Tasks" }).getByRole("listitem");
      await expect(rows).toHaveCount(10);
      for (const text of await rows.allTextContents()) {
        expect(text).not.toMatch(/(\w+) · \1/);
        expect(text).not.toMatch(/verified|disputed/i);
      }
      await expect(page.getByText("Execution details unavailable")).toHaveCount(0);
    });

    test("graph view with no selection renders the first task's neighborhood", async ({ page }) => {
      await page.goto(`/work?${scope}&view=graph`);
      const canvas = page.getByRole("region", { name: "Scrollable task graph" });
      await expect(canvas.getByRole("link").first()).toBeVisible();
      await expect(page.getByText(/Select a task from the list/)).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Graph", exact: true })).toHaveAttribute("aria-pressed", "true");
      if (vp.width >= 1200) {
        const ratio = await page.evaluate(() => {
          const graph = document.querySelector("[aria-label='Scrollable task graph']")!.closest("section")!;
          return graph.getBoundingClientRect().width / document.querySelector("main")!.getBoundingClientRect().width;
        });
        expect(ratio).toBeGreaterThanOrEqual(0.55);
      }
      if (evidence) await page.screenshot({ path: `${evidence}/work-workspace-graph-${vp.name}.png` });
      await axe(page);
    });
  });
}
