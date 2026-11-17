import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

// Agents › Swarm on the demo fixtures (src/mocks/swarm.ts): the live stack's shape, two machines, three worker nodes
// (eight, eight and four slots) and twenty slots, seven of them busy.
// `swarm-demo-next` is what aq-server sends now; `swarm-demo` is an older server's rows on the same nodes.
// SWARM_SHOTS=<directory> also saves a screenshot of each view at each size.
const SIZES = [{ name: "1280x720", width: 1280, height: 720 }, { name: "1920x1080", width: 1920, height: 1080 }];
const shots = process.env.SWARM_SHOTS;
// The mock dev server compiles the route on first load; parallel workers make that slow, so the first assertion waits longer.
const FIRST_PAINT = 20_000;

for (const size of SIZES) {
  test.describe(size.name, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    const W1 = "20000000-0000-4000-8000-000000007400";
    const COUNT = "7 of 20 slots busy on 3 workers", SHARES = ["Fixture desktop: 6 of 16 slots busy", "Fixture laptop: 1 of 4 slots busy"];
    const wide = size.width >= 1600;

    for (const scenario of ["swarm-demo", "swarm-demo-next"]) {
      test(`${scenario}: the board shows twenty slots as twenty tiles under their three workers`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=board`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        await expect(activity.getByRole("status")).toContainText(COUNT, { timeout: FIRST_PAINT });
        await expect(activity.getByRole("status")).not.toContainText(/free|machine/);
        await expect(activity.getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(SHARES);
        const board = page.getByRole("region", { name: "Swarm board" });
        // Titles come from the row (next) or from each task's own read (an older server).
        await expect(board.getByRole("button", { name: /: Add retry backoff to the webhook sender/ })).toBeVisible();
        await expect(board.getByRole("button", { name: /: Task 2000/ })).toHaveCount(0);
        // Machine, then worker node, then one tile per slot of that node, in slot order.
        const tiles = board.getByRole("listitem");
        await expect(tiles).toHaveCount(20);
        await expect(board.locator('li[data-state="running"]')).toHaveCount(5);
        await expect(board.locator('li[data-state="free"]')).toHaveCount(13);
        for (const [worker, slots, line] of [["Local Worker 1", 8, "3 of 8 slots busy"], ["Local Worker 2", 8, "3 of 8 slots busy"], ["Local Worker 3", 4, "1 of 4 slots busy"]] as const) {
          const list = board.getByRole("list", { name: `${worker} slots` });
          await expect(list.getByRole("listitem")).toHaveCount(slots);
          expect((await list.getByRole("button").evaluateAll(buttons => buttons.map(b => b.getAttribute("aria-label")!.match(/^Slot (\d+)/)![1])))).toEqual(Array.from({ length: slots }, (_, i) => String(i + 1)));
          await expect(board.getByRole("button", { name: new RegExp(`^${worker}`) })).toHaveText(new RegExp(`^${worker}\\s*${line}$`));
        }
        const free = board.getByRole("button", { name: "Slot 3 free, Local Worker 1", exact: true });
        await expect(free).toBeVisible();
        await expect(free).toHaveText(/^Slot 3 · free$/);
        await expect(board.getByRole("button", { name: /^Fixture desktop/ })).toContainText("6 of 16 slots busy on 2 workers · CPU");
        await expect(board.getByRole("button", { name: /^Fixture laptop/ })).toContainText("1 of 4 slots busy on 1 worker");
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
          // The agent whose row says slot 4 is in slot 4, after the free slot 3.
          await expect(board.getByRole("button", { name: /^Slot 4, Local Worker 1, running: Review: migrate invoices/ })).toBeVisible();
        }
        // Every busy tile carries its slot, its worker's name (tooltip and accessible name) and the full facts at either size.
        const first = board.getByRole("button", { name: /^Slot 1, Local Worker 1, running: Add retry backoff/ });
        await expect(first).toContainText("Fixture: billing service · developer · Standard, high");
        await expect(first).toContainText("Running · claude-sonnet-5-5 · high effort");
        await expect(first).toHaveAttribute("title", /^Local Worker 1: Add retry backoff/);
        // No page overflow, no tile wider than the board.
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        const area = (await board.boundingBox())!;
        expect(await board.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        // A worker's eight slots are four across and two down, at both sizes.
        const ofFirst = await board.getByRole("list", { name: "Local Worker 1 slots" }).getByRole("listitem").evaluateAll(items => items.map(li => { const r = li.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: r.width, height: r.height }; }));
        expect(new Set(ofFirst.map(box => box.x)).size).toBe(4);
        expect(new Set(ofFirst.map(box => box.y)).size).toBe(2);
        expect(ofFirst.map(box => box.x)).toEqual([...ofFirst.slice(0, 4), ...ofFirst.slice(0, 4)].map(box => box.x));
        // Busy slots are what the eye finds: a free tile is much smaller than a busy one.
        expect(ofFirst[2]!.width * ofFirst[2]!.height).toBeLessThan(0.5 * ofFirst[0]!.width * ofFirst[0]!.height);
        // The page itself never scrolls. On a 1920×1080 screen all twenty slots are on screen at once; a smaller window scrolls the board to the rest.
        expect(area.y + area.height).toBeLessThanOrEqual(size.height);
        expect(await page.evaluate(() => { const main = document.scrollingElement!; return main.scrollHeight <= main.clientHeight; })).toBe(true);
        if (wide) {
          const boxes = await tiles.evaluateAll(items => items.map(li => { const r = li.getBoundingClientRect(); return { x: r.x, right: r.right, bottom: r.bottom }; }));
          for (const box of boxes) {
            expect(box.x).toBeGreaterThanOrEqual(area.x);
            expect(box.right).toBeLessThanOrEqual(area.x + area.width + 1);
            expect(box.bottom).toBeLessThanOrEqual(area.y + area.height);
          }
          expect(await board.evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true);
        } else {
          const last = board.getByRole("button", { name: "Slot 4 free, Local Worker 3", exact: true });
          await last.scrollIntoViewIfNeeded();
          await expect(last).toBeInViewport({ ratio: 1 });
          await board.evaluate(el => { el.scrollTop = 0; });
        }
        // Legible at a distance: a title of at least 15px that may take two or three lines, and a larger clock.
        const title = first.locator('[data-part="title"]');
        expect(await title.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(wide ? 16 : 15);
        expect(await title.evaluate(el => getComputedStyle(el).webkitLineClamp)).toBe(wide ? "3" : "2");
        const clock = first.locator("[data-clock]");
        expect(await clock.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(20);
        expect(ofFirst[0]!.width).toBeGreaterThanOrEqual(178);

        const before = await clock.getAttribute("data-clock");
        await expect(clock).not.toHaveAttribute("data-clock", before!, { timeout: 4000 });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/${scenario}-board-${size.name}.png` });
        if (shots && scenario === "swarm-demo-next") await page.screenshot({ path: `${shots}/board-slots2-${size.name}.png` });
      });
    }

    for (const scenario of ["swarm-demo", "swarm-demo-next"]) {
      test(`${scenario}: the tree opens fitted to its canvas with three workers and one card per slot, twenty in all`, async ({ page }) => {
        await page.goto(`/agents/swarm?scenario=${scenario}&view=tree`);
        const activity = page.getByRole("region", { name: "Swarm activity" });
        // The same count as above the board: slots busy of all slots, on how many workers.
        await expect(activity.getByRole("status")).toContainText(COUNT, { timeout: FIRST_PAINT });
        await expect(activity.getByRole("status")).not.toContainText(/free|agents running|machine/);
        await expect(activity.getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(SHARES);
        const tree = page.getByRole("region", { name: "Swarm tree" });
        // Server, machines, worker nodes, and under each node exactly as many slot cards as it has slots.
        await expect(tree.locator('[data-kind="machine"]')).toHaveCount(2);
        await expect(tree.locator('[data-kind="node"]')).toHaveCount(3);
        await expect(tree.locator('[data-kind="free"]')).toHaveCount(13);
        await expect(tree.locator('[data-kind="agent"]')).toHaveCount(scenario === "swarm-demo" ? 5 : 7);
        await expect(tree.locator('[data-kind="held"]')).toHaveCount(scenario === "swarm-demo" ? 2 : 0);
        await expect(tree.getByRole("button", { name: /^Fixture desktop, local · 24 cores · 6 of 16 slots busy on 2 workers/ })).toBeVisible();
        await expect(tree.getByRole("button", { name: /^Fixture laptop, local · 12 cores · 1 of 4 slots busy on 1 worker/ })).toBeVisible();
        for (const worker of ["Local Worker 1, 3 of 8 slots busy", "Local Worker 2, 3 of 8 slots busy", "Local Worker 3, 1 of 4 slots busy"]) await expect(tree.getByRole("button", { name: worker, exact: true })).toBeVisible();
        // Nothing holds in this response: no machine, node or slot says so.
        await expect(tree.locator('[data-state="holding"]')).toHaveCount(0);
        await expect(tree).not.toContainText("holding");
        // An agent card: the task's title first, then role and level, then model and effort, a clock, and its slot.
        const card = tree.getByRole("button", { name: /^Add retry backoff to the webhook sender / });
        await expect(card).toHaveAccessibleName("Add retry backoff to the webhook sender developer · Standard, high claude-sonnet-5-5 · high effort Slot 1");
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
        // Fitted: every card and every worker's frame is inside the canvas, and the page does not scroll.
        const drawn = await tree.locator(".react-flow__node").evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { id: n.getAttribute("data-id")!, kind: n.querySelector("[data-kind]")?.getAttribute("data-kind") ?? null, text: n.textContent ?? "", x: r.x, y: r.y, right: r.right, bottom: r.bottom }; }));
        const cards = drawn.filter(c => !c.id.startsWith("frame:")), frames = drawn.filter(c => c.id.startsWith("frame:"));
        // One server, two machines, three worker nodes and twenty slots; one frame per worker.
        expect(cards).toHaveLength(26);
        expect(frames.map(f => f.id)).toHaveLength(3);
        for (const c of drawn) {
          expect(c.x, c.id).toBeGreaterThanOrEqual(area.x);
          expect(c.y, c.id).toBeGreaterThanOrEqual(area.y);
          expect(c.right, c.id).toBeLessThanOrEqual(area.x + area.width);
          expect(c.bottom, c.id).toBeLessThanOrEqual(area.y + area.height);
        }
        expect(await page.evaluate(() => { const main = document.scrollingElement!; return main.scrollHeight <= main.clientHeight && main.scrollWidth <= main.clientWidth; })).toBe(true);
        // It fills the canvas rather than sitting small in the middle of it.
        const span = { width: Math.max(...drawn.map(c => c.right)) - Math.min(...drawn.map(c => c.x)), height: Math.max(...drawn.map(c => c.bottom)) - Math.min(...drawn.map(c => c.y)) };
        expect(Math.max(span.width / area.width, span.height / area.height)).toBeGreaterThan(0.9);
        // Local Worker 1's frame holds its eight slot cards in slot order, four across and two down; the agent of slot 4 is in slot 4.
        const frame = frames.find(f => f.id === `frame:node:${W1}`)!;
        const slots = cards.filter(c => ["agent", "free", "held"].includes(c.kind!) && c.x >= frame.x && c.right <= frame.right && c.y >= frame.y && c.bottom <= frame.bottom)
          .map(c => ({ kind: c.kind, slot: Number(c.text.match(/Slot (\d+)/)![1]), cx: Math.round((c.x + c.right) / 2), cy: Math.round((c.y + c.bottom) / 2), area: (c.right - c.x) * (c.bottom - c.y) }));
        const rows = [...new Set(slots.map(c => c.cy))].sort((a, b) => a - b), columns = [...new Set(slots.map(c => c.cx))].sort((a, b) => a - b);
        expect([rows.length, columns.length]).toEqual([2, 4]);
        expect([...slots].sort((a, b) => a.cy - b.cy || a.cx - b.cx).map(c => c.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
        expect(slots.filter(c => c.kind !== "free").map(c => c.slot).sort()).toEqual([1, 2, 4]);
        // Busy agents are what the eye finds: a free card is much smaller than a busy one.
        const busiest = Math.min(...slots.filter(c => c.kind === "agent").map(c => c.area)), freest = Math.max(...slots.filter(c => c.kind === "free").map(c => c.area));
        expect(freest).toBeLessThan(0.4 * busiest);
        // Legible: the size the title is drawn at (its font size times the tree's zoom), and the card's width. On a 1920×1080
        // screen it reads from across a room; in a 1280×720 window the whole fleet is in view and the viewer zooms to read.
        const zoom = await tree.locator(".react-flow__viewport").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
        const sized = async (selector: string) => zoom * await card.locator(selector).first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
        expect(await sized('[data-part="title"]')).toBeGreaterThanOrEqual(wide ? 14.5 : 7.5);
        expect(await sized("[data-clock]")).toBeGreaterThanOrEqual(wide ? 13.5 : 7);
        expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(wide ? 200 : 105);
        // The legend names the levels the cards carry.
        await expect(page.getByRole("list", { name: "Legend" }).getByRole("listitem")).toContainText(["simple", "standard", "complex", "deep"]);
        await expect(page.getByRole("list", { name: "Legend" })).not.toContainText("fast");
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
        expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
        if (shots) await page.screenshot({ path: `${shots}/${scenario}-tree-${size.name}.png` });
        if (shots && scenario === "swarm-demo-next") await page.screenshot({ path: `${shots}/tree-slots-${size.name}.png` });

        // Selecting opens the properties, by keyboard too; the tree refits to the room it has left; Escape closes them.
        await tree.locator('.react-flow__node[data-id^="agent:"]').first().focus();
        await page.keyboard.press("Enter");
        await expect(pane).toBeVisible();
        await expect(pane).toContainText(scenario === "swarm-demo-next" ? "Add retry backoff to the webhook sender" : /Agent|Task|session/i);
        const narrowed = (await tree.boundingBox())!;
        expect(narrowed.width).toBeLessThan(area.width - 200);
        if (narrowed.width >= 640) await expect.poll(async () => (await tree.locator(".react-flow__node").evaluateAll((nodes, right) => nodes.every(n => n.getBoundingClientRect().right <= right), narrowed.x + narrowed.width))).toBe(true);
        else {
          // Beside an agent's terminal in a 1280 window the canvas is phone-width: twenty slots cannot be read whole there, so
          // the tree opens at half size from the server down and the viewer pans.
          await expect.poll(async () => tree.locator(".react-flow__viewport").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a)).toBe(0.5);
          await expect(tree.getByRole("button", { name: /^AQ server/ })).toBeInViewport({ ratio: 1 });
        }
        await tree.locator('.react-flow__node[data-id^="agent:"]').first().focus();
        await page.keyboard.press("Escape");
        await expect(pane).toBeHidden();
        // Closed again, the whole tree is back in view.
        await expect.poll(async () => tree.locator(".react-flow__node").evaluateAll((nodes, a) => nodes.every(n => { const r = n.getBoundingClientRect(); return r.x >= a.x && r.right <= a.x + a.width && r.y >= a.y && r.bottom <= a.y + a.height; }), area)).toBe(true);
      });
    }

    test("the tree stays where the viewer put it: after a zoom it does not refit, and fit view hands it back", async ({ page }) => {
      await page.goto("/agents/swarm?scenario=swarm-demo-next&view=tree");
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.locator('[data-kind="node"]')).toHaveCount(3, { timeout: FIRST_PAINT });
      const zoom = () => tree.locator(".react-flow__viewport").evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
      await expect.poll(zoom).toBeGreaterThan(0.3);
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
      await expect(tree.getByRole("button", { name: /^Slot \d slot held starting or settling$/ })).toHaveCount(2, { timeout: FIRST_PAINT });
      await tree.getByRole("button", { name: "Slot 2 slot held starting or settling", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Starting or settling" })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });

    test("the design fixture's tree shows a hold on the node that holds, and only there", async ({ page }) => {
      await page.goto("/agents/swarm?view=tree");
      const tree = page.getByRole("region", { name: "Swarm tree" });
      await expect(tree.getByRole("button", { name: /^studio-1, .*holding: Capability report expired/ })).toBeAttached({ timeout: FIRST_PAINT });
      await expect(tree.getByRole("button", { name: /^studio, local · .*holding: Capability report expired/ })).toHaveAttribute("data-state", "holding");
      await expect(tree.getByRole("button", { name: "Slot 1 holding", exact: true })).toHaveAttribute("data-kind", "free");
      await expect(tree.getByRole("button", { name: /^desktop, local/ })).not.toHaveAttribute("data-state", "holding");
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("list", { name: "Machines" }).getByRole("listitem")).toHaveText(["desktop: 4 of 5 slots busy", "laptop: offline", "studio: 0 of 2 slots busy · holding", /^boat vm-a: booting$/]);
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("4 of 9 slots busy on 2 workers");
    });

    test("the design fixture's board keeps an offline and a holding machine sensible", async ({ page }) => {
      await page.goto("/agents/swarm?view=board");
      const board = page.getByRole("region", { name: "Swarm board" });
      await expect(board.getByRole("button", { name: /^laptop(?!-)/ })).toContainText("offline", { timeout: FIRST_PAINT });
      await expect(board.getByRole("button", { name: /^laptop-1/ })).toContainText("offline · last seen");
      await expect(board.getByRole("button", { name: "Slot 1 offline, laptop-1", exact: true })).toBeVisible();
      await expect(board.getByRole("button", { name: /^studio(?!-)/ })).toContainText("holding: Capability report expired");
      await expect(board.getByRole("button", { name: /^studio-1/ })).toContainText("holding: Capability report expired");
      await expect(board.getByRole("button", { name: "Slot 1 holding, studio-1", exact: true })).toBeVisible();
      // Three agents on a worker of three slots are three tiles, each in its slot.
      await expect(board.getByRole("list", { name: "local-1 slots" }).locator('li[data-state="running"]')).toHaveCount(3);
      await expect(page.getByRole("region", { name: "Swarm activity" }).getByRole("status")).toContainText("4 of 9 slots busy on 2 workers");
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).include('[aria-label="Swarm board"]').include('[aria-label="Swarm activity"]').analyze();
      expect(axe.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      if (shots) await page.screenshot({ path: `${shots}/design-fixture-board-${size.name}.png` });
    });
  });
}
