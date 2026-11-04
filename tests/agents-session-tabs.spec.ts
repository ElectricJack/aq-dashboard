import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// AG-B: compact session tabs plus a Sessions listbox, against the labelled mock
// fixtures (8 sessions in src/mocks/inspectionData.ts).
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const switcher = (page: Page) => page.getByRole("navigation", { name: "Session switcher" });
const tabLinks = (page: Page) => switcher(page).locator("a[aria-label]");

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("only opened sessions are tabs; the Sessions listbox opens more and close keeps focus nearby", async ({ page }) => {
    await page.goto("/agents/sess-07");
    const nav = switcher(page);
    await expect(nav.getByRole("link", { name: "Worker 07", exact: true })).toHaveAttribute("aria-current", "page");
    const sessionsButton = nav.getByRole("button", { name: "Sessions 8" });
    await expect(sessionsButton).toBeVisible();
    await expect(tabLinks(page)).toHaveCount(1);
    await expect(nav.getByText("· Running").first()).toBeVisible();
    await expect(page.getByRole("listbox", { name: "Sessions" })).toBeHidden();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-focus-desktop-1440.png` });

    await sessionsButton.click();
    const listbox = page.getByRole("listbox", { name: "Sessions" });
    await expect(listbox).toBeFocused();
    await expect(listbox.getByRole("option")).toHaveCount(8);
    await expect(listbox.getByRole("option", { name: /Worker 07/ })).toHaveAttribute("aria-selected", "true");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-sessions-listbox-desktop-1440.png` });
    await axe(page);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/agents\/sess-12$/);
    await expect(tabLinks(page)).toHaveCount(2);

    // "+" opens the same switcher.
    await nav.getByRole("button", { name: "Open another session" }).click();
    await page.getByRole("listbox", { name: "Sessions" }).getByRole("option", { name: /Worker 21/ }).click();
    await expect(page).toHaveURL(/\/agents\/sess-21$/);
    await expect(tabLinks(page)).toHaveCount(3);
    await expect(nav.getByRole("link", { name: "Worker 21", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("listbox", { name: "Sessions" })).toBeHidden();

    // Escape closes the listbox and returns focus to its trigger.
    await sessionsButton.click();
    await expect(page.getByRole("listbox", { name: "Sessions" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox", { name: "Sessions" })).toBeHidden();
    await expect(sessionsButton).toBeFocused();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-tabs-desktop-1440.png` });
    await axe(page);

    // Closing a background tab keeps focus on its neighbour.
    await nav.getByRole("button", { name: "Close Worker 12" }).click();
    await expect(tabLinks(page)).toHaveCount(2);
    await expect(nav.getByRole("link", { name: "Worker 21", exact: true })).toBeFocused();

    // Closing the current tab moves to the neighbouring session and focuses its tab.
    await nav.getByRole("button", { name: "Close Worker 21" }).click();
    await expect(page).toHaveURL(/\/agents\/sess-07$/);
    await expect(tabLinks(page)).toHaveCount(1);
    await expect(switcher(page).getByRole("link", { name: "Worker 07", exact: true })).toBeFocused();
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("tabs collapse into the session dropdown with no clipped labels", async ({ page }) => {
    await page.goto("/agents/sess-07");
    const nav = switcher(page);
    const dropdown = nav.getByRole("button", { name: "Switch session, current Worker 07" });
    await expect(dropdown).toBeVisible();
    await expect(tabLinks(page).first()).toBeHidden();
    await expect(page.getByRole("listbox", { name: "Sessions" })).toBeHidden();
    const clipped = await nav.evaluate((el) =>
      [...el.querySelectorAll<HTMLElement>("a, button, span:not(.visually-hidden)")].filter((n) => n.checkVisibility() && n.scrollWidth > n.clientWidth).map((n) => n.textContent));
    expect(clipped).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-tabs-phone-390.png` });
    await axe(page);

    await dropdown.click();
    const listbox = page.getByRole("listbox", { name: "Sessions" });
    await expect(listbox.getByRole("option")).toHaveCount(8);
    const box = await page.locator("[role=listbox]").evaluate((el) => el.parentElement!.getBoundingClientRect().right);
    expect(box).toBeLessThanOrEqual(390);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-sessions-listbox-phone-390.png` });
    await axe(page);
    await listbox.getByRole("option", { name: /Worker 12/ }).click();
    await expect(page).toHaveURL(/\/agents\/sess-12$/);
    await expect(nav.getByRole("button", { name: "Switch session, current Worker 12" })).toBeVisible();
  });
});
