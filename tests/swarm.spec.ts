import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Agents › Swarm against the labelled swarm fixture (src/mocks/swarm.ts) in `vite --mode mock`.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900, phone: false },
  { name: "phone-390", width: 390, height: 844, phone: true },
];

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("swarm landing renders every state", async ({ page }) => {
      await page.goto("/agents");
      await expect(page.getByRole("button", { name: /^desktop, local/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^laptop, local · offline/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^studio, local.*holding/ })).toBeVisible();
      await expect(page.getByRole("button", { name: /^boat vm-a, cloud · booting/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "free" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /^waiting/ })).toBeVisible();
      await expect(page.getByRole("list", { name: "Legend" })).toBeVisible();
    });

    test("selecting an agent opens the terminal with control", async ({ page }) => {
      // On a phone the tree opens at a readable zoom and needs panning, so the selection arrives through the URL there.
      await page.goto(vp.phone ? "/agents?select=agent:sess-07" : "/agents");
      if (!vp.phone) await page.getByRole("button", { name: "claude · standard" }).click();
      const terminal = page.getByRole("region", { name: "Agent terminal" });
      await expect(terminal).toBeVisible();
      await expect(terminal.getByRole("status").filter({ hasText: "You have control" })).toBeAttached({ timeout: 15_000 });
    });

    test("pan and zoom controls exist", async ({ page }) => {
      await page.goto("/agents");
      await expect(page.locator(".react-flow__controls")).toBeVisible();
    });

    test("axe has no violations on /agents", async ({ page }) => {
      await page.goto("/agents");
      await expect(page.getByRole("button", { name: /^desktop, local/ })).toBeVisible();
      await axe(page);
    });
  });
}

test("phone stacks tree above pane without horizontal scroll", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/agents");
    await expect(page.getByRole("button", { name: /^desktop, local/ })).toBeVisible();
    await noOverflow(page);
    const tree = await page.getByRole("region", { name: "Swarm tree" }).boundingBox();
    const pane = await page.getByRole("complementary", { name: "Properties" }).boundingBox();
    expect(pane!.y).toBeGreaterThanOrEqual(tree!.y + tree!.height - 1);
  }
});
