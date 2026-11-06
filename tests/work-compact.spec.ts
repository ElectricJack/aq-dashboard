import { writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

/**
 * Task view density (owner request 2026-11-06, qa/2026-11-06/task-view-style/compare.md): the Work list and the
 * task inspector read at v1's density while keeping v2's tokens, focus rings and 44px phone targets.
 * Fixture task 0x105 "Replay reconciliation" has a running attempt, a failed one, 30 history entries, comments
 * and a result (src/mocks/humanGraph.ts).
 */
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const replay = "00000000-0000-0000-0000-000000000105";
const evidence = process.env.EVIDENCE_DIR;
const inspector = (page: Page) => page.locator("[data-task-inspector]");
const section = (page: Page, name: string) => inspector(page).locator("section[data-section]").filter({ has: page.getByRole("button", { name, exact: true }) });

/** The numbers compare.md targets; written next to the screenshots when collecting evidence. */
async function metrics(page: Page) {
  return page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
    const px = (sel: string, prop: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).getPropertyValue(prop) : null; };
    const heads = [...document.querySelectorAll("[data-task-inspector] section[data-section] h3 button")].map(b => b.getBoundingClientRect().height);
    const comments = [...document.querySelectorAll("[data-task-inspector] section[data-section=comments] h3 button")][0]?.getBoundingClientRect();
    return {
      inspectorFont: px("[data-task-inspector]", "font-size"),
      title: px("[data-inspector-title]", "font-size"),
      headerHeight: Math.round(box("[data-inspector-header]")?.height ?? 0),
      // From the inspector's top edge to its first section: the whole header, on phones too (where it isn't one box).
      statusOffset: Math.round((box("[data-task-inspector] section[data-section=status]")?.top ?? 0) - (box("[data-task-inspector]")?.top ?? 0)),
      attemptHeight: Math.round(box("[data-task-inspector] [data-attempt]")?.height ?? 0),
      sectionHead: Math.round(Math.max(...heads)),
      commentsHeadingTop: Math.round(comments?.top ?? -1),
      inspectorHeight: Math.round(box("[data-task-inspector]")?.height ?? 0),
      row: Math.round(box("ul[aria-label=Tasks] a")?.height ?? 0),
      rowFont: px("ul[aria-label=Tasks] a", "font-size"),
    };
  });
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

test.describe("desktop 1440x900", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("list and inspector meet the density targets", async ({ page }) => {
    await page.goto(`/work/${replay}?${scope}`);
    await expect(section(page, "Attempts").getByRole("list", { name: "Attempts" })).toBeVisible({ timeout: 15_000 });
    await expect(section(page, "Comments").getByRole("list", { name: "Comments" })).toBeVisible();
    const m = await metrics(page);
    if (evidence) {
      writeFileSync(`${evidence}/metrics-desktop.json`, JSON.stringify(m, null, 2));
      await page.screenshot({ path: `${evidence}/inspector-desktop.png` });
      await page.screenshot({ path: `${evidence}/inspector-desktop-full.png`, fullPage: true });
    }
    expect(m.inspectorFont).toBe("14px");
    expect(m.title).toBe("18px");
    expect(m.headerHeight).toBeLessThanOrEqual(140);
    expect(m.sectionHead).toBeLessThanOrEqual(34);
    expect(m.row).toBeLessThanOrEqual(32);
    expect(m.rowFont).toBe("14px");
    // Header, status and the comment thread's start fit the first screen with room to spare.
    expect(m.commentsHeadingTop).toBeGreaterThan(0);
    expect(m.commentsHeadingTop).toBeLessThan(700);
    await noHorizontalScroll(page);
  });

  test("result summaries are quiet clamped text", async ({ page }) => {
    await page.goto(`/work/${replay}?${scope}`);
    const result = section(page, "Results").getByRole("list", { name: "Results" }).getByRole("listitem").first();
    const summary = result.getByRole("link").first();
    await expect(summary).toHaveAttribute("href", /\/results\//, { timeout: 15_000 });
    expect(await summary.evaluate(el => ({ weight: getComputedStyle(el).fontWeight, clamp: getComputedStyle(el).webkitLineClamp, size: getComputedStyle(el).fontSize }))).toEqual({ weight: "400", clamp: "3", size: "14px" });
    // Its facts read as metadata, a step smaller.
    expect(await result.locator("p").first().evaluate(el => getComputedStyle(el).fontSize)).toBe("13px");
  });

  test("section toggles stay keyboard reachable with a visible focus ring", async ({ page }) => {
    await page.goto(`/work/${replay}?${scope}`);
    const toggle = section(page, "Description").getByRole("button", { name: "Description", exact: true });
    await toggle.focus();
    await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
    const outline = await toggle.evaluate(el => getComputedStyle(el).outlineStyle + " " + getComputedStyle(el).outlineWidth);
    expect(outline).toBe("solid 3px");
  });

  test("history entries read on one line each", async ({ page }) => {
    await page.goto(`/work/${replay}?${scope}`);
    await section(page, "History").getByRole("button", { name: "History", exact: true }).click();
    const entries = section(page, "History").getByRole("list", { name: "Change history" }).getByRole("listitem");
    await expect(entries).toHaveCount(5);
    const head = await entries.first().locator("p").first().evaluate(el => el.getBoundingClientRect().height);
    expect(head).toBeLessThanOrEqual(24);
    if (evidence) await section(page, "History").screenshot({ path: `${evidence}/history-desktop.png` });
  });
});

