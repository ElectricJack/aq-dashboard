import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * Spec 0004 Phase 1 checklist (task view parity) at 1440x900 and 390x844, against the labelled mock fixtures
 * (src/mocks/humanGraph.ts, results.ts). Fixture tasks: 0x105 "Replay reconciliation" holds a running attempt,
 * had a failed one, has 30 history entries and a result; 0x101 "Worker recovery" is the parent of the rest;
 * 0x004 "verify recovery" waits for the active contract task 0x003.
 */
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const replay = id(0x105), parent = id(0x101), waiting = id(4);
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

/** Overlay `/api/v1/actions` (MSW's service worker is out of `page.route`'s reach): confirm every POST, record it. */
async function confirmActions(page: Page) {
  await page.addInitScript((project) => {
    const original = window.fetch.bind(window);
    const w = window as unknown as { __posts: unknown[] }; w.__posts = [];
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname !== "/api/v1/actions" || init?.method !== "POST") return original(input, init);
      const body = JSON.parse(String(init.body)) as { operation_id: string; kind: string; subject: unknown; payload: unknown };
      w.__posts.push({ kind: body.kind, payload: body.payload });
      const now = new Date().toISOString();
      return new Response(JSON.stringify({ api_version: "dashboard-actions-1", request_id: "overlay", data: {
        operation_id: body.operation_id, disposition: "confirmed", request_digest: `sha256:${"0".repeat(64)}`, scope: { kind: "project", project_id: project },
        created_at: now, updated_at: now, subject_refs: [body.subject], receipt_refs: [{ type: "graph_change_set", id: body.operation_id }], affected_entities: [], recovery: "none" } }),
      { status: 200, headers: { "content-type": "application/json" } });
    };
  }, project);
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  const desktop = vp.name === "desktop";
  // A phone keeps every action in one Task actions menu (P1-02).
  const actionsMenu = desktop ? "More actions" : "Task actions";
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("task ID is visible and copies the full ID with one click", async ({ page, context }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(`/work/${replay}?${scope}`);
      await expect(inspector(page).getByText(replay, { exact: true })).toBeVisible();
      await inspector(page).getByRole("button", { name: "Copy task ID" }).click();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(replay);
      await expect(inspector(page).getByRole("button", { name: "task ID copied" })).toBeVisible();
      await noHorizontalScroll(page);
    });

    test("status shows the real readiness and which blocker", async ({ page }) => {
      await page.goto(`/work/${waiting}?${scope}`);
      await expect(inspector(page).locator("[data-task-status]")).toHaveText(/Waiting · blocked by “Contract fixture: task inspection”/);
      await expect(section(page, "Status").getByRole("list", { name: "Unsatisfied blockers" }).getByRole("link", { name: "Contract fixture: task inspection" })).toBeVisible();
      await page.goto(`/work/${replay}?${scope}`);
      await expect(inspector(page).locator("[data-task-status]")).toHaveText(/Running/);
    });

    test("Open terminal opens the holding agent's session", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await section(page, "Status").getByRole("link", { name: "Open terminal" }).click();
      await expect(page).toHaveURL(new RegExp(`/agents/${id(0x302)}`));
      await expect(page.getByRole("heading", { level: 2, name: /Fixture attempt session 0302/ })).toBeVisible();
    });

    test("attempts show provider, model, harness, times and copyable IDs", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const attempts = section(page, "Attempts").getByRole("list", { name: "Attempts" }).getByRole("listitem");
      await expect(attempts).toHaveCount(2);
      await expect(attempts.nth(0)).toContainText("anthropic · claude-opus-5-5 · claude-code");
      await expect(attempts.nth(0)).toContainText(/Started .* ago · No stop recorded/);
      await expect(attempts.nth(1)).toContainText("openai · gpt-5.3-codex · codex");
      await expect(attempts.nth(1)).toContainText(/Stopped .* ago/);
      await expect(attempts.nth(0).getByRole("button", { name: "Copy attempt ID" })).toBeVisible();
      await expect(attempts.nth(0).getByRole("button", { name: "Copy session ID" })).toBeVisible();
      if (evidence) await section(page, "Attempts").screenshot({ path: `${evidence}/p1-attempts-${vp.name}.png` });
    });

    test("history shows who changed what, newest first", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await section(page, "History").getByRole("button", { name: "History", exact: true }).click();
      const entries = section(page, "History").getByRole("list", { name: "Change history" }).getByRole("listitem");
      await expect(entries).toHaveCount(5);
      await expect(entries.first()).toContainText("Set task state");
      await expect(entries.first()).toContainText("fixture-agent-session");
      await section(page, "History").getByRole("button", { name: "Show all 30 changes" }).click();
      await expect(entries).toHaveCount(30);
      await expect(entries.last()).toContainText("owner@example.test");
    });

    test("parent link, child counts and dependency reasons", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const crumbs = inspector(page).getByRole("navigation", { name: "Task location" });
      await expect(crumbs.getByRole("link", { name: "Fixture: Worker recovery" })).toBeVisible();
      const deps = section(page, "Dependencies and hierarchy");
      await deps.scrollIntoViewIfNeeded();
      await expect(deps.getByRole("listitem").filter({ hasText: "Fixtures precede replay" })).toContainText("Completed · Satisfied");
      await crumbs.getByRole("link", { name: "Fixture: Worker recovery" }).click();
      await expect(page).toHaveURL(new RegExp(`/work/${parent}`));
      await expect(section(page, "Dependencies and hierarchy").locator("[data-child-counts]")).toHaveText("9 descendants: 4 active, 2 draft, 2 completed, 1 canceled");
      await axe(page);
    });

    test("the task's results are listed and link to Results", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const results = section(page, "Results");
      const link = results.getByRole("link", { name: /Replay reconciliation now merges/ });
      await expect(link).toBeVisible();
      await expect(results.getByRole("link", { name: "All results for this task" })).toHaveAttribute("href", new RegExp(`task=${replay}`));
      await link.click();
      await expect(page).toHaveURL(/\/results\/[0-9a-f-]{36}\/revisions\//);
      await expect(page.getByText(/Replay reconciliation now merges/).first()).toBeVisible();
    });

    test("labels show and Reprioritize confirms the new priority", async ({ page }) => {
      await confirmActions(page);
      await page.goto(`/work/${replay}?${scope}`);
      await inspector(page).getByRole("button", { name: actionsMenu }).click();
      await page.getByRole("menuitem", { name: "Reprioritize" }).click();
      const dialog = page.getByRole("dialog", { name: "Reprioritize" });
      await dialog.getByLabel("Priority").fill("25");
      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog.getByText("Priority set to 25", { exact: true })).toBeVisible();
      const posts = await page.evaluate(() => (window as unknown as { __posts: { kind: string; payload: Record<string, unknown> }[] }).__posts);
      expect(posts).toEqual([expect.objectContaining({ kind: "task.reprioritize", payload: expect.objectContaining({ priority: 25, expected_version: "1", project_id: project }) })]);
    });

    test("one task view: no Open full task, sections fold and are remembered, header stays visible", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await expect(inspector(page).getByRole("link", { name: "Open full task" })).toHaveCount(0);
      const results = section(page, "Results").getByRole("button", { name: "Results", exact: true });
      await results.click();
      await expect(results).toHaveAttribute("aria-expanded", "false");
      await page.reload();
      await expect(section(page, "Results").getByRole("button", { name: "Results", exact: true })).toHaveAttribute("aria-expanded", "false");
      // Sticky header: scrolled to the bottom, the title and actions remain on screen. The section reads settle first,
      // so nothing loading above History moves it out of view after the scroll.
      await expect(section(page, "Comments").getByRole("list", { name: "Comments" })).toBeVisible();
      await expect(section(page, "Attempts").locator("[data-attempt-times]")).toHaveCount(2);
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(400);
      await expect(section(page, "History").getByRole("button", { name: "History", exact: true })).toBeInViewport();
      const header = inspector(page).locator("[data-inspector-header]");
      await expect(header.getByRole("heading", { level: 2, name: "Fixture: Replay reconciliation" })).toBeInViewport();
      await expect(header.getByRole("button", { name: actionsMenu })).toBeInViewport();
      if (evidence) await page.screenshot({ path: `${evidence}/p1-sticky-${vp.name}.png` });
      await noHorizontalScroll(page);
      await axe(page);
    });

    if (desktop) {
      test("Expand gives the inspector the full width and survives a reload; Esc restores", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        const before = (await inspector(page).boundingBox())!.width;
        await inspector(page).getByRole("button", { name: "Expand" }).click();
        await expect(page).toHaveURL(/focus=1/);
        await expect(page.getByRole("list", { name: "Tasks" })).toBeHidden();
        const after = (await inspector(page).boundingBox())!.width;
        expect(after).toBeGreaterThan(before * 1.4);
        await page.reload();
        await expect(inspector(page).getByRole("button", { name: "Collapse" })).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("list", { name: "Tasks" })).toBeHidden();
        if (evidence) await page.screenshot({ path: `${evidence}/p1-expanded-${vp.name}.png` });
        await page.locator("body").press("Escape");
        await expect(page).not.toHaveURL(/focus=1/);
        await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
      });

      test("graph view flips to 40 / 60 when a task is selected", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}&view=graph&root=${replay}`);
        await expect(inspector(page)).toBeVisible();
        const graph = (await page.getByRole("region", { name: "Dependency graph" }).boundingBox())!.width, panel = (await inspector(page).boundingBox())!.width;
        expect(panel).toBeGreaterThan(graph);
      });

      test("header, status and the start of the content fit the first screen at 1440x900", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        await expect(section(page, "Status").getByRole("link", { name: "Open terminal" })).toBeInViewport();
        if (evidence) await page.screenshot({ path: `${evidence}/p1-inspector-${vp.name}.png` });
        // The most-used parts (spec 0004 §3): header, status and the comment thread's start.
        await expect(section(page, "Comments").getByRole("button", { name: "Comments", exact: true })).toBeInViewport();
      });
    } else {
      test("phone: the inspector is the page, with Back; Expand doesn't apply", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        await expect(inspector(page).getByRole("link", { name: "All tasks" })).toBeVisible();
        await expect(inspector(page).getByRole("button", { name: "Expand" })).toBeHidden();
        await expect(page.getByRole("list", { name: "Tasks" })).toBeHidden();
        if (evidence) await page.screenshot({ path: `${evidence}/p1-inspector-${vp.name}.png`, fullPage: true });
        await noHorizontalScroll(page);
      });
    }

    test("comments: an agent's finding shows with its session; the owner adds, edits and deletes", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const comments = section(page, "Comments");
      const thread = comments.getByRole("list", { name: "Comments" });
      const entries = thread.locator(":scope > li");
      await expect(entries).toHaveCount(5);
      const finding = entries.filter({ hasText: "Fixture finding: the replay drops duplicate ledger entries." });
      await expect(finding.getByRole("link", { name: /session 00000000/ })).toHaveAttribute("href", new RegExp(`/agents/${id(0x306)}`));
      await expect(entries.nth(2)).toContainText("Comment deleted");
      await comments.getByLabel("Add a comment").fill("Fixture: owner note from the **phone** check");
      await comments.getByRole("button", { name: "Comment", exact: true }).click();
      await expect(entries.first()).toContainText("Fixture: owner note from the phone check");
      await expect(entries.first().locator("strong", { hasText: "phone" })).toBeVisible();
      await entries.first().getByRole("button", { name: /^Edit/ }).click();
      await entries.first().getByLabel("Edit comment").fill("Fixture: owner note, edited");
      await entries.first().getByRole("button", { name: "Save" }).click();
      await expect(entries.first()).toContainText("Fixture: owner note, edited");
      await expect(entries.first()).toContainText("edited");
      if (evidence) await comments.screenshot({ path: `${evidence}/p1-comments-${vp.name}.png` });
      await entries.first().getByRole("button", { name: /^Delete/ }).click();
      await entries.first().getByRole("button", { name: "Delete comment" }).click();
      await expect(entries.first()).toContainText("Comment deleted");
      await axe(page);
    });

    test("comments: the thread pages back past 50", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      const comments = section(page, "Comments");
      const entries = comments.getByRole("list", { name: "Comments" }).locator(":scope > li");
      await expect(comments.getByRole("button", { name: "Comments", exact: true })).toBeVisible();
      await expect(comments.getByText("50+")).toBeVisible();
      await comments.getByRole("button", { name: "Show all 50 loaded comments" }).click();
      await expect(entries).toHaveCount(50);
      await comments.getByRole("button", { name: "Load older comments" }).click();
      await expect(entries).toHaveCount(57);
      await expect(entries.last()).toContainText("Fixture progress note 1.");
      await expect(comments.getByRole("button", { name: "Load older comments" })).toHaveCount(0);
    });

    test("task list: one line per task, status icon coloured and shaped, announced, denser", async ({ page }) => {
      await page.goto(`/work?${scope}`);
      const rows = page.getByRole("list", { name: "Tasks" }).getByRole("link");
      await expect(rows).toHaveCount(10);
      for (const text of await rows.allTextContents()) expect(text).not.toMatch(/Active|Completed|Draft|Canceled| · r\d/);
      const running = rows.filter({ hasText: "Fixture: Replay reconciliation" });
      await expect(running.getByRole("img", { name: "Running" })).toHaveAttribute("title", "Running");
      // Shape and colour differ by status.
      const look = (name: string) => rows.getByRole("img", { name }).first().evaluate((el) => ({ color: getComputedStyle(el).color, shape: el.querySelector("svg")!.getAttribute("class") }));
      const [r, c, d, x] = await Promise.all(["Running", "Complete", "Draft", "Canceled"].map(look));
      expect(new Set([r!.color, c!.color, d!.color, x!.color]).size).toBe(4);
      expect(new Set([r!.shape, c!.shape, d!.shape, x!.shape]).size).toBe(4);
      const heights = await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) desktop ? expect(h).toBeLessThanOrEqual(40) : expect(h).toBeGreaterThanOrEqual(44);
      // Single line: the title never wraps.
      const title = await rows.first().locator("span").last().evaluate((el) => ({ wrap: getComputedStyle(el).whiteSpace, overflow: getComputedStyle(el).textOverflow }));
      expect(title).toEqual({ wrap: "nowrap", overflow: "ellipsis" });
      if (evidence) await page.screenshot({ path: `${evidence}/p1-list-${vp.name}.png` });
      await noHorizontalScroll(page);
      await axe(page);
    });
  });
}
