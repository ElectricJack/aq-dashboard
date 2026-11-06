import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * Phase 1 task-view QA findings (qa/2026-11-06/parity-p1/issues.md, P1-01…P1-12, client side) at 1440x900 and
 * 390x844, against the labelled mock fixtures (src/mocks/humanGraph.ts). "Replay reconciliation" (0x105) holds a
 * running attempt and has 57 comments; "Approve recovery plan" (0x104) has one owner comment.
 */
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const replay = id(0x105), approve = id(0x104);
const evidence = process.env.EVIDENCE_DIR;
const inspector = (page: Page) => page.locator("[data-task-inspector]");
const section = (page: Page, name: string) => inspector(page).locator("section[data-section]").filter({ has: page.getByRole("button", { name, exact: true }) });
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
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
/** Replay's holding attempt (0x301) has finished, in every read that reports it (P1-01). */
const FINISHED = [
  { path: `/tasks/${replay}/work`, fn: `json.data.execution.status = "finished";` },
  { path: `/tasks/${replay}/history`, fn: `for (const a of json.data.attempts) if (a.holds_task) a.status = "finished";` },
  { path: `/projects/${project}/tasks`, fn: `for (const e of json.data.executions ?? []) e.status = "finished";` },
];

/** True when the element's centre is not covered by anything else (WCAG 2.4.11 Focus Not Obscured). */
async function unobscured(target: Locator) {
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === el || el.contains(hit));
  });
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  const desktop = vp.name === "desktop";
  const actionsMenu = desktop ? "More actions" : "Task actions";
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("P1-01 fallback (server without held): a task held by a finished attempt never reads Running, in the list or the inspector", async ({ page }) => {
      await rewrite(page, FINISHED);
      await page.goto(`/work/${replay}?${scope}`);
      const badge = inspector(page).locator("[data-task-status]");
      await expect(badge).toHaveText(/Held by a finished attempt/);
      await expect(badge).not.toHaveText(/Running/);
      await expect(badge).toHaveAttribute("data-readiness", "running");
      const status = section(page, "Status");
      await expect(status.getByText(/AQ reports this task as running because the attempt below still holds it/)).toBeVisible();
      await expect(status.getByRole("link", { name: "Open session" })).toBeVisible();
      await expect(status.getByRole("link", { name: "Open terminal" })).toHaveCount(0);
      if (desktop) {
        const row = page.getByRole("list", { name: "Tasks" }).getByRole("link").filter({ hasText: "Fixture: Replay reconciliation" });
        await expect(row.getByRole("img", { name: "Held" })).toBeVisible();
        await expect(row.getByRole("img", { name: "Running" })).toHaveCount(0);
      }
      if (evidence) await page.screenshot({ path: `${evidence}/p1fix-01-held-${vp.name}.png` });
    });

    test("P1-11: closing Reprioritize returns focus to the action menu", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await inspector(page).getByRole("button", { name: actionsMenu }).click();
      await page.getByRole("menuitem", { name: "Reprioritize" }).click();
      const dialog = page.getByRole("dialog", { name: "Reprioritize" });
      await dialog.getByRole("button", { name: "Close action" }).click();
      await expect(dialog).toBeHidden();
      await expect(inspector(page).getByRole("button", { name: actionsMenu })).toBeFocused();
      // Esc closes the dialog the same way.
      await inspector(page).getByRole("button", { name: actionsMenu }).click();
      await page.getByRole("menuitem", { name: "Reprioritize" }).click();
      await page.keyboard.press("Escape");
      await expect(inspector(page).getByRole("button", { name: actionsMenu })).toBeFocused();
    });

    test("P1-05, P1-11: a comment renders links and quotes; deleting it moves focus to its placeholder", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const comments = section(page, "Comments");
      const entries = comments.getByRole("list", { name: "Comments" }).locator(":scope > li");
      await expect(entries).toHaveCount(1);
      await comments.getByLabel("Add a comment").fill("See [the run](https://example.com/run) and https://example.org/raw_link.\n\n> quoted finding\n\n<script>window.__xss = 1</script>");
      await comments.getByRole("button", { name: "Comment", exact: true }).click();
      const posted = entries.first();
      await expect(posted.getByRole("link", { name: "the run" })).toHaveAttribute("href", "https://example.com/run");
      const bare = posted.getByRole("link", { name: "https://example.org/raw_link" });
      await expect(bare).toHaveAttribute("target", "_blank");
      await expect(bare).toHaveAttribute("rel", "noopener noreferrer");
      await expect(posted.locator("blockquote")).toHaveText("quoted finding");
      await expect(posted).toContainText("<script>window.__xss = 1</script>");
      expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
      if (evidence) await comments.screenshot({ path: `${evidence}/p1fix-05-markdown-${vp.name}.png` });
      await posted.getByRole("button", { name: /^Delete/ }).click();
      await posted.getByRole("button", { name: "Delete comment" }).click();
      await expect(posted).toContainText("Comment deleted");
      await expect(posted).toBeFocused();
      await axe(page);
    });

    test("P1-06: after an edit conflict the other version is shown and Save waits for a choice", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const comments = section(page, "Comments");
      const item = comments.getByRole("list", { name: "Comments" }).locator(":scope > li").first();
      await item.getByRole("button", { name: /^Edit/ }).click();
      // Another tab edits the same comment at revision 1.
      const outOfBand = await page.evaluate(async ({ project, comment }) => {
        const operation = crypto.randomUUID();
        const r = await fetch("/api/v1/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation_id: operation, kind: "task.comment.edit",
          subject: { type: "task_comment", id: comment, revision: "1" }, expected_versions: { task_comment: "1" }, payload: { operation_id: operation, project_id: project, expected_revision: "1", body: "v2, edited out-of-band" } }) });
        return ((await r.json()) as { data: { disposition: string } }).data.disposition;
      }, { project, comment: id(0x550) });
      expect(outOfBand).toBe("confirmed");
      await item.getByLabel("Edit comment").fill("my stale draft");
      await item.getByRole("button", { name: "Save" }).click();
      const conflict = item.getByRole("group", { name: "Newer version of this comment" });
      await expect(conflict).toContainText("v2, edited out-of-band");
      await expect(item.getByLabel("Edit comment")).toHaveValue("my stale draft");
      await expect(item.getByRole("button", { name: "Save" })).toBeDisabled();
      if (evidence) await item.screenshot({ path: `${evidence}/p1fix-06-conflict-${vp.name}.png` });
      await conflict.getByRole("button", { name: "Use AQ's version" }).click();
      await expect(item.getByLabel("Edit comment")).toHaveValue("v2, edited out-of-band");
      await item.getByLabel("Edit comment").fill("v3 after reading v2");
      await item.getByRole("button", { name: "Save" }).click();
      await expect(item).toContainText("v3 after reading v2");
      await expect(item.getByRole("button", { name: /^Edit/ })).toBeFocused();
    });

    test("P1-04: a focused control is never hidden under the pinned header", async ({ page }) => {
      await page.goto(`/work/${replay}?${scope}`);
      await expect(section(page, "Attempts").getByRole("button", { name: "Copy session ID" }).first()).toBeVisible();
      /** Scroll so the target's centre sits just under the pinned header's bottom edge: on screen, but covered. */
      const underHeader = (target: Locator) => target.evaluate(async (el) => {
        window.scrollTo(0, 0);
        window.scrollBy(0, el.getBoundingClientRect().top - 120);
        await new Promise(requestAnimationFrame);
        const pinned = [...document.querySelectorAll<HTMLElement>("[data-inspector-header],[data-inspector-bar]")].find((e) => getComputedStyle(e).position === "sticky" && getComputedStyle(e).display !== "contents")!;
        const box = el.getBoundingClientRect();
        window.scrollBy(0, box.top + box.height / 2 - (pinned.getBoundingClientRect().bottom - 12));
        await new Promise(requestAnimationFrame);
        (document.activeElement as HTMLElement | null)?.blur();
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!hit?.closest("[data-inspector-header],[data-inspector-bar]");
      });
      const targets = [
        section(page, "Attempts").getByRole("button", { name: "Copy session ID" }).first(),
        section(page, "Comments").getByLabel("Add a comment"),
        section(page, "Comments").getByRole("list", { name: "Comments" }).locator(":scope > li").first().getByRole("button", { name: /^Edit/ }),
      ];
      for (const target of targets) {
        expect(await underHeader(target)).toBe(true);
        await target.focus();
        await expect.poll(() => unobscured(target)).toBe(true);
      }
      // Keyboard: Shift+Tab back onto a control that sits under the header.
      const copy = targets[0]!;
      await underHeader(copy);
      // Focus the control after it without scrolling, then step back with the keyboard.
      await copy.evaluate((el) => el.closest("p")!.querySelector<HTMLElement>("a")!.focus({ preventScroll: true }));
      await page.keyboard.press("Shift+Tab");
      await expect(copy).toBeFocused();
      await expect.poll(() => unobscured(copy)).toBe(true);
      if (evidence) await page.screenshot({ path: `${evidence}/p1fix-04-focus-${vp.name}.png` });
    });

    test("P1-10: a long result summary is clamped to three lines at normal weight", async ({ page }) => {
      const long = `Fixture · Changes: ${Array.from({ length: 40 }, (_, i) => `crates/aq-server/src/file_${i}.rs`).join(",")}`;
      await rewrite(page, [{ path: "/api/v1/results", fn: `for (const d of json.data.items) d.revision.summary = ${JSON.stringify(long)};` }]);
      await page.goto(`/work/${replay}?${scope}`);
      const link = section(page, "Results").getByRole("link", { name: /^Fixture · Changes:/ });
      await expect(link).toBeVisible();
      await link.scrollIntoViewIfNeeded();
      const box = await link.evaluate((el) => ({ height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight), weight: getComputedStyle(el).fontWeight }));
      expect(box.weight).toBe("400");
      expect(box.height).toBeLessThanOrEqual(box.line * 3 + 1);
      await expect(link).toHaveAttribute("title", long);
      if (evidence) await section(page, "Results").screenshot({ path: `${evidence}/p1fix-10-results-${vp.name}.png` });
    });

    if (desktop) {
      test("P1-03: at 1440x900 the comment composer and the latest comment start are on the first screen", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        const comments = section(page, "Comments");
        await expect(comments.getByRole("button", { name: "Comments", exact: true })).toBeInViewport();
        await expect(comments.getByLabel("Add a comment")).toBeInViewport({ ratio: 1 });
        await expect(comments.getByRole("button", { name: "Comment", exact: true })).toBeInViewport({ ratio: 1 });
        await expect(comments.getByRole("list", { name: "Comments" }).locator(":scope > li").first()).toBeInViewport();
        if (evidence) await page.screenshot({ path: `${evidence}/p1fix-03-first-screen-${vp.name}.png` });
      });
    } else {
      test("P1-02: the pinned header is a compact bar; content keeps most of the screen", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        const bar = inspector(page).locator("[data-inspector-bar]");
        await expect(bar.getByRole("heading", { level: 2, name: "Fixture: Replay reconciliation" })).toBeVisible();
        await page.evaluate(() => window.scrollTo(0, 900));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);
        const pinned = (await bar.boundingBox())!;
        expect(pinned.y).toBeLessThanOrEqual(80);
        expect(pinned.height).toBeLessThanOrEqual(120);
        await expect(bar.getByRole("button", { name: "Task actions" })).toBeInViewport();
        await expect(bar.locator("[data-task-status]")).toBeInViewport();
        // Nothing else of the header stays pinned: the ID and labels scroll away with the content.
        await expect(inspector(page).getByRole("button", { name: "Copy task ID" })).not.toBeInViewport();
        // A control in the middle of the screen is tappable, not covered by the header.
        const middle = await page.evaluate(() => { const el = document.elementFromPoint(195, 422); return el?.closest("[data-inspector-bar]") ? "header" : "content"; });
        expect(middle).toBe("content");
        if (evidence) await page.screenshot({ path: `${evidence}/p1fix-02-compact-header-${vp.name}.png` });
        // The menu holds every action, Edit task included.
        await bar.getByRole("button", { name: "Task actions" }).click();
        await expect(page.getByRole("menu", { name: "Task actions" }).getByRole("menuitem", { name: "Edit task" })).toBeVisible();
        await axe(page);
      });

      test("P1-12: copy buttons and comment Edit/Delete are at least 44px to tap", async ({ page }) => {
        await page.goto(`/work/${replay}?${scope}`);
        const sizes = async (targets: Locator) => targets.evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; }));
        await expect(section(page, "Attempts").getByRole("button", { name: "Copy attempt ID" }).first()).toBeVisible();
        const copies = await sizes(inspector(page).getByRole("button", { name: /^Copy / }));
        expect(copies.length).toBeGreaterThan(4);
        for (const [w, h] of copies) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
        const edits = await sizes(section(page, "Comments").getByRole("button", { name: /^(Edit|Delete) comment from/ }));
        expect(edits.length).toBeGreaterThan(0);
        for (const [w, h] of edits) { expect(w).toBeGreaterThanOrEqual(44); expect(h).toBeGreaterThanOrEqual(44); }
      });
    }
  });
}