for (const vp of [{ name: "phone", width: 390, height: 844 }, { name: "narrow", width: 320, height: 640 }]) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("compact header, touch targets kept, no horizontal scroll", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await expect(section(page, "Attempts").getByRole("list", { name: "Attempts" })).toBeVisible({ timeout: 15_000 });
      const m = await metrics(page);
      if (evidence) {
        writeFileSync(`${evidence}/metrics-${vp.name}.json`, JSON.stringify(m, null, 2));
        await page.screenshot({ path: `${evidence}/inspector-${vp.name}.png` });
      }
      expect(m.inspectorFont).toBe("14px");
      // Phones keep the 44px touch target on every section toggle.
      const heads = await inspector(page).locator("section[data-section] h3 button").evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
      for (const h of heads) expect(h).toBeGreaterThanOrEqual(44);
      // Back, location, title, status and ID take at most ~a quarter of the phone screen before the first section
      // (was 272px at 390 and 324px at 320 before the density pass).
      expect(m.statusOffset).toBeLessThanOrEqual(vp.width < 390 ? 260 : 220);
      const status = (await section(page, "Status").boundingBox())!;
      expect(status.y).toBeLessThan(vp.height);
      // The ID, its copy button and the link button share one row.
      const [id, copy, link] = await Promise.all([inspector(page).locator("code[data-id='task ID']"), inspector(page).getByRole("button", { name: "Copy task ID" }), inspector(page).getByRole("button", { name: /task link/i })].map(l => l.boundingBox()));
      expect(Math.abs(copy!.y - link!.y)).toBeLessThan(4);
      expect(copy!.y).toBeLessThan(id!.y + id!.height);
      await noHorizontalScroll(page);
    });

    test("list rows keep 44px targets without horizontal scroll", async ({ page }) => {
      await page.goto(`/work?${scope}`);
      const rows = page.getByRole("list", { name: "Tasks" }).getByRole("link");
      await expect(rows.first()).toBeVisible();
      for (const h of await rows.evaluateAll(els => els.map(e => e.getBoundingClientRect().height))) expect(h).toBeGreaterThanOrEqual(44);
      if (evidence) await page.screenshot({ path: `${evidence}/list-${vp.name}.png` });
      await noHorizontalScroll(page);
    });
  });
}

test("desktop list screenshot", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/work?${scope}`);
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("link").first()).toBeVisible();
  if (evidence) await page.screenshot({ path: `${evidence}/list-desktop.png` });
  await noHorizontalScroll(page);
});
