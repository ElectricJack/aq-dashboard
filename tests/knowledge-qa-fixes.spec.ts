import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-06 fixes on the Knowledge page (mock-mode labelled fixture record):
// ISSUE-004 Restore on a retired record, ISSUE-011 filters in the URL, ISSUE-012 category labels.
// The mock record is active and mock bootstrap offers no knowledge actions, so the retired
// case injects a [Fixture] lifecycle and the action capabilities through a fetch wrapper.
const project = "00000000-0000-0000-0000-000000000001";
const doc = "00000000-0000-0000-0000-000000000005";
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

async function retiredWithActions(page: Page) {
  await page.addInitScript(({ doc }) => {
    const names = ["dashboard.actions", "knowledge.author", "knowledge.correct", "knowledge.verify", "knowledge.retire", "knowledge.restore"];
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const response = await inner(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!response.ok) return response;
      if (url.pathname === "/api/v1/bootstrap") {
        const body = await response.clone().json();
        body.data.capabilities = [...body.data.capabilities.filter((c: { name: string }) => !names.includes(c.name)), ...names.map((name) => ({ name, version: "1", enabled: true }))];
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.pathname.endsWith(`/knowledge/${doc}`) && !url.searchParams.has("revision")) {
        const body = await response.clone().json();
        body.data = { ...body.data, retired: true, retirement_reason: "[Fixture] superseded" };
        return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
      }
      return response;
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  }, { doc });
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("a retired record offers Restore record and not Retire", async ({ page }) => {
      await retiredWithActions(page);
      await page.goto(`/knowledge/${doc}?scope=project:${project}`);
      const restore = page.getByRole("button", { name: "Restore record" });
      await expect(restore).toBeEnabled({ timeout: 30_000 });
      for (const name of ["Retire record", "Correct record", "Verify record"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
      await restore.click();
      const dialog = page.getByRole("dialog", { name: "Restore record" });
      await expect(dialog.getByRole("textbox", { name: "Content revision to restore" })).toBeVisible();
      await expect(dialog.getByRole("checkbox", { name: /Confirm restore/ })).toBeVisible();
      const results = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
    });

    test("library filters survive a reload", async ({ page }) => {
      await page.goto(`/knowledge?scope=project:${project}`);
      await expect(page.getByRole("list", { name: "Knowledge records" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("combobox", { name: /lifecycle/i }).selectOption("all");
      await page.getByRole("combobox", { name: /verification/i }).selectOption("unverified");
      await page.getByRole("combobox", { name: /sort/i }).selectOption("title");
      await expect(page).toHaveURL(/lifecycle=all/); await expect(page).toHaveURL(/verification=unverified/); await expect(page).toHaveURL(/sort=title/);
      await page.reload();
      await expect(page.getByRole("combobox", { name: /lifecycle/i })).toHaveValue("all", { timeout: 30_000 });
      await expect(page.getByRole("combobox", { name: /verification/i })).toHaveValue("unverified");
      await expect(page.getByRole("combobox", { name: /sort/i })).toHaveValue("title");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  });
}
