import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-06 fixes on Results (RA-04, RA-06, RA-07, RA-11, RA-12, RA-19, RA-20, RA-21) against the
// labelled results fixture (src/mocks/results.ts). RA-08's empty tabs need an empty feed, so they are unit-tested.
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const cards = (page: Page) => page.getByRole("list", { name: "Results feed" }).getByRole("article", { name: /^Result / });

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("RA-06/RA-07: feed tabs are ARIA tabs with arrow keys and keep focus; filters keep focus", async ({ page }) => {
    await page.goto("/results");
    await expect(cards(page).first()).toBeVisible();
    const tabs = page.getByRole("tab");
    await expect(tabs.nth(0)).toHaveAttribute("tabindex", "0");
    await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");
    await expect(page.getByRole("tabpanel", { name: "Latest" })).toBeVisible();
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page).toHaveURL(/mode=needs_review/);
    await expect(page.getByRole("tab", { name: "Needs review" })).toBeFocused();
    await expect(page.getByRole("tab", { name: "Needs review" })).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "Latest" })).toBeFocused();
    await page.getByRole("combobox", { name: "Media type" }).focus();
    await page.getByRole("combobox", { name: "Media type" }).selectOption({ label: "Images" });
    await expect(page).toHaveURL(/media=image/);
    await expect(page.getByRole("combobox", { name: "Media type" })).toBeFocused();
    await axe(page);
  });

  test("RA-04/RA-11/RA-12: cards name result and revision, clamp long summaries and offer no review dead end", async ({ page }) => {
    await page.goto("/results");
    const card = cards(page).first();
    await expect(card.getByText(/^Result [0-9a-f]{8}$/)).toHaveAttribute("title", /^[0-9a-f-]{36}$/);
    await expect(card.getByText(/^revision [0-9a-f]{7}$/)).toBeVisible();
    await expect(card.getByRole("link", { name: /review result/i })).toHaveCount(0);
    const size = await card.getByRole("heading", { level: 2 }).evaluate((h) => parseFloat(getComputedStyle(h).fontSize));
    expect(size).toBeLessThanOrEqual(17);
  });

  test("RA-19: Custom… without dates is not an active filter", async ({ page }) => {
    await page.goto("/results");
    await expect(cards(page).first()).toBeVisible();
    await page.getByRole("combobox", { name: "Time range" }).selectOption({ label: "Custom…" });
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).not.toHaveURL(/range=custom/);
    await expect(page.getByRole("button", { name: /More filters/ })).not.toContainText("active");
    await expect(page.getByRole("combobox", { name: "Time range" })).toHaveValue("any");
  });

  test("RA-20: a malformed result link is neutral and keeps Back to results", async ({ page }) => {
    await page.goto("/results/not-a-uuid/revisions/abc");
    await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
    await page.getByRole("link", { name: "Back to results" }).click();
    await expect(page).toHaveURL(/\/results$/);
    await expect(cards(page).first()).toBeVisible();
  });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("RA-21: phone filter selects show their whole label", async ({ page }) => {
    await page.goto("/results");
    await expect(cards(page).first()).toBeVisible();
    const clipped = await page.locator("main select").evaluateAll((selects) => selects.map((s) => {
      const select = s as HTMLSelectElement, style = getComputedStyle(select);
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const text = select.selectedOptions[0]?.text ?? "";
      const room = select.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      return context.measureText(text).width > room + 0.5 ? `${text}: ${context.measureText(text).width} > ${room}` : null;
    }).filter(Boolean));
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
