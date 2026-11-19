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

test("tree and board share the worker inspector and preserve drafts across tabs", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/agents/swarm?view=tree");
  await page.getByRole("region", { name: "Swarm tree" }).getByRole("button", { name: /^local-1,/ }).click();

  const pane = page.getByRole("complementary", { name: "Properties" });
  const capacity = pane.getByRole("region", { name: "Worker capacity" });
  await expect(capacity).toContainText("3 of 3 slots busy");
  await expect(pane).toContainText("Heartbeat");
  await expect(pane.getByRole("button", { name: "Open terminal" })).toBeEnabled();
  await expect(pane.getByRole("button", { name: "Push Claude token" })).toBeHidden();

  const overview = pane.getByRole("tab", { name: "Overview" });
  await overview.focus();
  await overview.press("ArrowRight");
  await expect(pane.getByRole("tab", { name: "Settings" })).toBeFocused();
  const name = pane.getByRole("textbox", { name: "Name" });
  await name.fill("Draft label");
  await overview.click();
  await expect(name).toBeHidden();
  await page.getByRole("button", { name: "Board", exact: true }).click();
  await expect(pane.getByRole("heading", { name: "local-1" })).toBeVisible();
  await pane.getByRole("tab", { name: "Settings" }).click();
  await expect(name).toHaveValue("Draft label");
  await expect(pane.getByRole("button", { name: "Remove worker node" })).toBeVisible();
  await pane.getByRole("tab", { name: "Logins" }).click();
  await expect(pane.getByRole("button", { name: "Push Claude token" })).toBeEnabled();
  await pane.getByRole("tab", { name: "Diagnostics" }).click();
  await expect(pane.getByText("docker-local", { exact: true })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Run checks" })).toBeEnabled();
  await expect(pane.getByRole("button", { name: "Drain node" })).toBeDisabled();

  const boardWorker = page.getByRole("region", { name: "Swarm board" }).getByRole("button", { name: /^local-2/ });
  await boardWorker.click();
  await expect(pane.getByRole("heading", { name: "local-2" })).toBeVisible();
  await expect(pane.getByRole("button", { name: "Run checks" })).toBeHidden();
  await pane.getByRole("button", { name: "Close worker details" }).click();
  await expect(pane).toBeHidden();
  await expect(boardWorker).toBeFocused();
});

