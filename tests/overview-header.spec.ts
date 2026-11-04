import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// OV-A (reference 01-overview-v3.png): title, plain summary and Create task header.
const project = "00000000-0000-0000-0000-000000000001";
const scoped = `/overview?scope=project:${project}`;
const evidence = "docs/evidence/overview-ov-a";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

function title(page: Page) {
  return page.getByRole("heading", { level: 1, name: "Overview" });
}
function summary(page: Page) {
  return page.getByTestId("overview-summary");
}

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

function intersects(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function expectStackedHeader(page: Page) {
  const h1 = await box(title(page));
  const line = await box(summary(page));
  expect(h1.y + h1.height).toBeLessThanOrEqual(line.y);
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("header stacks title over summary with a visible Create task", async ({ page }) => {
      await page.goto("/overview");
      await expect(page.getByRole("region", { name: "Needs your attention" }).getByRole("listitem").first()).toBeVisible({ timeout: 15_000 });
      await expect(summary(page)).toHaveText("3 decisions need you. Work is moving in 4 projects.");
      await expectStackedHeader(page);
      // All projects: the existing Work path asks for a project first.
      const create = page.getByRole("button", { name: /create task/i });
      await expect(create).toBeVisible();
      await expect(create).toBeDisabled();
      await expect(page.getByText("Choose a project first")).toBeVisible();
      if (vp.name === "d") await expect(create).toBeInViewport();
      else expect(intersects(await box(create), await box(title(page)))).toBe(false);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/overview-A-${vp.name}.png` });
    });

    test("project scope enables Create task and uses the zero summary form", async ({ page }) => {
      await page.goto(scoped);
      await expect(summary(page)).toHaveText("No decisions need you. No work is in motion.", { timeout: 15_000 });
      await expectStackedHeader(page);
      const create = page.getByRole("button", { name: /create task/i });
      await expect(create).toBeEnabled();
      if (vp.name === "d") await expect(create).toBeInViewport();
      else expect(intersects(await box(create), await box(title(page)))).toBe(false);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/overview-A-scoped-${vp.name}.png` });
    });

    test("failed and partial reads keep the header spacing", async ({ page }) => {
      for (const name of ["reads-failed", "partial"]) {
        await page.goto(`/overview?scenario=${name}`);
        await expect(page.getByRole("heading", { level: 2, name: "Needs your attention" })).toBeVisible({ timeout: 20_000 });
        await expect(summary(page)).not.toHaveText(/Checking/, { timeout: 20_000 });
        if (name === "reads-failed") await expect(summary(page)).toHaveText("The overview summary is unavailable.");
        await expectStackedHeader(page);
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/overview-A-${name}-${vp.name}.png` });
      }
    });
  });
}

test("Create task is hidden without tasks.create", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  // Mock scenario whose bootstrap disables tasks.create and the other action capabilities.
  await page.goto("/overview?scenario=actions-unavailable");
  await expect(summary(page)).toHaveText(/3 decisions need you/, { timeout: 15_000 });
  await expect(page.getByRole("button", { name: /create task/i })).toHaveCount(0);
});
