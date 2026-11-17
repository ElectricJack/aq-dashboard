import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Agents › Swarm on the demo fixtures (src/mocks/swarm.ts): the live stack's shape, two machines and nine nodes, which the board calls slots.
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
      test(`${scenario}: the board shows nine slots as nine tiles on one screen`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=board`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        await expect(activity.getByRole("status")).toContainText("7 of 9 slots busy on 2 workers", { timeout: FIRST_PAINT });
        await expect(activity.getByRole("status")).not.toContainText(/free|machine/);
        await expect(activity.getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(["Fixture desktop: 6 of 8 slots busy", "Fixture laptop: 1 of 1 slot busy"]);
        const board = page.getByRole("region", { name: "Swarm board" });
        // Titles come from the row (next) or from each task's own read (an older server).
        await expect(board.getByRole("button", { name: /: Add retry backoff to the webhook sender/ })).toBeVisible();
        await expect(board.getByRole("button", { name: /: Task 2000/ })).toHaveCount(0);
        // One tile per node, each called a slot, numbered from one under its machine: no free tiles.
        const tiles = board.getByRole("listitem");
        await expect(tiles).toHaveCount(9);
        await expect(board.locator('li[data-state="running"]')).toHaveCount(5);
        await expect(board.locator('li[data-state="idle"]')).toHaveCount(2);
        const idle = board.getByRole("button", { name: "Slot 4 idle, Local Worker 1#5", exact: true });
        await expect(idle).toBeVisible();
        await expect(idle).toHaveText(/^Slot 4 · idle$/);
        await expect(idle).toHaveAttribute("title", "Local Worker 1#5");
        await expect(board.getByRole("list", { name: "Fixture desktop slots" }).getByRole("listitem")).toHaveCount(8);
        await expect(board.getByRole("button", { name: /^Fixture desktop/ })).toContainText("6 of 8 slots busy · CPU");
        await expect(board.getByRole("button", { name: /^Fixture laptop/ })).toContainText("1 of 1 slot busy");
        await expect(board).not.toContainText(/workers? busy|this worker/);
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
        // Every busy tile carries its slot, its node's name (tooltip and accessible name) and the full facts at either size.
        const first = board.getByRole("button", { name: /^Slot 1, Local Worker 1, running: Add retry backoff/ });
        await expect(first).toContainText("Fixture: billing service · developer · Standard, high");
        await expect(first).toContainText("Running · claude-sonnet-5-5 · high effort");
        const cell = board.getByRole("listitem").filter({ hasText: "Add retry backoff" });
        const label = cell.getByRole("button", { name: "Slot 1, Local Worker 1", exact: true });
        await expect(label).toBeVisible();
        await expect(label).toHaveText("Slot 1");
        await expect(label).toHaveAttribute("title", "Local Worker 1");
        // No page overflow, no tile wider than the board.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        const area = (await board.boundingBox())!;
        const boxes = await Promise.all((await tiles.all()).map(async tile => (await tile.boundingBox())!));
        for (const box of boxes) {
          expect(box.x).toBeGreaterThanOrEqual(area.x);
          expect(box.x + box.width).toBeLessThanOrEqual(area.x + area.width + 1);
        }
        expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        // A dense grid: four tiles across at both sizes, so the desktop's eight slots are two rows.
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
        if (shots && scenario === "swarm-demo-next") await page.screenshot({ path: `${shots}/board-slots-${size.name}.png` });
      });
    }

    for (const scenario of ["swarm-demo", "swarm-demo-next"]) {
      test(`${scenario}: the tree opens fitted to its canvas with nine nodes, one readable card per real slot`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=tree`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        // The same honest count as above the board: slots busy of real slots, on how many workers.
        await expect(activity.getByRole("status")).toContainText("7 of 9 slots busy on 2 workers", { timeout: FIRST_PAINT });
        await expect(activity.getByRole("status")).not.toContainText(/free|agents running|machine/);
        await expect(activity.getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(["Fixture desktop: 6 of 8 slots busy", "Fixture laptop: 1 of 1 slot busy"]);
        const tree = page.getByRole("region", { name: "Swarm tree" });
        // Server, machines, nodes, and one card under each node: its attempt or one free slot. No wall of free pills.
        await expect(tree.locator('[data-kind="machine"]')).toHaveCount(2);
        await expect(tree.locator('[data-kind="node"]')).toHaveCount(9);
        await expect(tree.locator('[data-kind="free"]')).toHaveCount(2);
        await expect(tree.locator('[data-kind="agent"]')).toHaveCount(scenario === "swarm-demo" ? 5 : 7);
        await expect(tree.locator('[data-kind="held"]')).toHaveCount(scenario === "swarm-demo" ? 2 : 0);
        await expect(tree.getByRole("button", { name: /^Fixture desktop, local · 24 cores · 6 of 8 slots busy/ })).toBeVisible();
        // Nothing holds in this response: no machine, node or slot says so.
        await expect(tree.locator('[data-state="holding"]')).toHaveCount(0);
        await expect(tree).not.toContainText("holding");
        // An agent card: the task's title first, then role and level, then model and effort, and a clock.
        const card = tree.getByRole("button", { name: /^Add retry backoff to the webhook sender / });
        await expect(card).toHaveAccessibleName("Add retry backoff to the webhook sender developer · Standard, high claude-sonnet-5-5 · high effort");
        await expect(card).toContainText("developer · Standard, high");
        await expect(card).toContainText("claude-sonnet-5-5 · high effort");
        await expect(card).toHaveAttribute("data-level", "standard");
        await expect(tree.getByRole("button", { name: /^Review: migrate invoices/ })).toHaveAttribute("data-level", "complex");
        await expect(tree.getByRole("button", { name: /^Rename the cart reducer/ })).toHaveAttribute("data-level", "simple");
        const clock = card.locator("[data-clock]");
        const before = await clock.getAttribute("data-clock");
        await expect(clock).not.toHaveAttribute("data-clock", before!, { timeout: 4000 });
        // With nothing selected the properties are closed and the tree has the width.
        const pane = page.getByRole("complementary", { name: "Properties" });
        await expect(pane).toBeHidden();
        const area = (await tree.boundingBox())!;
        expect(area.width).toBeGreaterThan(size.width - 300);
        expect(area.y + area.height).toBeLessThanOrEqual(size.height);
        // Fitted: every card is inside the canvas, and the page does not scroll.
        const cards = await tree.locator(".react-flow__node").evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { id: n.getAttribute("data-id"), x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
        expect(cards).toHaveLength(21);
        for (const c of cards) {
          expect(c.x, c.id!).toBeGreaterThanOrEqual(area.x);
          expect(c.y, c.id!).toBeGreaterThanOrEqual(area.y);
          expect(c.right, c.id!).toBeLessThanOrEqual(area.x + area.width);
          expect(c.bottom, c.id!).toBeLessThanOrEqual(area.y + area.height);
        }
        expect(await page.evaluate(() => { const main = document.scrollingElement!; return main.scrollHeight <= main.clientHeight && main.scrollWidth <= main.clientWidth; })).toBe(true);
        // It fills the canvas rather than sitting small in the middle of it.
        const span = { width: Math.max(...cards.map(c => c.right)) - Math.min(...cards.map(c => c.x)), height: Math.max(...cards.map(c => c.bottom)) - Math.min(...cards.map(c => c.y)) };
        expect(Math.max(span.width / area.width, span.height / area.height)).toBeGreaterThan(0.9);
        // Legible at a distance: the size the title is drawn at (its font size times the tree's zoom), and the card's width.
        const zoom = await tree.locator(".react-flow__viewport").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
        const drawn = async (selector: string) => zoom * await card.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(await drawn("span")).toBeGreaterThanOrEqual(size.width >= 1600 ? 18 : 11);
        expect(await drawn("[data-clock]")).toBeGreaterThanOrEqual(size.width >= 1600 ? 17 : 10.5);
        expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(size.width >= 1600 ? 250 : 150);
        // The legend names the levels the cards carry.
        await expect(page.getByRole("list", { name: "Legend" }).getByRole("listitem")).toContainText(["simple", "standard", "complex", "deep"]);
        await expect(page.getByRole("list", { name: "Legend" })).not.toContainText("fast");
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/${scenario}-tree-${size.name}.png` });
        if (shots && scenario === "swarm-demo-next") await page.screenshot({ path: `${shots}/tree-fixed-${size.name}.png` });

        // Selecting opens the properties, by keyboard too; the tree refits to the room it has left; Escape closes them.
        await tree.locator('.react-flow__node[data-id^="agent:"]').first().focus();
        await page.keyboard.press("Enter");
        await expect(pane).toBeVisible();
        await expect(pane).toContainText(scenario === "swarm-demo-next" ? "Add retry backoff to the webhook sender" : /Agent|Task|session/i);
        const narrowed = (await tree.boundingBox())!;
        expect(narrowed.width).toBeLessThan(area.width - 200);
        await expect.poll(async () => (await tree.locator(".react-flow__node").evaluateAll((nodes, right) => nodes.every(n => n.getBoundingClientRect().right <= right), narrowed.x + narrowed.width))).toBe(true);
        await tree.locator('.react-flow__node[data-id^="agent:"]').first().focus();
        await page.keyboard.press("Escape");
        await expect(pane).toBeHidden();
      });
    }

    test("the tree stays where the viewer put it: after a zoom it does not refit, and fit view hands it back", async ({ page }) => {
      await page.goto("/agents/swarm?scenario=swarm-demo-next&view=tree");
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.locator('[data-kind="node"]')).toHaveCount(9, { timeout: FIRST_PAINT });
      const zoom = () => tree.locator(".react-flow__viewport").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
      await expect.poll(zoom).toBeGreaterThan(0.5);
      const fitted = await zoom();
      await page.getByRole("button", { name: "Zoom In" }).click();
      await expect.poll(zoom).toBeGreaterThan(fitted * 1.1);
      const mine = await zoom();
      // Polls keep arriving (every two seconds) and the window changes size: the viewer's zoom is kept.
      await page.setViewportSize({ width: size.width - 80, height: size.height });
      await page.waitForTimeout(2500);
      expect(await zoom()).toBeCloseTo(mine, 3);
      await page.getByRole("button", { name: "Zoom Out" }).click();
      await expect.poll(zoom).toBeLessThan(mine);
      await page.getByRole("button", { name: "Fit View" }).click();
      await expect.poll(async () => Math.abs(await zoom() - mine) > 0.01).toBe(true);
      const area = (await tree.boundingBox())!;
      await expect.poll(async () => tree.locator(".react-flow__node").evaluateAll((nodes, a) => nodes.every(n => { const r = n.getBoundingClientRect(); return r.x >= a.x && r.right <= a.x + a.width && r.y >= a.y && r.bottom <= a.y + a.height; }), area)).toBe(true);
    });

    test("swarm-demo: an attempt the read does not name is a held card, and selects", async ({ page }) => {
      await page.goto("/agents/swarm?scenario=swarm-demo&view=tree");
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.getByRole("button", { name: /^slot held/ })).toHaveCount(2, { timeout: FIRST_PAINT });
      await tree.getByRole("button", { name: /^slot held/ }).first().click();
      await expect(page.getByRole("heading", { name: "Starting or settling" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });

    test("the design fixture's tree shows a hold on the node that holds, and only there", async ({ page }) => {
      await page.goto("/agents/swarm?view=tree");
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.getByRole("button", { name: /^studio-1, .*holding: Capability report expired/ })).toBeAttached({ timeout: FIRST_PAINT });
      await expect(tree.getByRole("button", { name: /^studio, local · .*holding: Capability report expired/ })).toHaveAttribute("data-state", "holding");
      await expect(tree.getByRole("button", { name: "holding", exact: true })).toHaveAttribute("data-kind", "free");
      await expect(tree.getByRole("button", { name: /^desktop, local/ })).not.toHaveAttribute("data-state", "holding");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(["desktop: 2 of 2 slots busy", "laptop: offline", "studio: 0 of 1 slot busy · holding", /^boat vm-a: booting$/]);
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("2 of 4 slots busy on 1 worker");
    });

    test("the design fixture's board keeps an offline and a holding machine sensible", async ({ page }) => {
      await page.goto("/agents/swarm?view=board");
      const board = page.getByRole("region", { name: "Swarm board" });
      await expect(board.getByRole("button", { name: /^laptop(?!-)/ })).toContainText("offline", { timeout: FIRST_PAINT });
      await expect(board.getByRole("button", { name: /^Slot 1 offline last seen .*, laptop-1$/ })).toBeVisible();
      await expect(board.getByRole("button", { name: /^studio(?!-)/ })).toContainText("holding: Capability report expired");
      await expect(board.getByRole("button", { name: "Slot 1 holding Capability report expired, studio-1", exact: true })).toBeVisible();
      // Three agents on one node are one tile; the other two are its "+2".
      await expect(board.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Slot 1, local-1", exact: true }) })).toContainText("+2 more on this slot");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("2 of 4 slots busy on 1 worker");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[aria-label="Swarm board"]').include('[aria-label="Swarm activity"]').analyze();
      expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/design-fixture-board-${size.name}.png` });
    });
  });
}
