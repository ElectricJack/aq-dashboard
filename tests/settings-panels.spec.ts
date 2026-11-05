import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// ST-A (no PNG; docs/specs/0002 §2/§3/§9/§10): consistent Settings panels, title rhythm and
// technical identity disclosure. Mock mode renders labelled fixture identity facts.
const evidence = "docs/evidence/settings-st-a";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function box(locator: ReturnType<Page["locator"]>) {
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}
const fontSize = (locator: ReturnType<Page["locator"]>) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("Settings groups are panels with panel-sized titles and a hidden technical identity", async ({ page }) => {
      await page.goto("/settings");
      const h1 = page.getByRole("heading", { level: 1, name: "Settings" });
      await expect(h1).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText("Your identity, connection, display and project execution settings.")).toBeVisible();

      const panels = page.locator("main section[class*=panel]");
      await expect(panels.first()).toBeVisible();
      expect(await panels.count()).toBeGreaterThanOrEqual(4);
      for (const name of ["Identity", "Framework connection", "Your notifications", "Project execution bindings"]) {
        await expect(page.getByRole("region", { name })).toBeVisible();
      }

      const identity = page.getByRole("region", { name: "Identity" });
      await expect(identity.getByText("Sample Owner")).toBeVisible();
      await expect(page.getByText("0.0.0-fixture")).toBeHidden();
      await expect(page.getByRole("region", { name: "Framework connection" }).getByRole("heading", { level: 3, name: "Worker nodes" })).toBeVisible();

      // Title rhythm: H1 is the largest heading and panels start below it with a real gap.
      const h1Size = await fontSize(h1);
      const h2s = page.locator("main h2");
      for (let i = 0; i < await h2s.count(); i++) expect(h1Size).toBeGreaterThan(await fontSize(h2s.nth(i)));
      const h1Box = await box(h1);
      expect((await box(page.getByRole("heading", { name: "Identity" }))).y - (h1Box.y + h1Box.height)).toBeGreaterThanOrEqual(16);

      // Two columns at desktop width, one column on phone.
      const framework = await box(page.getByRole("region", { name: "Framework connection" }));
      const identityBox = await box(identity);
      // Display (ST-G11) is the second panel, so it pairs with Identity in the first desktop row.
      const display = await box(page.getByRole("region", { name: "Display" }));
      if (vp.name === "d") expect(Math.abs(display.y - identityBox.y)).toBeLessThan(2);
      else expect(framework.y).toBeGreaterThanOrEqual(identityBox.y + identityBox.height);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      await page.screenshot({ path: `${evidence}/settings-A-${vp.name}.png`, fullPage: true });

      await page.getByText("Technical identity").click();
      await expect(page.getByText("0.0.0-fixture")).toBeVisible();
      await page.screenshot({ path: `${evidence}/settings-A-technical-${vp.name}.png`, fullPage: true });
    });
  });
}
