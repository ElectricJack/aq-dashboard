import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** DC-L: reference 03 inbox (segmented Open | Resolved, rows) and phone list-then-detail. Mock mode fixture. */
const EVIDENCE = process.env.DCL_EVIDENCE_DIR;
const DECISION = "00000000-0000-4000-8000-000000000001";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}/;

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("inbox tabs show the selected state, rows are readable and the page passes axe", async ({ page }) => {
    await page.goto("/decisions");
    const inbox = page.getByRole("list", { name: /inbox/i });
    await expect(inbox.getByRole("listitem")).toHaveCount(1);
    await expect(page.getByText("1 shown · sampled from your reviews")).toBeVisible();
    const tabs = page.getByRole("group", { name: "Review state" });
    const open = tabs.getByRole("button", { name: /^Open/ });
    const resolved = tabs.getByRole("button", { name: /Resolved/ });
    await expect(open).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveText("Open1");
    await expect(page.getByRole("button", { name: "Refresh reviews" })).toBeVisible();

    const row = inbox.getByRole("link");
    await expect(row).toContainText("Review task 00000000");
    await expect(row).toContainText("· Review");
    await expect(row).toContainText(/Expires in \d+[smhd]/);
    for (const text of await inbox.locator("li").allInnerTexts()) expect(text).not.toMatch(UUID);
    // Nothing selected: the context column holds a concise placeholder.
    await expect(page.getByRole("region", { name: "Decision context" })).toContainText("appear here");
    await expect(page.getByRole("link", { name: "All decisions" })).toBeHidden();
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-inbox-desktop-1440.png` });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);

    await resolved.click();
    await expect(resolved).toHaveAttribute("aria-pressed", "true");
    await expect(open).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("No resolved reviews")).toBeVisible();
    const bg = (el: Element) => getComputedStyle(el).backgroundColor;
    expect(await resolved.evaluate(bg)).not.toBe(await open.evaluate(bg));
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-resolved-desktop-1440.png` });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  });

  test("selected row carries the attention border", async ({ page }) => {
    await page.goto(`/decisions/${DECISION}`);
    const row = page.getByRole("list", { name: /inbox/i }).getByRole("link");
    await expect(row).toHaveAttribute("aria-current", "page");
    const border = await row.evaluate(el => getComputedStyle(el).borderInlineStartColor);
    const attention = await page.evaluate(() => {
      const probe = document.createElement("span"); probe.style.color = "var(--color-attention)"; document.body.append(probe);
      const c = getComputedStyle(probe).color; probe.remove(); return c;
    });
    expect(border).toBe(attention);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-selected-desktop-1440.png` });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("list then detail: a selected review replaces the inbox with a way back", async ({ page }) => {
    await page.goto("/decisions");
    await expect(page.getByRole("list", { name: /inbox/i })).toBeVisible();
    await expect(page.getByRole("region", { name: "Decision context" })).toBeHidden();
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-inbox-phone-390.png` });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);

    await page.goto(`/decisions/${DECISION}`);
    await expect(page.getByRole("heading", { name: "Decision context" })).toBeAttached();
    await expect(page.getByRole("list", { name: /inbox/i })).not.toBeVisible();
    const back = page.getByRole("link", { name: "All decisions" });
    await expect(back).toBeVisible();
    const evidence = page.getByRole("heading", { name: "Acceptance criteria" });
    expect((await back.boundingBox())!.y).toBeLessThan((await evidence.boundingBox())!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-selected-phone-390.png` });
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);

    await back.click();
    await expect(page).toHaveURL(/\/decisions\?state=open$/);
    await expect(page.getByRole("list", { name: /inbox/i })).toBeVisible();
  });
});
