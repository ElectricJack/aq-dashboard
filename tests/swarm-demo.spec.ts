import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Agents › Swarm on the demo fixtures (src/mocks/swarm.ts): the live stack's shape, two machines and nine workers.
// `swarm-demo-next` is what aq-server sends now; `swarm-demo` is an older server's rows.
// SWARM_SHOTS=<directory> also saves a screenshot of each view at each size.
const SIZES = [{ name: "1280x720", width: 1280, height: 720 }, { name: "1920x1080", width: 1920, height: 1080 }];
const shots = process.env.SWARM_SHOTS;
// The mock dev server compiles the route on first load; parallel workers make that slow, so the first assertion waits longer.
const FIRST_PAINT = 20_000;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    for (const scenario of ["swarm-demo", "swarm-demo-next"]) {
      test(`${scenario}: the board shows nine workers as nine tiles on one screen`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=board`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        await expect(activity.getByRole("status")).toContainText("7 of 9 workers busy on 2 machines", { timeout: FIRST_PAINT });
        await expect(activity.getByRole("status")).not.toContainText(/free|slot/);
        await expect(activity.getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(["Fixture desktop: 6 of 8 busy", "Fixture laptop: 1 of 1 busy"]);
        const board = page.getByRole("region", { name: "Swarm board" });
        // Titles come from the row (next) or from each task's own read (an older server).
        await expect(board.getByRole("button", { name: /^Add retry backoff to the webhook sender/ })).toBeVisible();
        await expect(board.getByRole("button", { name: /^Task 2000/ })).toHaveCount(0);
        // One tile per worker: no tile per slot, and no free tiles.
        const tiles = board.getByRole("listitem");
        await expect(tiles).toHaveCount(9);
        await expect(board.locator('li[data-state="running"]')).toHaveCount(5);
        await expect(board.locator('li[data-state="idle"]')).toHaveCount(2);
        await expect(board.getByRole("button", { name: "Local Worker 1#5 idle" })).toBeVisible();
        await expect(board.getByRole("button", { name: "free" })).toHaveCount(0);
        const models = activity.getByRole("list", { name: "Models running now" }).getByRole("listitem");
        if (scenario === "swarm-demo") {
          await expect(board.locator('li[data-state="held"]')).toHaveCount(2);
          await expect(activity.getByRole("status")).toContainText("5 running · 2 starting or settling");
          await expect(models).toHaveText(["claude-sonnet-5-5 ×3", "claude-haiku-5-5 ×1", "claude-opus-5-5 ×1"]);
        } else {
          await expect(board.locator('li[data-state="starting"]')).toHaveCount(1);
          await expect(board.locator('li[data-state="finishing"]')).toHaveCount(1);
          await expect(activity.getByRole("status")).toContainText("1 starting · 5 running · 1 finishing");
          await expect(models).toHaveText(["claude-sonnet-5-5 ×4", "claude-haiku-5-5 ×2", "claude-opus-5-5 ×1"]);
        }
        // Every busy tile carries its worker's name and the full facts at either size.
        const first = board.getByRole("button", { name: /^Add retry backoff/ });
        await expect(first).toContainText("Fixture: billing service · developer · Standard, high");
        await expect(first).toContainText("Running · claude-sonnet-5-5 · high effort");
        const cell = board.getByRole("listitem").filter({ hasText: "Add retry backoff" });
        await expect(cell.getByRole("button", { name: "Local Worker 1", exact: true })).toBeVisible();
        // No page overflow, no tile wider than the board.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        const area = (await board.boundingBox())!;
        const boxes = await Promise.all((await tiles.all()).map(async tile => (await tile.boundingBox())!));
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(area.x);
          expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 1);
        }
        expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        // A dense grid: four tiles across at both sizes, so the desktop's eight workers are two rows.
        expect(new Set(boxes.map(box => Math.round(box.x))).size).toBe(4);
        expect(new Set(boxes.map(box => Math.round(box.y))).size).toBe(3);
        // Fits without scrolling: the board and every tile end inside the viewport, and neither the board nor the page scrolls.
        expect(area.y + area.height).toBeLessThanOrEqual(size.height);
        for (const box of boxes) expect(box.y + box.height).toBeLessThanOrEqual(area.y + area.height);
        expect(await board.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
        expect(await page.evaluate(() => { const main = document.scrollingElement!; return main.scrollHeight <= main.clientHeight; })).toBe(true);
        // Legible at a distance: a title of at least 15px that may take two lines, and a larger clock.
        const title = first.locator("span > span").first();
        expect(await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(size.width >= 1600 ? 20 : 15);
        expect(await title.evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe("2");
        const clock = cell.locator("[data-clock]");
        expect(await clock.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(size.width >= 1600 ? 26 : 20);
        expect(boxes[0]!.width).toBeGreaterThanOrEqual(size.width >= 1600 ? 330 : 226);

        const before = await clock.getAttribute("data-clock");
        await expect(clock).not.toHaveAttribute("data-clock", before!, { timeout: 4000 });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/${scenario}-board-${size.name}.png` });
        if (shots && scenario === "swarm-demo-next") await page.screenshot({ path: `${shots}/board-workers-${size.name}.png` });
      });
    }

    test("swarm-demo: the tree draws held slots and the count line", async ({ page }) => {
      await page.goto("/agents/swarm?scenario=swarm-demo&view=tree");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("5 agents running on 1 machine", { timeout: FIRST_PAINT });
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.getByRole("button", { name: "slot held" })).toHaveCount(2);
      await tree.getByRole("button", { name: "slot held" }).first().click();
      await expect(page.getByRole("heading", { name: "Starting or settling" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/swarm-demo-tree-${size.name}.png` });
    });

    test("the design fixture's board keeps an offline and a holding machine sensible", async ({ page }) => {
      await page.goto("/agents/swarm?view=board");
      const board = page.getByRole("region", { name: "Swarm board" });
      await expect(board.getByRole("button", { name: /^laptop(?!-)/ })).toContainText("offline", { timeout: FIRST_PAINT });
      await expect(board.getByRole("button", { name: /^laptop-1 offline last seen/ })).toBeVisible();
      await expect(board.getByRole("button", { name: /^studio(?!-)/ })).toContainText("holding: Capability report expired");
      await expect(board.getByRole("button", { name: "studio-1 holding Capability report expired" })).toBeVisible();
      // Three agents on one worker are one tile; the other two are its "+2".
      await expect(board.getByRole("listitem").filter({ hasText: "local-1" })).toContainText("+2 more on this worker");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("2 of 4 workers busy on 1 machine");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[aria-label="Swarm board"]').include('[aria-label="Swarm activity"]').analyze();
      expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/design-fixture-board-${size.name}.png` });
    });
  });
}
