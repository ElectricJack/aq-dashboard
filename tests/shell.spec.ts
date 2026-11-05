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
      // Phone keeps connection status in the header; wider layouts move it to
      // the rail footer and end the header with the Settings avatar instead.
      const neighbour = vp.phone
        ? page.getByRole("banner").getByRole("status")
        : page.getByRole("banner").getByRole("link", { name: /^Settings, signed in as/ });
      const connectionBox = (await neighbour.boundingBox())!;
      const overlaps = summaryBox.x < connectionBox.x + connectionBox.width &&
        summaryBox.x + summaryBox.width > connectionBox.x &&
        summaryBox.y < connectionBox.y + connectionBox.height &&
        summaryBox.y + summaryBox.height > connectionBox.y;
      expect(overlaps, "header controls must not obscure provider usage").toBe(false);
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
        await page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Knowledge" }).click();
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

function within(inner: { x: number; y: number; width: number; height: number }, outer: { x: number; y: number; width: number; height: number }) {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 &&
    inner.x + inner.width <= outer.x + outer.width + 0.5 &&
    inner.y + inner.height <= outer.y + outer.height + 0.5;
}

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

test.describe("rail scope, Decisions badge, connection and avatar (gap SH-J)", () => {
  test("1440x900: scope picker, badge, connection and identity live in the rail", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/overview");
    const rail = page.getByRole("complementary", { name: "Application navigation" });
    const primary = page.getByRole("navigation", { name: "Primary", exact: true });
    const scope = primary.getByRole("combobox", { name: "Scope" });
    await expect(scope).toBeVisible();
    await expect(page.getByRole("banner").getByRole("combobox")).toHaveCount(0);
    const railBox = (await rail.boundingBox())!;
    expect(within((await scope.boundingBox())!, railBox), "scope picker inside the rail").toBe(true);

    const decisions = primary.getByRole("link", { name: /decisions, \d+ pending/i });
    await expect(decisions).toBeVisible();
    await expect(decisions).toHaveAccessibleName("Decisions, 3 pending");

    const connection = rail.getByRole("status").filter({ hasText: "Connected" });
    await expect(connection).toBeVisible();
    await expect(page.getByRole("banner").getByRole("status")).toHaveCount(0);
    expect(within((await connection.boundingBox())!, railBox), "connection inside the rail footer").toBe(true);
    expect((await connection.boundingBox())!.y).toBeGreaterThan((await primary.getByRole("link", { name: "Settings" }).boundingBox())!.y);

    await expect(rail.getByText("SO", { exact: true })).toBeVisible();
    const avatar = page.getByRole("banner").getByRole("link", { name: /^Settings, signed in as/ });
    await expect(avatar.getByText("SO", { exact: true })).toBeVisible();
    await expect(avatar).toHaveAttribute("href", /^\/settings/);
    expect(await hasPageHorizontalScroll(page)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("1440x900: empty scenario shows no Decisions badge", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/overview?scenario=empty");
    await expect(page.getByText("Nothing needs your attention")).toBeVisible();
    const primary = page.getByRole("navigation", { name: "Primary", exact: true });
    await expect(primary.getByRole("link", { name: "Decisions", exact: true })).toBeVisible();
    await expect(primary.getByRole("link", { name: /pending/i })).toHaveCount(0);
  });

  test("390x844: phone keeps scope and connection in the header with no hidden rail", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/overview");
    const header = page.getByRole("banner");
    await expect(header.getByRole("combobox", { name: "Scope" })).toBeVisible();
    await expect(header.getByRole("status")).toHaveText("Connected");
    await expect(page.getByRole("complementary", { name: "Application navigation" })).toBeHidden();
    const compact = page.getByRole("navigation", { name: "Primary (compact)" });
    await compact.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("dialog", { name: "More" }).getByRole("link", { name: "Decisions, 3 pending" })).toBeVisible();
    expect(await hasPageHorizontalScroll(page)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe("phone More sheet (gap SH-K)", () => {
  test("390x844: More opens a labelled sheet that returns focus", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/overview");
    await expect(usageSummary(page).getByText("42% used")).toBeVisible();
    const compact = page.getByRole("navigation", { name: "Primary (compact)" });
    const more = compact.getByRole("button", { name: "More" });
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await more.click();
    await expect(sheet).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(sheet.getByRole("link", { name: "Decisions, 3 pending" })).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Close" })).toBeVisible();
    // Focus stays trapped in the modal sheet.
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
    const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    // A click on the scrim above the sheet closes it.
    await more.click();
    await expect(sheet).toBeVisible();
    await page.mouse.click(195, 60);
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: "Close" }).click();
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();

    await more.click();
    await sheet.getByRole("link", { name: "Work" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Work" })).toBeFocused();
    await expect(sheet).toBeHidden();
    await expect(more).toHaveAttribute("data-active", "true");
  });

  test("320x640: the quota wraps and the More sheet fits without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto("/overview");
    await expect(usageSummary(page).getByText("42% used")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    // Each provider column stays inside the header; its text wraps rather than overflowing.
    const header = (await page.getByRole("banner").boundingBox())!;
    for (const entry of await usageSummary(page).locator("[class*=summaryEntry]").all()) {
      const box = (await entry.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(header.x);
      expect(box.x + box.width).toBeLessThanOrEqual(header.x + header.width + 0.5);
    }
    await page.getByRole("navigation", { name: "Primary (compact)" }).getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("dialog", { name: "More" });
    await expect(sheet).toBeVisible();
    const box = (await sheet.boundingBox())!;
    expect(box.width).toBeLessThanOrEqual(320);
    expect(box.y + box.height).toBeLessThanOrEqual(640.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  });

  test("390x844: focusing the supervisor composer hides the bottom nav", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/supervisor");
    const nav = page.getByRole("navigation", { name: "Primary (compact)" });
    await expect(nav).toBeVisible();
    await page.getByRole("textbox", { name: "Message the global supervisor" }).focus();
    await expect(nav).toBeHidden();
    expect(await page.locator("main").evaluate((el) => getComputedStyle(el).getPropertyValue("--shell-bottom-nav-height").trim())).toBe("0px");
    await page.getByRole("heading", { level: 1, name: "Global supervisor" }).focus();
    await expect(nav).toBeVisible();
  });
});
