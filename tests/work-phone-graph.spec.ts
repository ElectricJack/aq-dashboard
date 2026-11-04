import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WK-F: Work on phone is list-first and the dependency graph is a dedicated full-viewport view.
const PROJECT = "00000000-0000-0000-0000-000000000001";
const APPROVE = "00000000-0000-0000-0000-000000000104";
const LIST = `/work?scope=project:${PROJECT}`;
const EVIDENCE = process.env.EVIDENCE;

async function expectAxeClean(page: Page, include = "#content") {
  const results = await new AxeBuilder({ page }).include(include)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function evidence(page: Page, name: string) { if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${name}.png` }); }

test.describe("phone 390x844", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("list is first: the first task row is in the viewport above the bottom nav", async ({ page }) => {
    await page.goto(LIST);
    const first = page.getByRole("list", { name: "Tasks" }).locator("li").first();
    await expect(first).toBeInViewport();
    const box = (await first.boundingBox())!;
    expect(box.y).toBeLessThanOrEqual(844 - 100);
    await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Create task" })).toBeVisible();
    await evidence(page, "work-list-phone");
    await expectAxeClean(page);
  });

  test("Graph opens a full-viewport view with Back to list; a node tap keeps view=graph and opens the sheet", async ({ page }) => {
    await page.goto(LIST);
    await page.getByRole("list", { name: "Tasks" }).locator("li").first().waitFor();
    await page.getByRole("navigation", { name: "Work view" }).getByRole("button", { name: "Graph" }).click();
    const region = page.getByRole("region", { name: "Dependency graph" });
    await expect(region).toBeVisible();
    const box = (await region.boundingBox())!;
    expect(box.width * box.height).toBeGreaterThanOrEqual(0.9 * 390 * 844);
    const back = page.getByRole("link", { name: "Back to list" });
    await expect(back).toBeVisible();
    const backBox = (await back.boundingBox())!;
    expect(backBox.x).toBeLessThan(80);
    expect(backBox.y).toBeLessThan(80);
    // The bottom nav is covered by the full-viewport view: the bottom of the screen hits the dialog, not the shell nav.
    expect(await page.evaluate(() => !!document.elementFromPoint(195, 820)?.closest("dialog[open]"))).toBe(true);
    // No selection yet: the view opens on the first loaded task's neighborhood instead of a dead end.
    await expect(region.getByRole("region", { name: "Scrollable task graph" }).getByRole("link").first()).toBeVisible();
    await evidence(page, "work-graph-phone");
    await expectAxeClean(page, "dialog");

    await region.getByRole("region", { name: "Scrollable task graph" }).getByRole("link").first().click();
    await expect(page).toHaveURL(/view=graph/);
    const sheet = region.getByRole("region", { name: /./ }).filter({ has: page.getByRole("link", { name: "Open task" }) });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText(/Selected task/)).toBeVisible();
    await evidence(page, "work-graph-sheet-phone");
    await expectAxeClean(page, "dialog");

    await sheet.getByRole("link", { name: "Open task" }).click();
    await expect(page).not.toHaveURL(/view=graph/);
    await expect(page.getByRole("region", { name: "Dependency graph" })).toHaveCount(0);
  });

  test("Back to list returns to the list with the bottom nav", async ({ page }) => {
    await page.goto(`${LIST}&view=graph&root=${APPROVE}`);
    await page.getByRole("link", { name: "Back to list" }).click();
    await expect(page).not.toHaveURL(/view=graph/);
    await expect(page.getByRole("list", { name: "Tasks" }).locator("li").first()).toBeInViewport();
  });
});

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("list and inline graph keep the desktop workspace", async ({ page }) => {
    await page.goto(LIST);
    await expect(page.getByRole("list", { name: "Tasks" }).locator("li").first()).toBeInViewport();
    // Desktop keeps the WK-D header (reference 02): title, List | Graph and the state chips inline, no phone graph view.
    await expect(page.getByRole("navigation", { name: "Work view" }).getByRole("button", { name: "List" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("group", { name: "Task state" })).toBeVisible();
    await evidence(page, "work-list-desktop");
    await expectAxeClean(page);

    await page.goto(`/work/${APPROVE}?scope=project:${PROJECT}&view=graph&root=${APPROVE}`);
    const region = page.getByRole("region", { name: "Dependency graph" });
    await expect(region.getByRole("link", { name: /Approve/ }).first()).toBeVisible();
    await expect(page.locator("dialog[open]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Back to list" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Recorded relationships" })).toBeVisible();
    await evidence(page, "work-graph-desktop");
    await expectAxeClean(page);
  });
});
