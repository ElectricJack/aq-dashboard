import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * OV-C (bright-falcon-73): Work in motion "Next constraint" status icon + toned
 * label (reference 01-overview-v3.png) and phone two-line rows. Mock mode data.
 */
const EVIDENCE = process.env.OVC_EVIDENCE;

async function open(page: Page) {
  await page.goto("/overview");
  await expect(page.getByRole("rowheader", { name: "agent-queue" })).toBeVisible({ timeout: 15_000 });
  return page.getByRole("region", { name: "Work in motion", exact: true });
}

const toneOf = (page: Page, project: string) =>
  page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: project }) }).locator("[data-tone]");

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test.describe(`${vp.name} ${vp.width}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("constraint status, no overflow, unbroken identifiers, axe clean", async ({ page }) => {
      const section = await open(page);

      // Status: toned label with a decorative icon beside visible text.
      await expect(toneOf(page, "agent-queue")).toHaveAttribute("data-tone", "attention");
      await expect(toneOf(page, "agent-queue")).toHaveText("Review required");
      await expect(toneOf(page, "matter-engine")).toHaveAttribute("data-tone", "error");
      await expect(toneOf(page, "outrider")).toHaveAttribute("data-tone", "unknown");
      await expect(toneOf(page, "outrider")).toHaveText("Not reported");
      const colors = await page.evaluate(() => {
        const probe = (token: string) => {
          const el = document.createElement("span");
          el.style.color = `var(${token})`;
          document.body.append(el);
          const color = getComputedStyle(el).color;
          el.remove();
          return color;
        };
        return { attention: probe("--color-attention"), error: probe("--color-error") };
      });
      await expect(toneOf(page, "agent-queue")).toHaveCSS("color", colors.attention);
      await expect(toneOf(page, "matter-engine")).toHaveCSS("color", colors.error);
      const icon = toneOf(page, "agent-queue").locator("svg");
      await expect(icon).toHaveAttribute("aria-hidden", "true");

      // No element in the work section scrolls horizontally.
      const overflowing = await section.evaluate((root) =>
        [root, ...root.querySelectorAll("*")]
          .filter((el) => el.scrollWidth > el.clientWidth && getComputedStyle(el).display !== "inline")
          .map((el) => `${el.tagName}.${el.className}`),
      );
      expect(overflowing).toEqual([]);

      // Identifiers render on one line.
      for (const name of ["agent-queue", "matter-engine", "quilt-trader"]) {
        const lines = await page.getByRole("rowheader", { name }).evaluate((th) => {
          const range = document.createRange();
          range.selectNodeContents(th.firstChild!);
          return range.getClientRects().length;
        });
        expect(lines, name).toBe(1);
      }

      if (vp.name === "phone") {
        // Two-line card: project + count on line 1, constraint (+ progress) on line 2.
        const row = page.getByRole("row").filter({ has: page.getByRole("rowheader", { name: "agent-queue" }) });
        const box = async (sel: string) => (await row.locator(sel).boundingBox())!;
        const [project, now, constraint] = [await box("th"), await box("td >> nth=0"), await box("[data-tone]")];
        expect(Math.abs(project.y - now.y)).toBeLessThan(8);
        expect(constraint.y).toBeGreaterThan(project.y + project.height - 2);
      }

      if (EVIDENCE) {
        await section.screenshot({ path: `${EVIDENCE}-${vp.name}-section.png` });
        await page.getByRole("heading", { name: "Work in motion" }).evaluate((h) => h.scrollIntoView());
        await page.screenshot({ path: `${EVIDENCE}-${vp.name}.png` });
      }

      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    });
  });
}
