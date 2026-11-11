import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// G10: operations views live in the on-demand Details drawer; the focused terminal
// workspace (references 08/11) is unchanged. Disconnect freezes the last observation.
// Labelled mock fixtures only; unavailable server reads stay concise.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
  { name: "phone-390", width: 390, height: 844, phone: true },
];
const SHOTS = process.env.FIXTURE_SHOTS;

async function check(page: Page, shot: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png` });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("/agents/sess-07 operations drawer and frozen last observation", async ({ page }) => {
      await page.goto("/agents/sess-07");
      const terminal = page.getByRole("region", { name: "Interactive agent terminal" });
      await expect(terminal.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
      const open = async () => {
        if (vp.phone) { await terminal.getByRole("button", { name: "More terminal actions" }).click(); await terminal.getByRole("button", { name: "Session details" }).click(); }
        else await page.getByRole("group", { name: "Session actions" }).getByRole("button", { name: "Session details" }).click();
        return page.getByRole("dialog", { name: "Session details" });
      };
      const details = await open();
      const nav = details.getByRole("navigation", { name: "Session operations" });
      await expect(nav).toBeVisible();
      await check(page, `overview-${vp.name}`);
      for (const [view, probe] of [["Health", "Health observations"], ["Waits", null], ["Notifications", null], ["Profile", "Effective permissions"]] as const) {
        await nav.getByRole("button", { name: view }).click();
        const region = details.getByRole("region", { name: view });
        await expect(region).toBeVisible();
        if (probe) await expect(region.getByRole("list", { name: probe })).toBeVisible();
        await check(page, `${view.toLowerCase()}-${vp.name}`);
      }
      await page.keyboard.press("Escape");
      await expect(details).toBeHidden();

      if (vp.phone) { await terminal.getByRole("button", { name: "More terminal actions" }).click(); await terminal.getByRole("group", {name:"More terminal actions"}).getByRole("button", { name: "Disconnect" }).click(); }
      else await terminal.getByRole("button", { name: "Disconnect" }).click();
      const frozen = terminal.getByRole("figure", { name: "Last observation" });
      await expect(frozen).toContainText("Fixture output for Worker 07");
      await expect(frozen).toContainText("never relaunches the agent");
      await expect(terminal).not.toHaveAttribute("data-controlling");
      await check(page, `disconnected-${vp.name}`);
      if (vp.phone) { await terminal.getByRole("button", { name: "More terminal actions" }).click(); }
      await terminal.getByRole("button", { name: "Reconnect" }).click();
      await expect(frozen).toBeHidden();
      await expect(terminal.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    });
  });
}
