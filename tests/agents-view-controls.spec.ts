import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// AG-F: Focus / Split view / Expand on the focused Agents workspace (spec §6).
// Split is offered only while each pane fits >= 80 terminal columns at the
// readable font size; Expand hides the page chrome and Esc restores it.
// Labelled mock fixtures only.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}
async function withinViewport(page: Page, el: Locator) {
  const box = (await el.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(vp.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(vp.height + 0.5);
}
/** A pane fits its width: rendered and fitted columns >= 80, and the frame does not scroll sideways. */
async function fitsEighty(pane: Locator) {
  await expect.poll(async () => Number(await pane.getAttribute("data-fit-cols"))).toBeGreaterThanOrEqual(80);
  expect(Number(await pane.getAttribute("data-cols"))).toBeGreaterThanOrEqual(80);
  const frame = pane.locator(".xterm").locator("xpath=../..");
  expect(await frame.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("/agents/sess-07 Focus, Split view and Expand follow the measured columns", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const terminals = page.getByRole("region", { name: /^Interactive agent terminal/ });
      await expect(terminals.first().locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
      const view = page.getByRole("group", { name: "Workspace view" });
      const focus = view.getByRole("button", { name: "Focus" });
      const split = view.getByRole("button", { name: "Split view" });
      const expand = view.getByRole("button", { name: "Expand" });
      const back = page.getByRole("link", { name: "All sessions" });
      const switcher = page.getByRole("navigation", { name: "Session switcher" });
      await expect(focus).toHaveAttribute("aria-pressed", "true");
      await expect(expand).toHaveAttribute("aria-pressed", "false");

      // In the page layout neither viewport fits two 80-column panes: Split explains why.
      await expect(split).toBeDisabled();
      await expect(split).toHaveAccessibleDescription(/^Needs at least 160 columns \(\d+ fit\)$/);
      await expect(page.getByText(/^Needs at least 160 columns/)).toBeVisible();
      await expect(terminals).toHaveCount(1);
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-focus-${vp.name}.png` });
      await axe(page);

      await expand.click();
      await expect(expand).toHaveAttribute("aria-pressed", "true");
      await expect(back).toBeHidden();
      await expect(switcher).toBeHidden();
      const exit = page.getByRole("button", { name: /^Exit/ });
      await expect(exit).toBeVisible();
      await withinViewport(page, exit);
      await withinViewport(page, view);
      await expect(terminals.first().locator(".xterm-rows")).toContainText("Fixture output for Worker 07");

      if (vp.width >= 1440) {
        // Edge to edge, each half fits >= 80 columns here; the control must agree with the panes.
        await expect(split).toBeEnabled();
        await split.click();
        await expect(split).toHaveAttribute("aria-pressed", "true");
        await expect(terminals).toHaveCount(2);
        const first = page.getByRole("region", { name: "Interactive agent terminal, Worker 07" });
        const second = terminals.nth(1);
        await expect(second.locator(".xterm-rows")).toContainText("Fixture output for");
        await fitsEighty(first);
        await fitsEighty(second);
        await expect(page.getByRole("combobox", { name: "Second pane" })).toBeVisible();
      } else {
        await expect(split).toBeDisabled();
        await expect(split).toHaveAccessibleDescription(/^Needs at least 160 columns/);
      }
      await noOverflow(page);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/after-expanded-${vp.name}.png` });
      await axe(page);

      // Esc restores the page layout and returns focus to Expand.
      await page.keyboard.press("Escape");
      await expect(expand).toHaveAttribute("aria-pressed", "false");
      await expect(expand).toBeFocused();
      await expect(back).toBeVisible();
      await expect(switcher).toBeVisible();
      await expect(exit).toBeHidden();
      await expect(terminals).toHaveCount(1);
      await expect(focus).toHaveAttribute("aria-pressed", "true");
      await expect(split).toBeDisabled();
      await noOverflow(page);

      // The visible Exit control restores it too.
      await expand.click();
      await exit.click();
      await expect(back).toBeVisible();
      await expect(expand).toBeFocused();
    });
  });
}
