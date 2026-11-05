// G11: every accepted mockup surface plus Settings at desktop, tablet, phone and 320px reflow.
// Each capture is reviewed against docs/design/<asset> (records: docs/design/acceptance.json).
// Set VISUAL_OUTPUT=<dir> to keep captures; default test-results/visual.
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { AXE_TAGS, SURFACES, VIEWPORTS, settle } from "./pages";

const OUTPUT = join(process.env.VISUAL_OUTPUT ?? "test-results/visual", "fixture");
mkdirSync(OUTPUT, { recursive: true });

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const surface of SURFACES) {
      test(`${surface.id} renders, reflows and passes axe`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        await surface.fixture?.(page);
        await page.goto(surface.path);
        await surface.ready(page, vp);
        await surface.open?.(page, vp);
        await settle(page);
        // No whole-app horizontal scrolling; graphs and terminals scroll inside labelled regions.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        // Phone keeps a visible exit: bottom destinations, or the focused session's Back link.
        if (vp.kind === "phone") {
          const exit = page.getByRole("navigation", { name: "Primary (compact)" }).or(page.getByRole("link", { name: "Back to Agents" }));
          await expect(exit.first()).toBeInViewport();
        }
        await page.screenshot({ path: join(OUTPUT, `${surface.id}-${vp.name}.png`) });
        await page.screenshot({ path: join(OUTPUT, `${surface.id}-${vp.name}-full.png`), fullPage: true });
        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}
