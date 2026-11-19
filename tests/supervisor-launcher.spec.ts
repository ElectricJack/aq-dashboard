import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Gap SV-E / SHR-K: the "Open supervisor" trigger must never cover page content or controls.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const PAGES = ["/overview", "/agents/sess-07", "/results"];

/**
 * Visible interactive elements in `main` whose visible centre is covered by something else.
 * The band excludes the shell's own pinned chrome (sticky header, fixed phone nav), which is
 * outside this task; only the content viewport between them is checked.
 */
async function occludedControls(page: Page) {
  return page.evaluate(() => {
    const pinned = (el: Element | null) => !!el && /fixed|sticky/.test(getComputedStyle(el).position) && el.getBoundingClientRect().height > 0;
    const banner = document.querySelector("header[class]") ?? document.querySelector("[role=banner]");
    const nav = document.querySelector("nav[aria-label='Primary (compact)']");
    const top = pinned(banner) ? Math.max(0, banner!.getBoundingClientRect().bottom) : 0;
    const bottom = pinned(nav) ? nav!.getBoundingClientRect().top : innerHeight;
    return [...document.querySelectorAll<HTMLElement>(
      "main a[href], main button, main input, main textarea, main select, main summary, main [tabindex]:not([tabindex='-1'])",
    )].filter((el) => {
      // A Gantt link spans the plot for positioning. Its pinned label is the clickable control.
      const hitArea = el.querySelector("[data-gantt-label]") ?? el;
      const r = hitArea.getBoundingClientRect();
      let y0 = Math.max(r.top, top), y1 = Math.min(r.bottom, bottom), x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth);
      // A scroller clips its content: a control scrolled out of one (a key in the phone key bar) is not covered by anything.
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (s.overflowX === "visible" && s.overflowY === "visible") continue;
        const c = p.getBoundingClientRect();
        y0 = Math.max(y0, c.top); y1 = Math.min(y1, c.bottom); x0 = Math.max(x0, c.left); x1 = Math.min(x1, c.right);
      }
      if (y1 - y0 < 1 || x1 - x0 < 1 || !el.checkVisibility({ visibilityProperty: true })) return false;
      const hit = document.elementFromPoint((x0 + x1) / 2, (y0 + y1) / 2);
      return !hit || !(hit === el || el.contains(hit));
    }).map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 60));
  });
}

async function expectNoOcclusionWhileScrolling(page: Page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (const y of [0, Math.round(height / 2), height]) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    expect(await occludedControls(page), `occluded controls at scrollY=${y}`).toEqual([]);
  }
}

async function ready(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator("main h1").first()).toBeVisible();
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const path of PAGES) {
      test(`launcher never covers content on ${path}`, async ({ page }) => {
        await ready(page, path);
        const launcher = page.getByRole("button", { name: "Open supervisor" });
        // Every width: the launcher is in normal flow in the page's title/action row (spec 0002, owner update
        // 2026-11-10), beside the title and above everything else on the page.
        await expect(launcher).toBeVisible();
        expect(await launcher.evaluate((el) => getComputedStyle(el).position)).not.toMatch(/fixed|sticky|absolute/);
        const header = page.locator("main [data-page-header]");
        await expect(header.getByRole("button", { name: "Open supervisor" })).toHaveCount(1);
        const box = (await launcher.boundingBox())!, row = (await header.boundingBox())!, h1 = (await header.locator("h1").boundingBox())!;
        expect(box.y).toBeGreaterThanOrEqual(row.y - 1);
        expect(box.y + box.height).toBeLessThanOrEqual(row.y + row.height + 1);
        expect(box.x).toBeGreaterThanOrEqual(h1.x + h1.width);
        const below = await page.locator("main [data-page-header] ~ *").evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0).map((r) => r.top + scrollY));
        for (const top of below) expect(top).toBeGreaterThanOrEqual(row.y + row.height - 1);
        // Phones keep a full touch target with the label as the accessible name only.
        if (vp.width < 768) expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
        await expectNoOcclusionWhileScrolling(page);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
      });
    }
  });
}

test.describe("desktop-1440 overview", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("All sessions and the capacity link are not occluded", async ({ page }) => {
    await ready(page, "/overview");
    for (const name of [/^All sessions/, /^Inspect (eligibility|configuration)/]) {
      const link = page.locator("main").getByRole("link", { name }).first();
      await link.scrollIntoViewIfNeeded();
      expect(await link.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit && (hit === el || el.contains(hit));
      })).toBe(true);
    }
  });

  test("closing the dock returns focus to the visible trigger", async ({ page }) => {
    await ready(page, "/overview");
    const trigger = page.getByRole("button", { name: "Open supervisor" });
    await trigger.click();
    await expect(page.getByRole("button", { name: "Close chat" })).toBeVisible();
    await expect(trigger).toBeHidden();
    await page.getByRole("button", { name: "Close chat" }).click();
    await expect(trigger).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await occludedControls(page)).toEqual([]);
  });
});
