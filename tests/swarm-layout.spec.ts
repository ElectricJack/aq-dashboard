import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const large = "/agents/swarm?scenario=swarm-large-fleet&select=machine:fixture-fleet";
const id = (n: number) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

for (const width of [1440, 390]) {
  test(`synthetic 200-agent fleet stays bounded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
    await page.goto(large);
    const tree = page.getByRole("region", { name: "Swarm tree" });
    const pane = page.getByRole("complementary", { name: "Properties" });
    await expect(pane).toContainText("Fixture fleet");
    await expect(tree.locator('[data-kind="agent"]')).toHaveCount(200);
    await expect(tree.locator('[data-kind="free"]')).toHaveCount(4);
    // React Flow stores unscaled graph coordinates in each node's transform.
    for (const [start, count, worker] of [[1000, 150, 100], [1150, 50, 101]]) {
      const positions = await tree.locator(".react-flow__node[data-id^='agent:']").evaluateAll((elements, first) =>
        elements.filter(el => {
          const n = Number(el.getAttribute("data-id")!.slice(-12));
          return n >= first.start && n < first.start + first.count;
        }).map(el => {
          const transform = new DOMMatrixReadOnly((el as HTMLElement).style.transform);
          return { x: transform.m41, y: transform.m42 };
        }), { start, count });
      expect(positions).toHaveLength(count);
      expect(new Set(positions.map(p => p.x)).size).toBe(2);
      expect(new Set(positions.map(p => p.y)).size).toBe(count / 2);
      expect(Math.max(...positions.map(p => p.x)) - Math.min(...positions.map(p => p.x))).toBeLessThanOrEqual(150);
      const workerId = id(worker);
      const free = await tree.locator(`[data-id^="free:${workerId}:"]`).evaluateAll(elements => elements.map(el => {
        const transform = new DOMMatrixReadOnly((el as HTMLElement).style.transform);
        return { x: transform.m41, y: transform.m42 };
      }));
      expect(free).toHaveLength(2);
      expect(new Set(free.map(p => p.x - 5))).toEqual(new Set(positions.map(p => p.x)));
      expect(free[0]!.y).toBe(free[1]!.y);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const violations = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(violations.violations.map(v => v.id)).toEqual([]);
    await page.screenshot({ path: `test-results/swarm-large-fleet-${width}.png` });
    if (width === 390) {
      const treeBox = await tree.boundingBox(), paneBox = await pane.boundingBox();
      expect(paneBox!.y).toBeGreaterThanOrEqual(treeBox!.y + treeBox!.height - 1);
    }
  });
}

test("divider resizes with pointer and keyboard while preserving the tree and selection", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(large);
  const divider = page.getByRole("separator", { name: "Resize swarm tree and properties" });
  const tree = page.getByRole("region", { name: "Swarm tree" });
  const pane = page.getByRole("complementary", { name: "Properties" });
  await expect(pane).toContainText("Fixture fleet");
  await tree.evaluate(el => { (el as HTMLElement & { marker?: string }).marker = "tree"; });
  await pane.evaluate(el => { (el as HTMLElement & { marker?: string }).marker = "pane"; });
  const width = async () => (await tree.boundingBox())!.width;
  const initial = await width();
  const drag = async (distance: number) => {
    const box = (await divider.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await drag(-100);
  const smaller = await width();
  expect(smaller).toBeLessThan(initial - 50);
  await drag(150);
  const larger = await width();
  expect(larger).toBeGreaterThan(smaller + 80);
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  expect(await width()).toBeLessThan(larger);
  await expect(pane).toContainText("Fixture fleet");
  expect(await tree.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("tree");
  expect(await pane.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("pane");
  const saved = await width();
  await page.reload();
  await expect(pane).toContainText("Fixture fleet");
  await expect.poll(width).toBeCloseTo(saved, 0);
});

test("phone hides the divider", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(large);
  await expect(page.getByRole("complementary", { name: "Properties" })).toContainText("Fixture fleet");
  await expect(page.getByRole("separator", { name: "Resize swarm tree and properties" })).toBeHidden();
});

test("resizing keeps the selected fixture terminal mounted and refits it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/swarm?select=agent:sess-07");
  const terminal = page.locator("[data-interactive-terminal]");
  await expect(terminal).toBeVisible();
  await expect(terminal.getByRole("status").filter({ hasText: "You have control" })).toBeAttached({ timeout: 15_000 });
  await expect.poll(async () => Number(await terminal.getAttribute("data-fit-cols"))).toBeGreaterThan(0);
  const before = Number(await terminal.getAttribute("data-fit-cols"));
  await terminal.evaluate(el => { (el as HTMLElement & { marker?: string }).marker = "same terminal"; });
  const divider = page.getByRole("separator", { name: "Resize swarm tree and properties" });
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 180, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await terminal.getAttribute("data-fit-cols"))).toBeGreaterThan(before);
  expect(await terminal.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("same terminal");
  await expect(terminal.getByRole("status").filter({ hasText: "You have control" })).toBeAttached();
});

test("narrow machine properties scroll to their bottom controls", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await page.goto("/agents/swarm?select=machine:desktop");
  const pane = page.getByRole("complementary", { name: "Properties" });
  await expect(pane).toContainText("desktop");
  const divider = page.getByRole("separator", { name: "Resize swarm tree and properties" });
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  const metrics = await pane.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, top: el.scrollTop }));
  expect(metrics.content).toBeGreaterThan(metrics.height);
  const paneBox = (await pane.boundingBox())!;
  await page.mouse.move(paneBox.x + paneBox.width / 2, paneBox.y + paneBox.height / 2);
  await page.mouse.wheel(0, 1500);
  await expect.poll(() => pane.evaluate(el => el.scrollTop)).toBeGreaterThan(metrics.top);
  const bottomControl = pane.getByRole("button", { name: "Drain" });
  const [controlBox, visiblePane] = [await bottomControl.boundingBox(), await pane.boundingBox()];
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(visiblePane!.y + visiblePane!.height + 1);
});

test("supervisor dock preserves swarm height and selected pane", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/swarm?select=machine:desktop");
  const tree = page.getByRole("region", { name: "Swarm tree" });
  const pane = page.getByRole("complementary", { name: "Properties" });
  const stage = page.getByRole("separator", { name: "Resize swarm tree and properties" }).locator("xpath=..");
  await expect(pane).toContainText("desktop");
  await tree.evaluate(el => { (el as HTMLElement & { marker?: string }).marker = "tree"; });
  await pane.evaluate(el => { (el as HTMLElement & { marker?: string }).marker = "pane"; });
  const before = (await stage.boundingBox())!;
  await page.getByRole("button", { name: "Open supervisor" }).click();
  const dock = page.getByRole("region", { name: "Global supervisor conversation" });
  await expect(dock).toBeVisible();
  await expect(pane).toContainText("desktop");
  const open = (await stage.boundingBox())!;
  expect(open.height).toBeGreaterThan(450);
  expect(Math.abs(open.height - before.height)).toBeLessThan(80);
  expect(open.y + open.height).toBeGreaterThan(880);
  expect(await tree.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("tree");
  expect(await pane.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("pane");
  await page.screenshot({ path: "test-results/swarm-supervisor-dock-1440.png" });
  await dock.getByRole("button", { name: "Close chat" }).click();
  await expect(dock).toBeHidden();
  const closed = (await stage.boundingBox())!;
  expect(Math.abs(closed.height - before.height)).toBeLessThan(2);
  await expect(pane).toContainText("desktop");
  expect(await tree.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("tree");
  expect(await pane.evaluate(el => (el as HTMLElement & { marker?: string }).marker)).toBe("pane");
});