test("worker details reflow and return focus to the board at 320px", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 750 });
  await page.goto("/agents/swarm?view=board");
  const worker = page.getByRole("region", { name: "Swarm board" }).getByRole("button", { name: /^studio-1/ });
  await worker.click();

  const pane = page.getByRole("complementary", { name: "Properties" });
  await expect(pane.getByRole("heading", { name: "studio-1" })).toBeFocused();
  await expect(pane.getByText("Capability report expired", { exact: true })).toBeVisible();
  await pane.getByRole("tab", { name: "Diagnostics" }).click();
  await noOverflow(page);
  const results = await new AxeBuilder({ page }).include('[aria-label="Properties"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const serviceNote = pane.getByText("Use the machine’s controls to manage the worker service.");
  const phoneNav = page.getByRole("navigation", { name: "Primary (compact)" });
  const [noteBox, navBox] = await Promise.all([serviceNote.boundingBox(), phoneNav.boundingBox()]);
  expect(noteBox!.y + noteBox!.height).toBeLessThan(navBox!.y);
  await pane.getByRole("button", { name: "Close worker details" }).click();
  await expect(worker).toBeFocused();
});

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("swarm landing renders every state; the whole tree is fitted at open", async ({ page }) => {
      await page.goto("/agents/swarm");
      // The tree opens fitted to the viewport; at phone width off-screen cards are attached, not necessarily in view.
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeInViewport();
      for (const name of [/^desktop, local/, /^laptop, local · offline/, /^studio, local.*holding/, /^boat vm-a, cloud · booting/]) await expect(page.getByRole("button", { name })).toBeAttached();
      // Work waiting for a slot is not drawn in the tree.
      await expect(page.getByRole("button", { name: /^waiting/ })).toHaveCount(0);
      await expect(page.locator('[data-kind="waiting"], [data-kind="waitingAgent"]')).toHaveCount(0);
      // One card per slot. The holding node's two slots say holding, not free; the only free slot is local-2's second.
      await expect(page.getByRole("button", { name: /^Slot \d holding$/ })).toHaveCount(2);
      await expect(page.getByRole("button", { name: /^Slot \d free$/ })).toHaveCount(1);
      await expect(page.locator('[data-kind="agent"]')).toHaveCount(4);
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
      // The whole tree is fitted at 1440; at 390 it opens at 0.5 centred on the server root, so only the server card is asserted.
      if (!vp.phone) for (const name of [/^desktop, local/, /^laptop, local · offline/, /^studio, local.*holding/, /^boat vm-a, cloud · booting/]) await inside(name);
    });

    test("Tab reaches the first machine card with a visible focus ring, inside the tree", async ({ page }) => {
      test.skip(vp.phone, "keyboard focus is checked at desktop width");
      await page.goto("/agents/swarm");
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeInViewport();
      await page.getByRole("link", { name: "History" }).focus();
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
      await page.goto("/agents/swarm?select=machine:studio");
      await expect(page.getByRole("complementary", { name: "Properties" })).toContainText("studio");
      await expect(page.getByRole("button", { name: /^studio, local/ })).toBeInViewport({ ratio: 1 });
    });

    test("selecting an agent opens the terminal with control", async ({ page }) => {
      // Cards beyond the first screen need panning, so the selection arrives through the URL.
      await page.goto("/agents/swarm?select=agent:sess-07");
      const terminal = page.getByRole("region", { name: "Agent terminal" });
      await expect(terminal).toBeVisible();
      await expect(terminal.getByRole("status").filter({ hasText: "You have control" })).toBeAttached({ timeout: 15_000 });
    });

    test("pan and zoom controls exist", async ({ page }) => {
      await page.goto("/agents/swarm");
      await expect(page.locator(".react-flow__controls")).toBeVisible();
    });

    test("axe has no violations on /agents/swarm", async ({ page }) => {
      await page.goto("/agents/swarm");
      await expect(page.getByRole("button", { name: /^AQ server/ })).toBeVisible();
      await axe(page);
    });
  });
}

test("phone stacks tree above pane without horizontal scroll", async ({ page }) => {
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    // The properties are closed until something is selected.
    await page.goto("/agents/swarm");
    await expect(page.getByRole("button", { name: /^AQ server/ })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Properties" })).toBeHidden();
    await noOverflow(page);
    await page.goto("/agents/swarm?select=machine:desktop");
    await expect(page.getByRole("complementary", { name: "Properties" })).toContainText("desktop");
    await noOverflow(page);
    const tree = await page.getByRole("region", { name: "Swarm tree" }).boundingBox();
    const pane = await page.getByRole("complementary", { name: "Properties" }).boundingBox();
    expect(pane!.y).toBeGreaterThanOrEqual(tree!.y + tree!.height - 1);
  }
});

test.describe("phone pane rows", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("each definition label is on the same row as its value", async ({ page }) => {
    await page.goto("/agents/swarm?select=machine:desktop");
    const pane = page.getByRole("complementary", { name: "Properties" });
    await expect(pane.locator("dt").first()).toBeVisible();
    const tops = await pane.locator("dl dt").evaluateAll((labels) => labels.map((dt) => [dt.textContent, dt.getBoundingClientRect().top, (dt.nextElementSibling as HTMLElement).getBoundingClientRect().top] as const));
    expect(tops.length).toBeGreaterThan(3);
    for (const [label, dtTop, ddTop] of tops) expect(Math.abs(dtTop - ddTop), label ?? "").toBeLessThanOrEqual(2);
  });
});
