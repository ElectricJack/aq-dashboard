import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// RS-G (references 10-results-desktop-v2.png, 13-results-mobile-v2.png): subtitle,
// one toolbar row with inline media/time filters, and More filters for task/custom range.
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];
const SHOTS = process.env.RESULTS_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function box(page: Page, locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("toolbar shows inline media and time filters and a compact header", async ({ page }) => {
      await page.goto("/results");
      const first = page.getByRole("article", { name: /^Result / }).first();
      await expect(first).toBeVisible();
      const media = page.getByRole("combobox", { name: /media/i });
      const time = page.getByRole("combobox", { name: /time/i });
      await expect(media).toBeVisible();
      await expect(time).toBeVisible();
      await expect(time.locator("option")).toHaveText(["Any time", "Last 24 hours", "Last 7 days", "Last 30 days", "Custom…"]);
      await expect(page.getByRole("button", { name: "More filters" })).toBeVisible();
      await expect(page.getByLabel("Task ID")).toHaveCount(0);

      const tabs = await box(page, page.getByRole("tablist", { name: "Result feed mode" }));
      const scope = await box(page, page.getByRole("main").getByRole("combobox", { name: "Scope" }));
      const m = await box(page, media), t = await box(page, time);
      if (vp.name === "d") {
        // Subtitle under the h1; tabs, project, media and time in one row, in that order.
        const h1 = await box(page, page.getByRole("heading", { level: 1, name: "Results" }));
        const subtitle = await box(page, page.getByText("See what changed. Give feedback where it matters."));
        expect(subtitle.y).toBeGreaterThanOrEqual(h1.y + h1.height - 1);
        expect(subtitle.y).toBeLessThan(h1.y + h1.height + 16);
        for (const b of [scope, m, t]) expect(Math.abs(b.y + b.height / 2 - (tabs.y + tabs.height / 2))).toBeLessThan(4);
        expect(tabs.x + tabs.width).toBeLessThanOrEqual(scope.x);
        expect(scope.x + scope.width).toBeLessThanOrEqual(m.x);
        expect(m.x + m.width).toBeLessThanOrEqual(t.x);
      } else {
        // Phone: tabs row, then picker and filters in a second row; at most two rows.
        expect(scope.y).toBeGreaterThanOrEqual(tabs.y + tabs.height);
        for (const b of [m, t]) expect(Math.abs(b.y - scope.y)).toBeLessThan(2);
        expect((await box(page, first)).y).toBeLessThan(420);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-${vp.name}.png` });
      await axe(page);
    });

    test("selecting Last 24 hours applies it to the feed request", async ({ page }) => {
      await page.goto("/results");
      await expect(page.getByRole("article", { name: /^Result / }).first()).toBeVisible();
      const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/v1/results" && new URL(r.url()).searchParams.has("since_ms"));
      const before = Date.now();
      await page.getByRole("combobox", { name: /time/i }).selectOption({ label: "Last 24 hours" });
      const since = Number(new URL((await request).url()).searchParams.get("since_ms"));
      expect(Math.abs(since - (before - 864e5))).toBeLessThan(60_000);
      await expect(page).toHaveURL(/range=24h/);
      await expect(page.getByRole("combobox", { name: /time/i })).toHaveValue("24h");

      const mediaRequest = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/v1/results" && new URL(r.url()).searchParams.get("media") === "image");
      await page.getByRole("combobox", { name: /media/i }).selectOption({ label: "Images" });
      expect(new URL((await mediaRequest).url()).searchParams.get("since_ms")).not.toBeNull();
    });

    test("More filters holds task ID and the custom range", async ({ page }) => {
      await page.goto("/results");
      await expect(page.getByRole("article", { name: /^Result / }).first()).toBeVisible();
      await page.getByRole("combobox", { name: /time/i }).selectOption({ label: "Custom…" });
      const more = page.getByRole("button", { name: "More filters" });
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByLabel("Submitted from")).toBeFocused();
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-more-${vp.name}.png` });
      await axe(page);
      const request = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/v1/results" && new URL(r.url()).searchParams.get("task_id") === "task-1");
      await page.getByLabel("Task ID").fill("task-1");
      await page.getByLabel("Submitted from").fill("2026-10-01T00:00");
      await page.getByRole("button", { name: "Apply filters" }).click();
      const url = new URL((await request).url());
      expect(url.searchParams.get("since_ms")).toBe(String(new Date("2026-10-01T00:00").getTime()));
      await expect(page.getByRole("combobox", { name: /time/i })).toHaveValue("custom");
      await expect(page.getByRole("button", { name: /^More filters\W*2 active$/ })).toBeVisible();
    });
  });
}
