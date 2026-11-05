// G11: WCAG 2.2 AA behaviour that axe cannot see (0002 §9). The manual checklist in
// docs/implementation/G11.md cites these tests. Fixture contract only.
import { expect, test, type Page } from "@playwright/test";
import { PREFERENCES_KEY } from "../../src/app/preferences";
import { SURFACES, VIEWPORTS, type Viewport } from "./pages";

const surface = (id: string) => SURFACES.find((s) => s.id === id)!;
const desktop = VIEWPORTS.find((v) => v.name === "desktop-1440")!;
const phone = VIEWPORTS.find((v) => v.name === "phone-390")!;

async function open(page: Page, id: string, vp: Viewport) {
  await page.setViewportSize({ width: vp.width, height: vp.height });
  const s = surface(id);
  await s.fixture?.(page);
  await page.goto(s.path);
  await s.ready(page, vp);
  await s.open?.(page, vp);
}

/** The focused element has a visible indicator and is not entirely hidden by sticky or fixed content (2.4.7, 2.4.11). */
async function focusState(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const style = getComputedStyle(el);
    // A wrapper's :focus-within ring counts (the decision note draws its ring on its field).
    const ring = (s: CSSStyleDeclaration) => (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    const indicator = ring(style) || (!!el.parentElement && el.parentElement.matches(":focus-within") && ring(getComputedStyle(el.parentElement)));
    const r = el.getBoundingClientRect();
    const points = [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]].map(([x, y]) => [r.left + r.width * x, r.top + r.height * y]);
    const visible = points.some(([x, y]) => { const hit = document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit) || hit.contains(el)); });
    const label = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    return { label, indicator, visible };
  });
}

for (const vp of [desktop, phone]) {
  test.describe(vp.name, () => {
    for (const id of ["overview", "results", "decisions", "settings"]) {
      test(`${id}: keyboard focus is visible and unobscured`, async ({ page }) => {
        await open(page, id, vp);
        const problems: string[] = [];
        let reached = 0;
        for (let i = 0; i < 30; i++) {
          await page.keyboard.press("Tab");
          const state = await focusState(page);
          if (!state) continue;
          reached++;
          if (!state.indicator) problems.push(`no indicator: ${state.label}`);
          if (!state.visible) problems.push(`obscured: ${state.label}`);
        }
        expect(reached).toBeGreaterThan(5);
        expect(problems).toEqual([]);
      });
    }

    test("every surface has one main landmark, a banner and a level-one heading", async ({ page }) => {
      for (const s of SURFACES) {
        await open(page, s.id, vp);
        await expect(page.getByRole("main"), s.id).toHaveCount(1);
        await expect(page.getByRole("banner"), s.id).toHaveCount(1);
        expect(await page.getByRole("heading", { level: 1 }).count(), s.id).toBeGreaterThanOrEqual(1);
      }
    });

    test("shell primary targets meet the 44px product choice", async ({ page }) => {
      await open(page, "overview", vp);
      const targets = vp.kind === "phone"
        ? page.getByRole("navigation", { name: "Primary (compact)" }).getByRole("link").or(page.getByRole("navigation", { name: "Primary (compact)" }).getByRole("button"))
        : page.getByRole("navigation", { name: "Primary" }).getByRole("link");
      const boxes = await targets.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { name: el.textContent?.trim(), w: r.width, h: r.height }; }));
      expect(boxes.length).toBeGreaterThan(3);
      const search = await page.getByRole("button", { name: "Search", exact: true }).first().boundingBox();
      for (const b of [...boxes, { name: "Search", w: search!.width, h: search!.height }]) {
        expect(Math.min(b.w, b.h), b.name).toBeGreaterThanOrEqual(44);
      }
    });
  });
}

test("search dialog traps focus while modal and restores it on close", async ({ page }) => {
  await open(page, "overview", desktop);
  const trigger = page.getByRole("button", { name: "Search", exact: true }).first();
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("searchbox", { name: "Search" })).toBeFocused();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test.describe("preferences", () => {
  test.use({ reducedMotion: "no-preference" });

  test("text size and reduced motion apply, persist in this browser only and survive reload", async ({ page }) => {
    await open(page, "settings", desktop);
    const display = page.getByRole("region", { name: "Display" });
    const before = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    await display.getByRole("radio", { name: "Larger" }).check();
    await display.getByRole("checkbox", { name: "Reduce motion" }).check();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeGreaterThan(before);
    const link = page.getByRole("navigation", { name: "Primary" }).getByRole("link").first();
    expect(await link.evaluate((el) => getComputedStyle(el).transitionDuration.split(",").every((d) => parseFloat(d) === 0))).toBe(true);
    const stored = await page.evaluate((key) => localStorage.getItem(key), PREFERENCES_KEY);
    expect(Object.keys(JSON.parse(stored!)).sort()).toEqual(["motion", "terminalFontSize", "textSize"]);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
    await expect(page.locator("html")).toHaveAttribute("data-motion", "reduce");
  });
});

test("the terminal does not announce frames through a live region", async ({ page }) => {
  await open(page, "agents", desktop);
  await expect(page.locator(".xterm")).toHaveCount(1);
  await expect(page.locator(".xterm [aria-live]")).toHaveCount(0);
  // Session state changes are announced once through the labelled status, not per frame.
  await expect(page.getByRole("status").filter({ hasText: "Watch only" })).toBeVisible();
});
