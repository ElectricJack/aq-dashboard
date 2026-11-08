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

    test("swarm landing renders every state; the whole tree is fitted at open", async ({ page }) => {
      await page.goto("/agents");
      // The tree opens fitted to the viewport; at phone width off-screen cards are attached, not necessarily in view.
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeInViewport();
      for (const name of [/^desktop, local/, /^laptop, local · offline/, /^studio, local.*holding/, /^boat vm-a, cloud · booting/, /^waiting/]) await expect(page.getByRole("button", { name })).toBeAttached();
      await expect(page.getByRole("button", { name: "free" }).first()).toBeAttached();
      await expect(page.getByRole("list", { name: "Legend" })).toBeVisible();
      const tree = page.getByRole("region", { name: "Swarm tree" });
      const inside = async (name: RegExp) => {
        const [card, area] = [await page.getByRole("button", { name }).first().boundingBox(), await tree.boundingBox()];
        expect(card, String(name)).not.toBeNull();
        expect(card!.x).toBeGreaterThanOrEqual(area!.x - 1);
        expect(card!.y).toBeGreaterThanOrEqual(area!.y - 1);
        expect(card!.x + card!.width).toBeLessThanOrEqual(area!.x + area!.width + 1);
        expect(card!.y + card!.height).toBeLessThanOrEqual(area!.y + area!.height + 1);
      };
      await inside(/^AQ server/);
      // The whole tree is fitted at 1440; at 390 it falls back to 0.5 centred on the server root, so only the server card is asserted.
      if (!vp.phone) for (const name of [/^desktop, local/, /^laptop, local · offline/, /^studio, local.*holding/, /^boat vm-a, cloud · booting/]) await inside(name);
    });

    test("Tab reaches the first machine card with a visible focus ring, inside the tree", async ({ page }) => {
      test.skip(vp.phone, "keyboard focus is checked at desktop width");
      await page.goto("/agents");
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeInViewport();
      await page.getByRole("link", { name: "Sessions" }).focus();
      const onMachine = () => page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        return !!el?.classList.contains("react-flow__node") && /^desktop, local/.test(el.querySelector("button")?.getAttribute("aria-label") ?? "");
      });
      let reached = false;
      for (let i = 0; i < 40 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await onMachine();
      }
      expect(reached).toBe(true);
      const focused = page.locator(".react-flow__node:focus");
      await expect(focused).toBeFocused();
      // Wait for the 200ms setCenter animation: the box must be identical across two reads.
      let last = "";
      await expect.poll(async () => {
        const box = JSON.stringify(await focused.boundingBox());
        const settled = box === last;
        last = box;
        return settled;
      }).toBe(true);
      const [box, tree] = [await focused.boundingBox(), await page.getByRole("region", { name: "Swarm tree" }).boundingBox()];
      expect(box!.x).toBeGreaterThanOrEqual(tree!.x - 1);
      expect(box!.y).toBeGreaterThanOrEqual(tree!.y - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(tree!.x + tree!.width + 1);
      expect(box!.y + box!.height).toBeLessThanOrEqual(tree!.y + tree!.height + 1);
      expect(await focused.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe("none");
    });

    test("opening with ?select= pans the selected card into view", async ({ page }) => {
      await page.goto("/agents?select=machine:studio");
      await expect(page.getByRole("complementary", { name: "Properties" })).toContainText("studio");
      await expect(page.getByRole("button", { name: /^studio, local/ })).toBeInViewport({ ratio: 1 });
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

test.describe("phone pane rows", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("each definition label is on the same row as its value", async ({ page }) => {
    await page.goto("/agents?select=machine:desktop");
    const pane = page.getByRole("complementary", { name: "Properties" });
    await expect(pane.locator("dt").first()).toBeVisible();
    const tops = await pane.locator("dl dt").evaluateAll((labels) => labels.map((dt) => [dt.textContent, dt.getBoundingClientRect().top, (dt.nextElementSibling as HTMLElement).getBoundingClientRect().top] as const));
    expect(tops.length).toBeGreaterThan(3);
    for (const [label, dtTop, ddTop] of tops) expect(Math.abs(dtTop - ddTop), label ?? "").toBeLessThanOrEqual(2);
  });
});
