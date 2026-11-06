import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-06 shared-core fixes: §2A error containment, SO-23 titles,
// SO-13 retained-data age, SO-14 / ISSUE-007 focus management.
const project = "00000000-0000-0000-0000-000000000001";

/**
 * Answers matching requests with `status` from inside the page, ahead of the
 * mock network (MSW patches fetch in-page, so Playwright routing never sees it).
 */
async function refuse(page: Page, method: string, pattern: string, status: number, body: object) {
  await page.addInitScript(({ method, pattern, status, body }) => {
    let inner: typeof fetch = window.fetch.bind(window);
    const outer: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const verb = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (verb === method && new RegExp(pattern).test(url)) {
        return Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
      }
      return inner(input, init);
    };
    Object.defineProperty(window, "fetch", { configurable: true, get: () => outer, set: (value: typeof fetch) => { inner = value; } });
  }, { method, pattern, status, body });
}
const forbidden = { request_id: "qa", code: "forbidden", message: "This request is not available to your account", retryable: false };

test.use({ viewport: { width: 1440, height: 900 } });

test("SO-23: the tab title names the page", async ({ page }) => {
  await page.goto("/overview");
  await expect(page).toHaveTitle("Overview — Agent Q");
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Work" }).click();
  await expect(page).toHaveTitle("Work — Agent Q");
  await page.goto("/settings");
  await expect(page).toHaveTitle("Settings — Agent Q");
});

test("WD-05 / SO-03: a 403 on Create task stays in the dialog and keeps the draft", async ({ page }) => {
  await refuse(page, "POST", `/api/human/projects/${project}/tasks$`, 403, { error: "csrf_rejected", message: "request origin is not allowed" });
  await page.goto(`/work?scope=project:${project}`);
  await page.getByRole("button", { name: "Create task" }).click();
  const dialog = page.getByRole("dialog", { name: "Create task" });
  await dialog.getByRole("textbox", { name: "Title" }).fill("QA draft that must survive a refusal");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog.getByText(/AQ refused this request; no task was created\..*Your draft is preserved\./)).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveValue("QA draft that must survive a refusal");
  await expect(page.getByRole("heading", { name: "Access denied" })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Primary", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/operation=/);
});

test("WD-12: an unknown decision link shows the neutral not-found view inside Decisions", async ({ page }) => {
  await refuse(page, "GET", "/api/reviews/decisions/e0a20000-0000-4000-8000-00000000beef$", 403, { error: "forbidden", message: "review is not available to this owner" });
  await page.goto("/decisions/e0a20000-0000-4000-8000-00000000beef");
  await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Decisions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Access denied" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
});

test("SO-13: offline keeps the overview and says how old it is", async ({ page, context }) => {
  await page.goto("/overview");
  await expect(page.getByRole("list", { name: "Work counts" })).toBeVisible();
  await context.setOffline(true);
  await expect(page.getByText(/^Offline\. Showing data read .+ ago; it will refresh when you reconnect\.$/)).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText(/^Offline\. Showing data read/)).toHaveCount(0);
});

test("SO-14 / ISSUE-007: Back returns focus to the link that opened the page", async ({ page }) => {
  await page.goto("/agents");
  const link = page.getByRole("main").getByRole("link", { name: /Worker 07/ }).first();
  const href = await link.getAttribute("href");
  await link.click();
  await expect(page.getByRole("heading", { level: 2, name: "Worker 07" })).toBeAttached();
  await page.goBack();
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("href"))).toBe(href);
});

test("SO-14 / ISSUE-007: opening the supervisor dock moves focus into it", async ({ page }) => {
  await page.goto("/overview");
  await page.getByRole("button", { name: "Open supervisor" }).click();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[data-mode="dock"]'))).toBe(true);
  await page.getByRole("button", { name: "Close chat" }).click();
  await expect(page.getByRole("button", { name: "Open supervisor" })).toBeFocused();
});

test("ISSUE-013: the header search icon keeps its size at the Larger text size", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("aq.dashboard.display-preferences", JSON.stringify({ textSize: "larger", motion: "system", terminalFontSize: 14 })));
  await page.goto("/overview");
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "larger");
  const icon = page.getByRole("banner").getByRole("button", { name: /Search/ }).locator("svg");
  const box = (await icon.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(17);
  expect(box.height).toBeGreaterThanOrEqual(17);
});
