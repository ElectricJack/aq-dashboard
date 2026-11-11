import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Request } from "@playwright/test";

// AG-E (calm-vault-46.8): sticky Ctrl modifier, text size and pan hint on the
// labelled fixture terminal (src/mocks/terminal.ts) in `vite --mode mock`.
const SHOTS = process.env.FIXTURE_SHOTS;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const mutation = (kind: string) => (request: Request) => {
  if (request.method() !== "POST" || !request.url().includes("/mutations")) return false;
  return (request.postDataJSON() as { kind?: string }).kind === kind;
};

async function takeControl(page: Page) {
  await page.goto("/agents/sess-07");
  const pane = page.getByRole("region", { name: "Interactive agent terminal" });
  await expect(pane.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
  await expect(pane).toHaveAttribute("data-controlling");
  await expect(pane.getByRole("status").filter({ hasText: "You have control" })).toBeVisible();
  return pane;
}

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("sticky Ctrl sends the next key as a control code, then clears", async ({ page }) => {
    const pane = await takeControl(page);
    const bar = pane.getByRole("group", { name: "Terminal keyboard" });
    for (const name of ["Esc", "Tab", "Ctrl", "Left arrow", "Up arrow", "Down arrow", "Right arrow", "Enter"]) await expect(bar.getByRole("button", { name, exact: true })).toBeAttached();
    const ctrl = bar.getByRole("button", { name: "Ctrl", exact: true });
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
    await ctrl.click();
    await expect(ctrl).toHaveAttribute("aria-pressed", "true");
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-key-bar-ctrl-phone-390.png` });
    const input = page.waitForRequest(mutation("input"));
    await page.keyboard.press("c");
    expect((await input).postDataJSON().body.bytes).toEqual([3]);
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
    // An armed modifier also applies to on-screen arrows (xterm's Ctrl parameter).
    await ctrl.click();
    const arrow = page.waitForRequest(mutation("input"));
    await bar.getByRole("button", { name: "Up arrow" }).click();
    expect((await arrow).postDataJSON().body.bytes).toEqual([...new TextEncoder().encode("\x1b[1;5A")]);
    await expect(ctrl).toHaveAttribute("aria-pressed", "false");
    await axe(page);
  });

  test("key bar scrolls with an edge fade so no key is hidden without an affordance", async ({ page }) => {
    const pane = await takeControl(page);
    const bar = pane.getByRole("group", { name: "Terminal keyboard" });
    expect(await bar.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(bar).toHaveAttribute("data-fade-end", "true");
    await expect(bar).not.toHaveAttribute("data-fade-start", /.*/);
    await bar.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    await expect(bar).toHaveAttribute("data-fade-start", "true");
    await expect(bar).not.toHaveAttribute("data-fade-end", /.*/);
    await expect(bar.getByRole("button", { name: "Enter" })).toBeInViewport();
  });

  test("text size A−/A+ changes xterm fontSize, refits and sends a resize", async ({ page }) => {
    const pane = await takeControl(page);
    const rows = pane.locator(".xterm-rows");
    const size = () => rows.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size()).toBe(14);
    const smaller = pane.getByRole("button", { name: "A− Decrease text size" }), larger = pane.getByRole("button", { name: "A+ Increase text size" });
    await expect(smaller).toBeDisabled();
    const resize = page.waitForRequest(mutation("resize"));
    await larger.click();
    await expect.poll(size).toBe(16);
    expect((await resize).postDataJSON().body).toMatchObject({ columns: 80 });
    await expect(pane.getByRole("group", { name: "Text size" })).toContainText("16px");
    await larger.click(); await larger.click();
    await expect.poll(size).toBe(20);
    await expect(larger).toBeDisabled();
    await smaller.click();
    await expect.poll(size).toBe(18);
  });

  test("pan hint shows while the 80-column grid is wider than its container", async ({ page }) => {
    await page.goto("/agents/sess-07");
    const pane = page.getByRole("region", { name: "Interactive agent terminal" });
    await expect(pane.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    const wider = () => pane.locator(".xterm-screen").evaluate((el) => el.scrollWidth > el.closest("[class*=host]")!.clientWidth);
    await expect.poll(wider).toBe(true);
    await expect(pane.getByText("80 columns · pan to view")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-key-bar-watch-phone-390.png` });
    await axe(page);
  });
});

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("desktop uses physical keys without a phone key bar when the grid fits", async ({ page }) => {
    const pane = await takeControl(page);
    await expect(pane.getByRole("group", { name: "Terminal keyboard" })).toHaveCount(0);
    expect(await pane.locator(".xterm-screen").evaluate((el) => el.scrollWidth > el.closest("[class*=host]")!.clientWidth)).toBe(false);
    await expect(pane.getByText(/columns · pan to view/)).toBeHidden();
    await expect(pane.getByRole("group", { name: "Text size" })).toBeHidden();
    const sent=page.waitForRequest(mutation("input"));
    await pane.locator(".xterm-helper-textarea").focus();
    await page.keyboard.press("Escape");
    expect((await sent).postDataJSON().body.bytes).toEqual([27]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/agents-key-bar-desktop-1440.png` });
    await axe(page);
  });
});
