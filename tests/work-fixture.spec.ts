import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Labelled mock fixture mirroring design reference 02 (src/mocks/humanGraph.ts).
const project = "00000000-0000-0000-0000-000000000001", approve = "00000000-0000-0000-0000-000000000104";
const scope = `scope=project:${project}`;
const evidence = process.env.EVIDENCE_DIR;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("fixture project lists the reference tasks with Create task enabled", async ({ page }) => {
      await page.goto(`/work?${scope}`);
      await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(10);
      await expect(page.getByRole("button", { name: "Create task" })).toBeEnabled();
      if (evidence) await page.screenshot({ path: `${evidence}/work-list-${vp.name}.png`, fullPage: true });
      await axe(page);
    });

    test("fixture graph shows at least three relationship types", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}&view=graph&root=${approve}`);
      const graph = page.getByRole("region", { name: "Dependency graph" });
      await expect(graph.getByRole("link", { name: /Fixture: Define lease contract/ }).first()).toBeVisible();
      const types = await graph.locator("[data-edge-type]").evaluateAll((els) => [...new Set(els.map((e) => e.getAttribute("data-edge-type")))]);
      expect(types.length).toBeGreaterThanOrEqual(3);
      if (evidence) await page.screenshot({ path: `${evidence}/work-graph-${vp.name}.png`, fullPage: true });
      await axe(page);
    });
  });
}

test("actions-unavailable scenario disables Create task", async ({ page }) => {
  await page.goto(`/work?${scope}&scenario=actions-unavailable`);
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(10);
  await expect(page.getByRole("button", { name: "Create task" })).toBeDisabled();
});

test("large scenario caps the list at 100 loaded tasks and marks the omission", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/work?${scope}&scenario=large`);
  const list = page.getByRole("list", { name: "Tasks" });
  for (let n = 25; n < 100; n += 25) {
    await expect(list.getByRole("listitem")).toHaveCount(n);
    await page.getByRole("button", { name: "Load more tasks" }).click();
  }
  await expect(list.getByRole("listitem")).toHaveCount(100);
  await expect(page.getByText("Showing at most 100 records. Refine your search for more.")).toBeVisible();
});
