import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// AG-D: Watch/Control header, lease identity, status footer and phone action bar,
// against the labelled terminal fixture (src/mocks/terminal.ts) in `vite --mode mock`.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
  { name: "phone-390", width: 390, height: 844, phone: true },
];
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
async function smallestFont(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((roots) => Math.min(...roots.flatMap((root) =>
    [root, ...root.querySelectorAll("*")].filter((el) => el.textContent?.trim()).map((el) => parseFloat(getComputedStyle(el).fontSize)))));
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("automatic control shows its lease, readable status and explicit reconnect", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const pane = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(pane).toHaveAttribute("data-controlling");
      const view = pane.getByRole("radiogroup", { name: "Output view" });
      if (vp.phone) await expect(view.getByRole("radio", { name: "Terminal" })).toHaveAttribute("aria-checked", "true");
      else await expect(view).toHaveCount(0);
      const footer = pane.locator("footer");
      await expect(footer.getByText("Connected", { exact: true })).toBeVisible();
      await expect(footer.getByText(/^Output (unavailable|.+ ago)$/)).toBeVisible();
      await expect(footer.getByText(/^Progress (unavailable|.+ ago)$/)).toBeVisible();
      await expect(pane.getByText(/^Controlled by .+ \(you\) · lease expires in \d+:\d\d$/)).toBeVisible();
      if (vp.phone) {
        for (const name of [/^Type$/, /^Message$/, /More terminal actions/]) expect((await pane.getByRole("button", { name }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await smallestFont(page, "[data-interactive-terminal] footer")).toBeGreaterThanOrEqual(12);
      expect(await smallestFont(page, "[data-interactive-terminal] [role=status]")).toBeGreaterThanOrEqual(12);
      await noOverflow(page); await axe(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-control-${vp.phone ? "m" : "d"}.png` });
      if (vp.phone) await pane.getByRole("button", { name: "More terminal actions" }).click();
      await (vp.phone ? pane.getByRole("group", {name:"More terminal actions"}) : pane).getByRole("button", { name: "Disconnect",exact:true }).click();
      await expect(pane).not.toHaveAttribute("data-controlling");
      await expect(pane.getByRole("figure",{name:"Last observation"})).toBeVisible();
      if (vp.phone) await pane.getByRole("button", { name: "More terminal actions" }).click();
      await pane.getByRole("button", { name: "Reconnect",exact:true }).click();
      await expect(pane).toHaveAttribute("data-controlling");
      await noOverflow(page); await axe(page);
    });

    if (vp.phone) test("phone more menu opens, closes on Escape and returns focus", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const more = page.getByRole("button", { name: "More terminal actions" });
      await more.click();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("button", { name: "Reconnect" })).toBeFocused();
      await axe(page);
      await page.keyboard.press("Escape");
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(more).toBeFocused();
    });
  });
}
