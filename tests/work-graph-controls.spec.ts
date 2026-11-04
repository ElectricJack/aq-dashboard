import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WK-C (sharp-summit-31): directed, typed edges with a legend; zoom, fit and full-screen
// controls; explicit omitted counts; textual relationships that select tasks.
const project = "00000000-0000-0000-0000-000000000001";
const approve = "00000000-0000-0000-0000-000000000104", parent = "00000000-0000-0000-0000-000000000101";
const graphUrl = (root: string, extra = "") => `/work/${root}?scope=project:${project}&view=graph&root=${root}${extra}`;
const evidence = process.env.EVIDENCE_DIR;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const scaleOf = (page: Page) =>
  page.getByRole("region", { name: "Scrollable task graph" }).locator("[data-scale]").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("edges carry arrow markers and the legend names the edge types", async ({ page }) => {
      await page.goto(graphUrl(approve));
      const canvas = page.getByRole("region", { name: "Scrollable task graph" });
      await expect(canvas.getByRole("link", { name: /Fixture: Define lease contract/ })).toBeVisible();
      expect(await canvas.locator("svg marker").count()).toBeGreaterThanOrEqual(1);
      const edges = canvas.locator("svg path[data-edge-type]");
      expect(await edges.count()).toBeGreaterThan(1);
      expect(await canvas.locator("svg path[data-edge-type]:not([marker-end])").count()).toBe(0);
      const legend = page.getByRole("list", { name: /edge types/i });
      await expect(legend).toBeVisible();
      await expect(legend.getByText("prerequisite to dependent")).toBeVisible();
      // Solid, dashed and dotted strokes stay distinct per category.
      const dashes = await edges.evaluateAll((els) => Object.fromEntries(els.map((e) => [e.getAttribute("data-category"), getComputedStyle(e).strokeDasharray])));
      expect(dashes.dependency).toBe("none");
      expect(new Set(Object.values(dashes)).size).toBe(Object.keys(dashes).length);
      // Textual relationships phrase the dependency and link to select the task.
      // Phone (WK-F) collapses them below the dedicated graph view.
      if (vp.name === "phone") await page.getByText(/^Recorded relationships/).click();
      const relation = page.getByRole("listitem").filter({ hasText: "Fixture: Define lease contract must finish before Fixture: Approve recovery plan" });
      await expect(relation.getByRole("link", { name: "Fixture: Define lease contract" })).toHaveAttribute("href", /\/work\/00000000-0000-0000-0000-000000000102/);
      if (evidence) await page.screenshot({ path: `${evidence}/work-graph-after-${vp.name}.png`, fullPage: true });
      await axe(page);
    });

    test("zoom, fit and full-screen controls", async ({ page }) => {
      await page.goto(graphUrl(approve));
      const canvas = page.getByRole("region", { name: "Scrollable task graph" });
      await expect(canvas.getByRole("link").first()).toBeVisible();
      expect(await scaleOf(page)).toBeCloseTo(1);
      await page.getByRole("button", { name: "Zoom in" }).click();
      expect(await scaleOf(page)).toBeCloseTo(1.25);
      await expect(page.getByRole("status", { name: "Zoom level" })).toHaveText("125%");
      // Keyboard inside the focused graph region: 0 resets, - zooms out, arrows pan.
      await canvas.focus();
      await page.keyboard.press("0");
      expect(await scaleOf(page)).toBeCloseTo(1);
      await page.keyboard.press("-");
      expect(await scaleOf(page)).toBeCloseTo(0.75);

      await page.getByRole("button", { name: "Fit graph" }).click();
      for (const node of await canvas.getByRole("link").all()) await expect(node).toBeInViewport();
      const fitted = await scaleOf(page);
      if (evidence) await page.screenshot({ path: `${evidence}/work-graph-fit-${vp.name}.png` });

      await page.getByRole("button", { name: "Full screen", exact: true }).click();
      await expect(page.getByRole("button", { name: "Exit full screen" })).toBeVisible();
      // Full screen refits to the larger canvas; leaving restores the previous zoom.
      await expect.poll(() => scaleOf(page)).toBeGreaterThanOrEqual(fitted);
      for (const node of await canvas.getByRole("link").all()) await expect(node).toBeInViewport();
      if (evidence) await page.screenshot({ path: `${evidence}/work-graph-fullscreen-${vp.name}.png` });
      await page.getByRole("button", { name: "Exit full screen" }).click();
      await expect(page.getByRole("button", { name: "Full screen", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
      await expect.poll(() => scaleOf(page)).toBeCloseTo(fitted);
    });
  });
}

test("served truncation is stated next to the shown count", async ({ page }) => {
  // Large scenario: the parent has 129 children; the served neighborhood is bounded at 64 tasks.
  // The 100-node client cap is unreachable through that contract and is covered in TaskGraph.test.tsx.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(graphUrl(parent, "&scenario=large"));
  await expect(page.getByText("64 of 64 tasks shown · one-hop neighborhood · More relationships exist on the server")).toBeVisible();
  await page.getByRole("button", { name: "Fit graph" }).click();
  await expect(page.getByRole("region", { name: "Scrollable task graph" }).getByRole("link").first()).toBeInViewport();
});
