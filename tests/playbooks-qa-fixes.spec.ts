import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-06 fixes on the Playbooks page (mock-mode labelled fixtures):
// ISSUE-005 filter indicator, ISSUE-008 rollback at revision 1, ISSUE-010 tabpanel,
// ISSUE-011 filters in the URL, ISSUE-015 phone tabs.
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
];

async function expectClean(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

/** Rewrites the current activations catalog so its binding is at revision 1 (no earlier activation). */
async function firstActivation(page: Page) {
  await page.addInitScript(() => {
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const response = await inner(input, init);
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (!url.pathname.endsWith("/catalog/activations") || !response.ok) return response;
      const body = await response.clone().json();
      for (const item of body.items) item.record.metadata.revision = "1";
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (value: typeof fetch) => { current = wrap(value); } });
  });
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("default runs announce no filter; view tabs fit and control a tabpanel", async ({ page }) => {
      await page.goto("/playbooks");
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Filtering loaded runs")).toHaveCount(0);
      const tablist = page.getByRole("tablist", { name: "Playbook views" }), strip = (await tablist.boundingBox())!;
      for (const name of ["Runs", "Definitions", "Activations", "Admissions"]) {
        const tab = tablist.getByRole("tab", { name }), box = (await tab.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(strip.x - 1); expect(box.x + box.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
        expect(await tab.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      }
      const panel = page.getByRole("tabpanel", { name: "Runs" });
      await expect(panel).toBeVisible();
      await expect(tablist.getByRole("tab", { name: "Runs" })).toHaveAttribute("aria-controls", (await panel.getAttribute("id"))!);
      await expectClean(page);
    });

    test("run filters survive a reload and carry into run links", async ({ page }) => {
      await page.goto("/playbooks");
      await expect(page.getByRole("list", { name: "Playbook runs" })).toBeVisible({ timeout: 30_000 });
      await page.getByRole("combobox", { name: "Run state" }).selectOption("waiting");
      await page.getByRole("combobox", { name: "Time range" }).selectOption("all");
      await expect(page).toHaveURL(/state=waiting/); await expect(page).toHaveURL(/range=all/);
      await expect(page.getByText("Filtering loaded runs")).toBeVisible();
      await page.reload();
      await expect(page.getByRole("combobox", { name: "Run state" })).toHaveValue("waiting", { timeout: 30_000 });
      await expect(page.getByRole("combobox", { name: "Time range" })).toHaveValue("all");
      const first = page.getByRole("list", { name: "Playbook runs" }).getByRole("link").first();
      await expect(first).toHaveAttribute("href", /state=waiting&range=all/);
    });

    test("roll back is not offered at binding revision 1", async ({ page }) => {
      await firstActivation(page);
      await page.goto("/playbooks?view=activations");
      const list = page.getByRole("list", { name: "Current playbook activations" });
      await list.getByRole("button").first().click({ timeout: 30_000 });
      const rollback = page.getByRole("button", { name: "Roll back activation" });
      await expect(rollback).toBeDisabled({ timeout: 30_000 });
      await expect(page.getByText("No earlier activation is recorded for this binding (binding revision 1)")).toBeVisible();
      await expectClean(page);
    });
  });
}
