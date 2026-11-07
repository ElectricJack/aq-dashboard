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

    test("swarm landing renders every state; text is readable and the server root is in view", async ({ page }) => {
      await page.goto("/agents");
      // The tree opens at zoom 1 centred on the server root and is panned, so off-screen cards are attached, not necessarily in view.
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeInViewport();
      for (const name of [/^desktop, local/, /^laptop, local · offline/, /^studio, local.*holding/, /^boat vm-a, cloud · booting/, /^waiting/]) await expect(page.getByRole("button", { name })).toBeAttached();
      await expect(page.getByRole("button", { name: "free" }).first()).toBeAttached();
      await expect(page.getByRole("list", { name: "Legend" })).toBeVisible();
      const scale = await page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
      expect(scale).toBeGreaterThanOrEqual(1);
      const smallest = await page.locator(".react-flow__node button").evaluateAll((cards) => Math.min(...cards.flatMap((card) =>
        [card, ...card.querySelectorAll("span")].filter((el) => el.textContent?.trim()).map((el) => parseFloat(getComputedStyle(el).fontSize)))));
      expect(smallest).toBeGreaterThanOrEqual(12);
    });

    test("selecting an agent opens the terminal with control", async ({ page }) => {
      // Cards beyond the first screen need panning, so the selection arrives through the URL.
      await page.goto("/agents?select=agent:sess-07");
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
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeVisible();
      await axe(page);
    });
  });
}

test("phone stacks tree above pane without horizontal scroll", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/agents");
    await expect(page.getByRole("button", { name: /^AQ server/ })).toBeVisible();
    await noOverflow(page);
    const tree = await page.getByRole("region", { name: "Swarm tree" }).boundingBox();
    const pane = await page.getByRole("complementary", { name: "Properties" }).boundingBox();
    expect(pane!.y).toBeGreaterThanOrEqual(tree!.y + tree!.height - 1);
  }
});
