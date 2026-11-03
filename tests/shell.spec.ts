import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Widths from docs/plans/0001 D-A11: 320/390 phone, 768 tablet, 1440 desktop.
const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 640, phone: true },
  { name: "phone-390", width: 390, height: 844, phone: true },
  { name: "tablet-768", width: 768, height: 1024, phone: false },
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
];

async function hasPageHorizontalScroll(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
}

function usageSummary(page: Page) {
  return page.getByRole("banner").locator("summary");
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shell renders without page-level horizontal scroll", async ({ page }) => {
      await page.goto("/overview");
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await expect(usageSummary(page).getByText("42% used")).toBeVisible();
      await expect(usageSummary(page)).toHaveAccessibleName(/Provider usage \(account-wide\).*Claude.*42% used.*Codex.*85% used/);
      const summaryBox = (await usageSummary(page).boundingBox())!;
      const connectionBox = (await page.getByRole("banner").getByRole("status").boundingBox())!;
      const overlaps = summaryBox.x < connectionBox.x + connectionBox.width &&
        summaryBox.x + summaryBox.width > connectionBox.x &&
        summaryBox.y < connectionBox.y + connectionBox.height &&
        summaryBox.y + summaryBox.height > connectionBox.y;
      expect(overlaps, "connection status must not obscure provider usage").toBe(false);
      expect(await hasPageHorizontalScroll(page)).toBe(false);
    });

    test("the right navigation is reachable", async ({ page }) => {
      await page.goto("/overview");
      const primary = page.getByRole("navigation", { name: "Primary", exact: true });
      const compact = page.getByRole("navigation", { name: "Primary (compact)" });
      if (vp.phone) {
        await expect(compact).toBeVisible();
        await expect(primary).toBeHidden();
        await compact.getByRole("button", { name: "More" }).click();
        await compact.getByRole("link", { name: "Knowledge" }).click();
      } else {
        await expect(primary).toBeVisible();
        await expect(compact).toBeHidden();
        await primary.getByRole("link", { name: "Knowledge" }).click();
      }
      await expect(page.getByRole("heading", { level: 1, name: "Knowledge" })).toBeFocused();
      expect(await hasPageHorizontalScroll(page)).toBe(false);
    });

    test("has no automatically detectable WCAG A/AA violations", async ({ page }) => {
      await page.goto("/overview");
      await expect(usageSummary(page).getByText("42% used")).toBeVisible();
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    });
  });
}

test("unknown-usage scenario never renders a percentage", async ({ page }) => {
  await page.goto("/overview?scenario=unknown");
  const summary = usageSummary(page);
  await expect(summary.getByText("Usage unavailable").first()).toBeVisible();
  await expect(summary).not.toContainText("%");
  await summary.click();
  const strip = page.getByRole("region", { name: /provider usage/i });
  await expect(strip.getByText("Usage unavailable").first()).toBeVisible();
  await expect(strip).not.toContainText("%");
  await page.getByRole("button", { name: "Close usage details" }).click();
  await expect(strip).toBeHidden();
  await expect(summary).toBeFocused();
});

test("mock mode is labelled on screen", async ({ page }) => {
  await page.goto("/overview");
  await expect(page.getByRole("banner").getByText(/mock data/i)).toBeVisible();
});

test("phone header scrolls away so it cannot obscure focused content", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/overview");
  await expect(usageSummary(page).getByText("42% used")).toBeVisible();
  const position = await page.getByRole("banner").evaluate((el) => getComputedStyle(el).position);
  expect(["static", "relative"]).toContain(position);
});

test.describe("single-row desktop header (gap SH-I)", () => {
  test("1440x900: one row with labelled quota bars and a compact mock chip", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/overview");
    const header = page.getByRole("banner");
    await expect(usageSummary(page).getByText("42% used")).toBeVisible();
    expect((await header.boundingBox())!.height).toBeLessThanOrEqual(72);
    const bars = header.locator("[role=progressbar], meter");
    await expect(bars).toHaveCount(2);
    await expect(bars.nth(0)).toHaveAccessibleName(/Claude.*42% used/);
    await expect(bars.nth(1)).toHaveAccessibleName(/Codex.*85% used/);
    await expect(header.getByText("anthropic ·")).toHaveCount(0);
    await expect(header.getByText(/^Updated \d+s ago$/)).toBeVisible();
    const chip = header.getByRole("note");
    await expect(chip).toHaveText(/^Mock data/);
    expect((await chip.boundingBox())!.height).toBeLessThanOrEqual(24);
    expect(await hasPageHorizontalScroll(page)).toBe(false);
    const results = await new AxeBuilder({ page })
      .include("header")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  for (const width of [1024, 768]) {
    test(`${width}: header keeps at most two rows`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/overview");
      await expect(usageSummary(page).getByText("42% used")).toBeVisible();
      expect((await page.getByRole("banner").boundingBox())!.height).toBeLessThanOrEqual(112);
      expect(await hasPageHorizontalScroll(page)).toBe(false);
    });
  }

  test("390x844: phone keeps per-provider summaries with the compact chip", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/overview");
    const header = page.getByRole("banner");
    await expect(usageSummary(page).getByText("42% used")).toBeVisible();
    await expect(header.getByRole("note")).toHaveText(/^Mock data/);
    await expect(header.getByText("anthropic ·")).toHaveCount(0);
    await expect(usageSummary(page).getByText(/updated 2s ago/)).toBeVisible();
    expect(await hasPageHorizontalScroll(page)).toBe(false);
    const results = await new AxeBuilder({ page })
      .include("header")
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
