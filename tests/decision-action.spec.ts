import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * DC-K: reference 03 decision bar (note, applies-to line, primary Approve, Request changes),
 * sticky on phone, honest unavailability and conflict recovery. Mock mode (DC-N fixtures):
 * the fixture principal is an eligible owner of the reference review, `decision-conflict`
 * refuses every answer with 409 and `actions-unavailable` withdraws `decisions.resolve`.
 */
const EVIDENCE = process.env.DCK_EVIDENCE_DIR;
const DECISION = "00000000-0000-4000-8000-000000000001";
const UNAVAILABLE_REASON = "Fixture scenario: actions are not offered";

const accent = (page: Page) => page.evaluate(() => {
  const probe = document.createElement("span"); probe.style.backgroundColor = "var(--color-accent)"; document.body.append(probe);
  const value = getComputedStyle(probe).backgroundColor; probe.remove(); return value;
});

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
}

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("full-width bar with primary Approve, and conflict recovery keeps the note", async ({ page }) => {
    await page.goto(`/decisions/${DECISION}?scenario=decision-conflict`);
    const bar = page.getByRole("region", { name: "Your decision" });
    const approve = bar.getByRole("button", { name: /Approve/ });
    await expect(approve).toHaveText("Approve task version 3");
    await expect(bar.getByText("Decision applies only to task version 3 · report 00000000…0005.")).toBeVisible();
    await expect(bar.getByRole("button", { name: "Request changes" })).toBeVisible();

    expect(await approve.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(await accent(page));
    const evidence = (await page.getByRole("region", { name: /^Review task/ }).boundingBox())!;
    const context = (await page.getByRole("region", { name: "Decision context" }).boundingBox())!;
    const box = (await bar.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(context.x + context.width - evidence.x);
    expect(await bar.evaluate(el => getComputedStyle(el).position)).toBe("sticky");
    // Docked under the columns: the bar starts below the evidence and context panes' tops.
    expect(box.y).toBeGreaterThan(evidence.y);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-action-desktop-1440.png` });
    await axe(page);

    const note = bar.getByRole("textbox", { name: "Decision note" });
    await note.fill("Recovery evidence reviewed");
    await approve.click();
    await expect(bar.getByText(/The review changed/)).toBeVisible();
    await expect(note).toHaveValue("Recovery evidence reviewed");
    await expect(bar.getByRole("button", { name: /Approve/ })).toHaveCount(0);
    if (EVIDENCE) await bar.screenshot({ path: `${EVIDENCE}/decisions-action-conflict-desktop-1440.png` });
    await axe(page);

    await bar.getByRole("button", { name: "Refresh evidence and answer again" }).click();
    await expect(page.getByRole("button", { name: /Approve/ })).toBeVisible();
    await expect(note).toHaveValue("Recovery evidence reviewed");
    await expect(bar.getByText(/Evidence refreshed/)).toBeVisible();
  });

  test("capability off names the server's reason", async ({ page }) => {
    await page.goto(`/decisions/${DECISION}?scenario=actions-unavailable`);
    const bar = page.getByRole("region", { name: "Your decision" });
    await expect(bar.getByText(UNAVAILABLE_REASON)).toBeVisible();
    await expect(bar.getByRole("button", { name: /Approve/ })).toHaveCount(0);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-action-unavailable-desktop-1440.png` });
    await axe(page);
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sticky action row never covers the focused note", async ({ page }) => {
    await page.goto(`/decisions/${DECISION}`);
    const bar = page.getByRole("region", { name: "Your decision" });
    const row = page.locator("[data-decision-actions]");
    await expect(bar.getByRole("button", { name: /Approve/ })).toBeVisible();
    expect(["sticky", "fixed"]).toContain(await row.evaluate(el => getComputedStyle(el).position));
    // The action row is reachable while the evidence is on screen, above the shell nav.
    const nav = await page.getByRole("navigation", { name: "Primary (compact)" }).boundingBox();
    const rowBox = (await row.boundingBox())!;
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(844);
    if (nav) expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(nav.y + 1);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-action-phone-390.png` });

    const note = bar.getByRole("textbox", { name: "Decision note" });
    await note.focus();
    await expect.poll(async () => {
      const [n, r] = await Promise.all([note.boundingBox(), row.boundingBox()]);
      return n!.y + n!.height < r!.y;
    }).toBe(true);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow).toBe(false);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/decisions-action-note-phone-390.png` });
    await axe(page);
  });

  test("capability off names the server's reason", async ({ page }) => {
    await page.goto(`/decisions/${DECISION}?scenario=actions-unavailable`);
    await expect(page.getByRole("region", { name: "Your decision" }).getByText(UNAVAILABLE_REASON)).toBeVisible();
    await axe(page);
  });
});
