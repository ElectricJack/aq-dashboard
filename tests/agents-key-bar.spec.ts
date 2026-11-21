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

  // The controller of a task pane fits it to the browser pane and asks the session to follow (docs/operations/terminal-resize.md).
  test("text size A−/A+ changes xterm fontSize and refits the controlled task pane", async ({ page }) => {
    const resizes: { columns: number; rows: number }[] = [];
    page.on("request", (request) => { if (mutation("resize")(request)) resizes.push(request.postDataJSON().body); });
    const pane = await takeControl(page);
    const rows = pane.locator(".xterm-rows");
    const size = () => rows.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    expect(await size()).toBe(14);
    const smaller = pane.getByRole("button", { name: "A− Decrease text size" }), larger = pane.getByRole("button", { name: "A+ Increase text size" });
    await expect(smaller).toBeDisabled();
    const synced = async () => { const cols = await pane.getAttribute("data-cols"); return resizes.length > 0 && String(resizes.at(-1)!.columns) === cols; };
    await expect.poll(synced).toBe(true);
    await larger.click();
    await expect.poll(size).toBe(16);
    await expect.poll(synced).toBe(true);
    await expect(pane.getByRole("group", { name: "Text size" })).toContainText("16px");
    await larger.click(); await larger.click();
    await expect.poll(size).toBe(20);
    await expect(larger).toBeDisabled();
    await smaller.click();
    await expect.poll(size).toBe(18);
    await expect.poll(synced).toBe(true);
  });

  test("pan hint shows while a watching task pane's launch grid is wider than its container", async ({ page }) => {
    // A viewer without control keeps the session's grid and pans; only the controller resizes it.
    await page.route("**/api/v1/terminals/*/mutations", (route) => {
      const kind = (route.request().postDataJSON() as { kind?: string } | null)?.kind;
      return kind === "control" || kind === "renew" ? route.fulfill({ status: 403, json: { code: "forbidden", message: "No control" } }) : route.fallback();
    });
    await page.goto("/agents/sess-07");
    const pane = page.getByRole("region", { name: "Interactive agent terminal" });
    await expect(pane.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    const wider = () => pane.locator(".xterm-screen").evaluate((el) => el.scrollWidth > el.closest("[class*=host]")!.clientWidth);
    await expect.poll(wider).toBe(true);
    await expect(pane.getByText("120 columns · pan to view")).toBeVisible();
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

  test("the controller's pane follows the browser size without reconnecting or console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("pageerror", (error) => errors.push(error.message));
    const resizes: { columns: number; rows: number }[] = [], watches: Request[] = [];
    page.on("request", (request) => { if (mutation("resize")(request)) resizes.push(request.postDataJSON().body); if (mutation("watch")(request)) watches.push(request); });
    const pane = await takeControl(page);
    const synced = async () => resizes.length > 0 && String(resizes.at(-1)!.columns) === (await pane.getAttribute("data-cols"));
    await expect.poll(synced).toBe(true);
    const wide = resizes.at(-1)!;
    expect(wide.columns).toBeGreaterThan(120);
    const watched = watches.length;
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect.poll(async () => resizes.at(-1)!.columns).toBeLessThan(wide.columns);
    await expect.poll(synced).toBe(true);
    const count = resizes.length;
    await page.waitForTimeout(500);
    expect(resizes.length).toBe(count);
    await expect(pane.locator(".xterm-rows")).toContainText("Fixture output for Worker 07");
    expect(watches.length).toBe(watched);
    expect(errors).toEqual([]);
  });
});
