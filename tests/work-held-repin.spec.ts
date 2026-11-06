import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * aq-server #99 re-pin (human-graph-1 `held` readiness, hold reasons and history changes; results-feedback-1.1
 * `process_outcome`) at 1440x900 and 390x844. The server's own examples, contracts/live/human-graph/examples/
 * work.json and history.json, describe the base fixture task 0x003 (same project and task IDs), so they are served
 * verbatim for it. Unknown future enum values must read as a neutral "Unknown (value)" (lesson W77).
 */
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const base = id(3), approve = id(0x104), replay = id(0x105);
const workExample = JSON.parse(readFileSync("contracts/live/human-graph/examples/work.json", "utf8"));
const historyExample = JSON.parse(readFileSync("contracts/live/human-graph/examples/history.json", "utf8"));
const holdMessage: string = workExample.data.readiness.reasons[0].message;
const evidence = process.env.EVIDENCE_DIR;
const inspector = (page: Page) => page.locator("[data-task-inspector]");
const section = (page: Page, name: string) => inspector(page).locator("section[data-section]").filter({ has: page.getByRole("button", { name, exact: true }) });
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

/**
 * Rewrite JSON responses in the page (MSW's service worker is out of `page.route`'s reach). Each rule names a path
 * suffix and the body of a `(json) => json` function, run in the page.
 */
async function rewrite(page: Page, rules: { path: string; fn: string }[]) {
  await page.addInitScript(`(() => {
    const rules = [${rules.map((r) => `[${JSON.stringify(r.path)}, (json) => { ${r.fn} }]`).join(",")}];
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      const rule = (init?.method ?? "GET") === "GET" && rules.find(([path]) => url.pathname.endsWith(path));
      const response = await original(input, init);
      if (!rule || !response.ok) return response;
      const json = await response.json();
      return new Response(JSON.stringify(rule[1](json) ?? json), { status: response.status, headers: { "content-type": "application/json" } });
    };
  })();`);
}
const SERVER_EXAMPLES = [
  { path: `/tasks/${base}/work`, fn: `return ${JSON.stringify(workExample)};` },
  { path: `/tasks/${base}/history`, fn: `return ${JSON.stringify(historyExample)};` },
];

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  const desktop = vp.name === "desktop";
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("the server's held example reads Held with AQ's reason, never Running", async ({ page }) => {
      await rewrite(page, SERVER_EXAMPLES);
      await page.goto(`/work/${base}?${scope}`);
      const badge = inspector(page).locator("[data-task-status]");
      await expect(badge).toHaveText(/^Status: Held · cancelled attempt holds it$/);
      await expect(badge).toHaveAttribute("data-status", "held");
      await expect(badge).toHaveAttribute("title", holdMessage);
      const status = section(page, "Status");
      await expect(status.getByRole("list", { name: "Why the task is held" }).getByText(holdMessage)).toBeVisible();
      await expect(status.getByText(/AQ isn't running this task/)).toBeVisible();
      await expect(status.locator("[data-held-reason]")).toHaveCount(0);
      await expect(status.getByRole("link", { name: "Open session" })).toBeVisible();
      await expect(status.getByRole("link", { name: "Open terminal" })).toHaveCount(0);
      if (desktop) {
        // The inspected row's bullet follows AQ's held: the stop shape, not Running or Active.
        const row = page.getByRole("list", { name: "Tasks" }).getByRole("link").filter({ hasText: "Contract fixture: task inspection" });
        await expect(row.getByRole("img", { name: "Held" })).toBeVisible();
        await expect(row.locator("[data-status=held]")).toHaveCount(1);
      }
      await noHorizontalScroll(page);
      await axe(page);
      if (evidence) await page.screenshot({ path: `${evidence}/repin-held-${vp.name}.png` });
    });

    test("History shows each change's summary and from → to values from the server's example", async ({ page }) => {
      await rewrite(page, SERVER_EXAMPLES);
      await page.goto(`/work/${base}?${scope}`);
      const history = section(page, "History");
      await history.getByRole("button", { name: "History", exact: true }).click();
      await history.getByRole("button", { name: "Show all 7 changes" }).click();
      const list = history.getByRole("list", { name: "Change history" });
      await expect(list.locator(":scope > li")).toHaveCount(7);
      await expect(list.locator("[data-field=task_state]").first()).toHaveText(/^State active →\s*to completed$/);
      await expect(list.locator("[data-field=priority]")).toHaveText(/^Priority 0 →\s*to 5$/);
      await expect(list.getByText("added blocks from 00000000")).toBeVisible();
      await expect(list.getByRole("button", { name: "Copy related node ID" })).toBeVisible();
      await history.scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      await axe(page);
      if (evidence) await page.screenshot({ path: `${evidence}/repin-history-${vp.name}.png` });
    });

    test("a partial change is marked Partial", async ({ page }) => {
      const partial = structuredClone(historyExample);
      partial.data.items[2].change = { summary: "revision changed", fields: [], edge: null, complete: false };
      await rewrite(page, [SERVER_EXAMPLES[0]!, { path: `/tasks/${base}/history`, fn: `return ${JSON.stringify(partial)};` }]);
      await page.goto(`/work/${base}?${scope}`);
      const history = section(page, "History");
      await history.getByRole("button", { name: "History", exact: true }).click();
      await history.getByRole("button", { name: "Show all 7 changes" }).click();
      await expect(history.getByText("Partial", { exact: true })).toBeVisible();
    });

    test("W77: an unknown readiness value reads Unknown (value) and the view still works", async ({ page }) => {
      await rewrite(page, [{ path: `/tasks/${approve}/work`, fn: `json.data.readiness.state = "paused";` }]);
      await page.goto(`/work/${approve}?${scope}`);
      const badge = inspector(page).locator("[data-task-status]");
      await expect(badge).toHaveText(/^Status: Unknown \(paused\)$/);
      await expect(badge).toHaveAttribute("data-status", "unrecognized");
      await expect(section(page, "Status").getByText(/AQ reported the readiness “paused”/)).toBeVisible();
      await expect(page.getByText("Dashboard update required")).toHaveCount(0);
      await noHorizontalScroll(page);
      await axe(page);
    });

    test("task Results show the process outcome; an unknown value reads Unknown (value)", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const results = section(page, "Results");
      await expect(results.locator("[data-process-outcome]")).toHaveText("Process: Succeeded");
    });

    test("W77: an unknown process outcome reads Unknown (value) instead of failing the Results section", async ({ page }) => {
      await rewrite(page, [{ path: "/api/v1/results", fn: `for (const i of json.data.items) i.revision.process_outcome = "passed";` }]);
      await page.goto(`/work/${replay}?${scope}`);
      const results = section(page, "Results");
      await expect(results.locator("[data-process-outcome]")).toHaveText("Process: Unknown (passed)");
      await expect(results.locator("[data-process-outcome]")).toHaveAttribute("data-process-outcome", "unrecognized");
      await results.locator("[data-process-outcome]").scrollIntoViewIfNeeded();
      await noHorizontalScroll(page);
      await axe(page);
      if (evidence) await page.screenshot({ path: `${evidence}/repin-outcome-${vp.name}.png` });
    });
  });
}
