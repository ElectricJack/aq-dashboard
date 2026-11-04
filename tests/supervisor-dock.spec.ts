import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// SV-H (sharp-beacon-18): the docked conversation is a full-height edge pane (04-supervisor-chat.png).
const shots = process.env.AQ_EVIDENCE_DIR;

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("dock is flush with the header bottom and the viewport edges, with only expand and close", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.getByRole("button", { name: "Open supervisor" }).click();
    const dock = page.getByRole("region", { name: "Global supervisor conversation" });
    await expect(dock.getByRole("heading", { name: "Global supervisor" })).toBeVisible();
    const pane = dock.locator("xpath=..");
    const header = (await page.getByRole("banner").boundingBox())!;
    const box = (await pane.boundingBox())!;
    expect(Math.abs(box.x + box.width - 1440)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(box.y + box.height - 900)).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(360);
    const style = await pane.evaluate(el => { const s = getComputedStyle(el); return { radius: s.borderTopLeftRadius, left: s.borderLeftWidth, right: s.borderRightWidth, top: s.borderTopWidth }; });
    expect(style).toEqual({ radius: "0px", left: "1px", right: "0px", top: "0px" });
    await expect(dock.locator("header").getByRole("button")).toHaveCount(2);
    await expect(dock.locator("header").getByRole("button", { name: "Expand conversation" })).toBeVisible();
    await expect(dock.locator("header").getByRole("button", { name: "Close chat" })).toBeVisible();

    // The pane stays under the sticky header while the page scrolls.
    await page.mouse.wheel(0, 400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const scrolled = (await pane.boundingBox())!;
    expect(Math.abs(scrolled.y - (header.y + header.height))).toBeLessThanOrEqual(1);
    expect(Math.abs(scrolled.y + scrolled.height - 900)).toBeLessThanOrEqual(1);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    if (shots) await page.screenshot({ path: `${shots}/supervisor-dock-d.png` });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone does not dock: the supervisor opens as its own page", async ({ page }) => {
    await page.goto("/overview");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open supervisor" })).toBeHidden();
    await page.goto("/supervisor");
    const conversation = page.getByRole("region", { name: "Global supervisor conversation" });
    await expect(conversation.getByRole("heading", { level: 1, name: "Global supervisor" })).toBeVisible();
    await expect(page.locator("[data-docked]")).toHaveCount(0);
    await expect(conversation.locator("xpath=..")).toHaveAttribute("data-mode", "full");
    await expect(conversation.getByRole("button", { name: "Expand conversation" })).toHaveCount(0);
    if (shots) await page.screenshot({ path: `${shots}/supervisor-dock-m.png` });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations.map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});
