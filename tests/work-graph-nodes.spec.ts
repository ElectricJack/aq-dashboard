import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// WK-A (sound-lantern-39): graph node cards show up to two title lines and then the
// state line, with no overlap or clipped overflow, at desktop and phone widths.
const project = "00000000-0000-0000-0000-000000000001", root = "00000000-0000-0000-0000-000000000003";
const url = `/work/${root}?scope=project:${project}&view=graph&root=${root}`;
const LONG = "A deliberately long fixture task title that needs far more than two lines inside one graph node card";

async function measure(page: Page) {
  return page.locator(`[aria-label="Scrollable task graph"] a`).evaluateAll((cards) =>
    cards.map((card) => {
      const title = card.querySelector("strong")!, state = card.querySelector("span")!;
      const t = title.getBoundingClientRect(), s = state.getBoundingClientRect(), c = card.getBoundingClientRect();
      return {
        name: title.textContent,
        titleBottom: t.bottom, stateTop: s.top, stateBottom: s.bottom, cardBottom: c.bottom,
        // Fractional lines mean the title's row was squeezed and its text is cut off.
        titleLines: t.height / parseFloat(getComputedStyle(title).lineHeight),
        scroll: card.scrollHeight, client: card.clientHeight,
        titleScroll: title.scrollWidth, titleClient: title.clientWidth,
      };
    }),
  );
}

function expectFits(cards: Awaited<ReturnType<typeof measure>>) {
  expect(cards.length).toBeGreaterThan(1);
  for (const c of cards) {
    expect(c.titleBottom, `${c.name}: title overlaps state`).toBeLessThanOrEqual(c.stateTop);
    expect(c.stateBottom, `${c.name}: state line clipped`).toBeLessThanOrEqual(c.cardBottom);
    expect(c.scroll, `${c.name}: card overflows`).toBeLessThanOrEqual(c.client);
    expect(c.titleScroll, `${c.name}: title overflows sideways`).toBeLessThanOrEqual(c.titleClient);
    expect(Math.abs(c.titleLines - Math.round(c.titleLines)), `${c.name}: title shows a partial line`).toBeLessThan(0.05);
    expect(c.titleLines).toBeGreaterThan(0.95);
    expect(c.titleLines).toBeLessThan(2.05);
  }
}

for (const vp of [{ name: "desktop-1440", width: 1440, height: 900 }, { name: "phone-390", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("graph node titles and state lines do not overlap or clip, and axe passes", async ({ page }) => {
      await page.goto(url);
      const graph = page.getByRole("region", { name: "Scrollable task graph" });
      await expect(graph.getByRole("link", { name: "Contract fixture: task inspection" })).toBeVisible();
      const cards = await measure(page);
      expectFits(cards);
      // The fixture title wraps to two lines on the 220px card.
      expect(cards.find((c) => c.name === "Contract fixture: task inspection")?.titleLines).toBeCloseTo(2, 1);
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    });

    test("an overlong title clamps to two lines and keeps the full title as the tooltip", async ({ page }) => {
      await page.goto(url);
      const first = page.locator(`[aria-label="Scrollable task graph"] a`).first();
      await expect(first).toBeVisible();
      // Layout stress only: the mock fixture has no long title, so lengthen one rendered title in place.
      await first.evaluate((card, long) => { card.querySelector("strong")!.textContent = long; card.setAttribute("title", long); }, LONG);
      expectFits(await measure(page));
      await expect(first).toHaveAttribute("title", LONG);
    });
  });
}
