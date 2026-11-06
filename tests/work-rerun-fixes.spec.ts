import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * QA 2026-11-06 re-run fixes on Work (WDR-01, WDR-02, WDR-03, WDR-05, WD-11) in mock mode.
 *
 * Writes and failure responses the mock doesn't serve are overlaid in this test only: MSW answers from a
 * service worker that `page.route` cannot reach, so a page-level fetch wrapper rewrites them (as in
 * decision-evidence.spec.ts). Fixture tasks: 0x104 "Approve recovery plan" is active, never had an attempt and is
 * blocked by 0x102 "Define lease contract"; 0x101 "Worker recovery" is active with an ended attempt.
 */
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const inspector = (page: Page) => page.locator("[data-task-inspector]");
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
type Posted = { kind: string; payload: Record<string, unknown> };
const posted = (page: Page) => page.evaluate(() => (window as unknown as { __posts: Posted[] }).__posts);

/** Overlay `/api/v1/actions`: each POST answers with the next disposition (or HTTP error), recorded in `window.__posts`. */
async function actions(page: Page, answers: ({ disposition: string; current?: Record<string, string> } | { status: number; code: string; message: string })[], tab2?: { task: string; body: string }) {
  await page.addInitScript(({ answers, project, tab2 }) => {
    const original = window.fetch.bind(window);
    const w = window as unknown as { __posts: unknown[] }; w.__posts = [];
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === "/api/v1/actions" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { operation_id: string; kind: string; subject: unknown; payload: unknown };
        w.__posts.push({ kind: body.kind, payload: body.payload });
        const answer = answers[Math.min(w.__posts.length, answers.length) - 1]!;
        if ("status" in answer) return json({ request_id: "overlay", code: answer.code, message: answer.message, retryable: false }, answer.status);
        const now = new Date().toISOString(), confirmed = answer.disposition === "confirmed";
        return json({ api_version: "dashboard-actions-1", request_id: "overlay", data: {
          operation_id: body.operation_id, disposition: answer.disposition, request_digest: `sha256:${"0".repeat(64)}`,
          scope: { kind: "project", project_id: project }, created_at: now, updated_at: now, subject_refs: [body.subject],
          receipt_refs: confirmed ? [{ type: "graph_change_set", id: body.operation_id }] : [], affected_entities: [],
          ...(answer.current ? { current_versions: answer.current } : {}), recovery: confirmed ? "none" : "refresh_and_review" } });
      }
      // Tab 2's confirmed edit: once tab 1 has submitted, the task read returns the newer version.
      if (tab2 && url.pathname === `/api/human/projects/${project}/tasks/${tab2.task}` && w.__posts.length > 0) {
        const source = await (await original(input, init)).json();
        return json({ ...source, data: { ...source.data, body: tab2.body, version: String(BigInt(source.data.version) + 1n) } });
      }
      return original(input, init);
    };
  }, { answers, project, tab2 });
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("WDR-01: reloading after a conflict keeps the other tab's edit and resubmits only this tab's change", async ({ page }) => {
    const tab2Body = "Mock-mode fixture mirroring design reference 02 (Work explorer). Not live AQ data.\n\nEdited in tab 2.";
    await actions(page, [{ disposition: "conflict", current: { task: "2" } }, { disposition: "confirmed" }], { task: id(0x104), body: tab2Body });
    await page.goto(`/work/${id(0x104)}?${scope}`);
    await inspector(page).getByRole("button", { name: "Edit task" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit task" });
    await dialog.getByLabel("Acceptance criteria").fill("Tab 1 acceptance.");
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Conflict — your draft is preserved.");
    await dialog.getByRole("button", { name: "Reload current versions" }).click();
    await expect(dialog.getByLabel("Description")).toHaveValue(tab2Body);
    await expect(dialog.getByLabel("Acceptance criteria")).toHaveValue("Tab 1 acceptance.");
    await expect(dialog.getByRole("region", { name: "Reloaded record" })).toContainText("Updated from AQ: Description. Your own edits are kept.");
    await axe(page);
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect(dialog.getByRole("status")).toHaveText("Action confirmed");
    const [, resubmitted] = await posted(page);
    expect(resubmitted!.payload).toMatchObject({ body: tab2Body, acceptance_criteria: "Tab 1 acceptance." });
  });

  test("WDR-03: Create counts title bytes, and a 400 on submit is a refusal with the draft editable", async ({ page }) => {
    await page.addInitScript(({ project }) => {
      const original = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
        if (url.pathname === `/api/human/projects/${project}/tasks` && init?.method === "POST")
          return new Response(JSON.stringify({ error: "bad_request", message: "invalid bounded human Graph read" }), { status: 400, headers: { "content-type": "application/json" } });
        return original(input, init);
      };
    }, { project });
    await page.goto(`/work?${scope}`);
    await page.getByRole("button", { name: "Create task" }).click();
    const dialog = page.getByRole("dialog", { name: "Create task" });
    const title = dialog.getByRole("textbox", { name: "Title" });
    // 298 characters, 548 UTF-8 bytes.
    await title.fill("QA 2026-11-06 rerun work-decisions: bytes probe " + "é".repeat(250));
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Title is too long. Use at most 512 bytes; accented letters and emoji count as 2 to 4.");
    await title.fill("Ré-essai accentué");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog.getByRole("alert")).toContainText("AQ refused this task as invalid; no task was created.");
    await expect(dialog.getByText("Task creation outcome is uncertain.")).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Retry exact submission" })).toHaveCount(0);
    await expect(title).toBeEditable();
    await expect(title).toHaveValue("Ré-essai accentué");
    await expect(page).not.toHaveURL(/operation=/);
  });

  test("WDR-05: a nonexistent blocker is named as such, and existing blockers aren't offered", async ({ page }) => {
    await actions(page, [{ status: 404, code: "not_found", message: "Resource not found" }]);
    await page.goto(`/work/${id(0x104)}?${scope}`);
    await expect(inspector(page).getByText("No agent attempt holds this task.")).toBeVisible();
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Add dependency/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add dependency" });
    await dialog.getByLabel("Blocker task").fill("lease contract");
    const choices = dialog.getByRole("group", { name: "Matching tasks" });
    await expect(choices.getByRole("radio", { name: /Fixture: Define lease contract/ })).toBeDisabled();
    await expect(choices).toContainText("already blocks this task");
    await dialog.getByLabel("Blocker task").fill("e0a20000-0000-4000-8000-00000000beef");
    await dialog.getByRole("button", { name: "Submit" }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/^The blocker task doesn't exist or isn't available to you\./);
    await expect(dialog.getByRole("status")).toHaveText("Rejected — AQ refused this action.");
    await expect(dialog.getByText(/cycle|repeat/)).toHaveCount(0);
    await axe(page);
  });

  test("WD-11: Retry attempt is disabled with a reason on a task that never had an attempt", async ({ page }) => {
    await page.goto(`/work/${id(0x104)}?${scope}`);
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    const retry = page.getByRole("menuitem", { name: /Retry attempt/ });
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await expect(retry).toContainText("This task has never had an agent attempt to retry");
    await page.keyboard.press("Escape");
    // A task whose earlier attempt ended can be retried.
    await page.goto(`/work/${id(0x101)}?${scope}`);
    await expect(inspector(page).getByText("No agent attempt holds this task.")).toBeVisible();
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: /Retry attempt/ })).not.toHaveAttribute("aria-disabled", "true");
  });

  test("WDR-02: a transient 503 on the bootstrap re-check after a 403 is retried, so the app stays", async ({ page }) => {
    const review = "e0a20000-0000-4000-8000-00000000beef";
    await page.addInitScript(({ review }) => {
      const original = window.fetch.bind(window);
      const w = window as unknown as { __bootstraps: number }; w.__bootstraps = 0; let refused = false;
      const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
      window.fetch = async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
        if (url.pathname === `/api/reviews/decisions/${review}`) refused = true;
        if (url.pathname === `/api/reviews/decisions/${review}`) return json({ request_id: "overlay", code: "forbidden", message: "Not available", retryable: false }, 403);
        // The first re-check after the 403 meets a retryable 503 (the read burst in the QA report).
        if (url.pathname === "/api/v1/bootstrap" && refused && ++w.__bootstraps === 1)
          return json({ request_id: "overlay", code: "unavailable", message: "This request is temporarily unavailable", retryable: true }, 503);
        return original(input, init);
      };
    }, { review });
    await page.goto(`/decisions/${review}`);
    await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __bootstraps: number }).__bootstraps)).toBeGreaterThanOrEqual(2);
    await expect(page.getByRole("heading", { name: "Access not confirmed" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Decisions", level: 1 })).toBeVisible();
  });
});
