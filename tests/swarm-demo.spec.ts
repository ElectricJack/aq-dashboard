import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Agents › Swarm on the demo fixtures (src/mocks/swarm.ts): two machines, three workers, twenty slots.
// `swarm-demo` is what aq-server sends today; `swarm-demo-next` adds the fields requested of it.
// SWARM_SHOTS=<directory> also saves a screenshot of each view at each size.
const SIZES = [{ name: "1280x720", width: 1280, height: 720 }, { name: "1920x1080", width: 1920, height: 1080 }];
const shots = process.env.SWARM_SHOTS;
// The mock dev server compiles the route on first load; parallel workers make that slow, so the first assertion waits longer.
const FIRST_PAINT = 20_000;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const scenario of ["swarm-demo", "swarm-demo-next"]) {
      test(`${scenario}: the board shows every slot without overflow`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=board`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        await expect(activity.getByRole("status")).toContainText("12 agents running on 2 machines", { timeout: FIRST_PAINT });
        const board = page.getByRole("region", { name: "Swarm board" });
        // Titles come from the row (next) or from each task's own read (today).
        await expect(board.getByRole("button", { name: /^Add retry backoff to the webhook sender/ })).toBeVisible();
        await expect(board.getByRole("button", { name: /^Task 2000/ })).toHaveCount(0);
        await expect(board.locator('button[data-state="running"]')).toHaveCount(12);
        await expect(board.getByRole("listitem")).toHaveCount(20);
        if (scenario === "swarm-demo") await expect(board.locator('button[data-state="held"]')).toHaveCount(2);
        else { await expect(board.locator('button[data-state="starting"]')).toHaveCount(1); await expect(board.locator('button[data-state="finishing"]')).toHaveCount(1); }
        await expect(board.getByRole("button", { name: "free" })).toHaveCount(6);
        // No page overflow, no tile wider than the board, and every title inside its tile.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        const area = (await board.boundingBox())!;
        for (const tile of await board.getByRole("listitem").all()) {
          const box = (await tile.boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(area.x);
          expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 1);
        }
        expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        // 1280×720 gets the compact density: all twenty slots on one screen, nothing to scroll. 1920×1080 keeps the full tiles.
        const first = board.getByRole("button", { name: /^Add retry backoff/ });
        if (size.height < 900) {
          await expect(board).toHaveAttribute("data-density", "compact");
          await expect(first).toContainText("Fixture: billing service · developer · Standard, high · claude-sonnet-5");
          for (const tile of await board.getByRole("listitem").all()) {
            const box = (await tile.boundingBox())!;
            expect(box.y + box.height).toBeLessThanOrEqual(size.height);
          }
          expect((await board.boundingBox())!.y + (await board.boundingBox())!.height).toBeLessThanOrEqual(size.height);
          expect(await page.evaluate(() => { const main = document.scrollingElement!; return main.scrollHeight <= main.clientHeight; })).toBe(true);
          // Two lines: the title with its clock, then one line of facts.
          expect((await first.boundingBox())!.height).toBeLessThanOrEqual(44);
          expect(await first.locator("span").first().evaluate(el => parseFloat(getComputedStyle(el.querySelector("span")!).fontSize))).toBeGreaterThanOrEqual(14);
        } else {
          await expect(board).not.toHaveAttribute("data-density", "compact");
          await expect(first).toContainText("Running · claude-sonnet-5 · high effort");
          expect((await first.boundingBox())!.height).toBeGreaterThanOrEqual(58);
        }

        const clock = board.getByRole("button", { name: /^Add retry backoff/ }).locator("[data-clock]");
        const before = await clock.getAttribute("data-clock");
        await expect(clock).not.toHaveAttribute("data-clock", before!, { timeout: 4000 });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/${scenario}-board-${size.name}.png` });
      });
    }

    test("swarm-demo: the tree draws held slots and the count line", async ({ page }) => {
      await page.goto("/agents/swarm?scenario=swarm-demo&view=tree");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("12 agents running on 2 machines", { timeout: FIRST_PAINT });
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.getByRole("button", { name: "slot held" })).toHaveCount(2);
      await expect(tree.getByRole("button", { name: "free" })).toHaveCount(6);
      await tree.getByRole("button", { name: "slot held" }).first().click();
      await expect(page.getByRole("heading", { name: "Starting or settling" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/swarm-demo-tree-${size.name}.png` });
    });

    test("the design fixture's board keeps an offline and a holding machine sensible", async ({ page }) => {
      await page.goto("/agents/swarm?view=board");
      const board = page.getByRole("region", { name: "Swarm board" });
      await expect(board.getByRole("button", { name: /^laptop(?!-)/ })).toContainText("offline", { timeout: FIRST_PAINT });
      await expect(board.getByRole("button", { name: /^studio(?!-)/ })).toContainText("holding: Capability report expired");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("4 agents running on 1 machine");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/design-fixture-board-${size.name}.png` });
    });
  });
}
