import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA 2026-11-06 shell-overview regressions (qa/2026-11-06/shell-overview/issues.md), mock mode.
 * Data-shape cases (SO-04, SO-05 production search, SO-06, SO-07, SO-11) are unit tests,
 * because mock-mode search uses the project graph and the mock overview has no live shapes.
 */
const project = "00000000-0000-0000-0000-000000000001";
const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function expectAxeClean(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

async function openSearch(page: Page) {
  await page.getByRole("button", { name: "Search" }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe("desktop", () => {
  test.use({ viewport: DESKTOP });

  test("SO-15: attention title, reason and impact are readable without a tooltip", async ({ page }) => {
    await page.goto("/overview");
    const rows = page.locator("[data-attention-row]");
    await expect(rows.first()).toBeVisible({ timeout: 15_000 });
    // Lengthen one row's text to the live shape, then check nothing is clipped.
    await rows.first().evaluate((row) => {
      const [title, secondary] = row.querySelectorAll("div > span");
      title!.textContent = "Failed process result for a task with a long descriptive title";
      secondary!.textContent = "Local scratch development · waiting 4h · The current retained result reports process failure; task settlement is separate";
      row.querySelector(":scope > span")!.textContent = "Review the owning record for current context";
    });
    for (const part of await rows.first().locator("div > span, :scope > span").all()) {
      const clipped = await part.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === "ellipsis");
      expect(clipped).toBe(false);
    }
  });

  test("SO-16: a Work in motion project opens that project in Work", async ({ page }) => {
    await page.goto("/overview");
    const link = page.getByRole("rowheader", { name: "agent-queue" }).getByRole("link", { name: "agent-queue" });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await link.click();
    await expect(page).toHaveURL(/\/work\?scope=project(%3A|:)agent-queue$/);
  });

  test("SO-09: Inspect eligibility keeps the project scope", async ({ page }) => {
    await page.goto(`/overview?scope=project:${project}`);
    const link = page.getByRole("link", { name: /Inspect eligibility/ });
    await expect(link).toHaveAttribute("href", `/settings?scope=project%3A${project}`, { timeout: 15_000 });
  });

  test("SO-17: section headings scale with Settings › Text size", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("aq.dashboard.display-preferences", JSON.stringify({ textSize: "larger", motion: "system", terminalFontSize: 14 })));
    await page.goto("/overview");
    const heading = page.getByRole("heading", { level: 2, name: "Needs your attention" });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    expect(await heading.evaluate((el) => getComputedStyle(el).fontSize)).toBe("24px");
  });

  test("SO-18 and SO-19: search names what it covers and explains the length limit", async ({ page }) => {
    await page.goto(`/overview?scope=project:${project}`);
    const dialog = await openSearch(page);
    const box = dialog.getByRole("searchbox", { name: "Search" });
    await expect(box).toHaveAttribute("placeholder", /results, knowledge/);
    await box.fill("x".repeat(600));
    await expect(dialog.getByRole("alert")).toHaveText("Search is limited to 256 characters. Shorten your search.");
    await expect(box).toHaveAttribute("aria-invalid", "true");
    await expect(dialog.getByText(/couldn't load/i)).toHaveCount(0);
    await expectAxeClean(page);
  });
});

test.describe("phone", () => {
  test.use({ viewport: PHONE });

  test("SO-20: long unbroken tokens in search results wrap inside the dialog", async ({ page }) => {
    await page.goto(`/overview?scope=project:${project}`);
    const dialog = await openSearch(page);
    await dialog.getByRole("searchbox").fill("recovery");
    const hit = dialog.locator("[data-search-result]").first();
    await expect(hit).toBeVisible({ timeout: 15_000 });
    // The live result summaries carry file lists with no break opportunities.
    await hit.evaluate((link) => {
      const [title, meta] = link.querySelectorAll("span");
      title!.textContent = "Changes: .gitignore,Cargo.lock,Cargo.toml,src,src/lib.rs,src/very/long/path/name.rs;";
      meta!.textContent = "Local scratch development · .gitignore,Cargo.lock,Cargo.toml,src,src/lib.rs,README.md";
    });
    const body = dialog.locator(":scope > div").nth(1);
    const { scroll, client } = await body.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test("SO-22: the reason Create task is disabled is visible", async ({ page }) => {
    await page.goto("/overview");
    const create = page.getByRole("button", { name: /create task/i });
    await expect(create).toBeDisabled({ timeout: 15_000 });
    const hint = page.locator("#content").getByText("Choose a project first");
    const box = await hint.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(40);
    expect(box?.height ?? 0).toBeGreaterThan(10);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
});
