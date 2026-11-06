import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// QA 2026-11-06 fixes on Work and Decisions (WD-01, WD-02, WD-03, WD-09, WD-11, WD-13) against the labelled
// human-graph fixture (src/mocks/humanGraph.ts): 0x104 "Approve recovery plan" is active with no attempt,
// 0x105 "Replay reconciliation" is held by a running attempt, 0x102 "Define lease contract" is completed.
const project = "00000000-0000-0000-0000-000000000001", scope = `scope=project:${project}`;
const id = (n: number) => `00000000-0000-0000-0000-${n.toString(16).padStart(12, "0")}`;
const inspector = (page: Page) => page.locator("[data-task-inspector]");
async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

test.describe("desktop", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("WD-01: List drops the graph root and Graph re-roots on the selected task", async ({ page }) => {
    await page.goto(`/work/${id(0x104)}?${scope}&view=graph&root=${id(0x104)}`);
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page).not.toHaveURL(/root=/);
    await page.getByRole("list", { name: "Tasks" }).getByRole("link", { name: /Fixture: Replay reconciliation/ }).click();
    await expect(inspector(page).getByRole("heading", { name: "Fixture: Replay reconciliation" })).toBeVisible();
    await page.getByRole("button", { name: "Graph", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`root=${id(0x105)}`));
    await expect(page.getByRole("region", { name: "Scrollable task graph" }).getByRole("link", { name: /Fixture: Replay reconciliation/ })).toBeVisible();
  });

  test("WD-02/WD-09: the inspector shows a copyable task ID and no Open full task link", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto(`/work/${id(0x104)}?${scope}`);
    const panel = inspector(page);
    await expect(panel.getByText(id(0x104), { exact: true })).toBeVisible();
    await expect(panel.getByRole("link", { name: "Open full task" })).toHaveCount(0);
    await panel.getByRole("button", { name: "Copy task ID" }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(id(0x104));
    await axe(page);
  });

  test("WD-09: Add dependency finds the blocker by title", async ({ page }) => {
    await page.goto(`/work/${id(0x104)}?${scope}`);
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: /Add dependency/ }).click();
    const dialog = page.getByRole("dialog", { name: "Add dependency" });
    await dialog.getByLabel("Blocker task").fill("recovery test");
    const choices = dialog.getByRole("group", { name: "Matching tasks" });
    await expect(choices.getByRole("radio", { name: /Fixture: Recovery test fixtures/ })).toBeVisible();
    // The task itself is never offered as its own blocker.
    await dialog.getByLabel("Blocker task").fill("approve recovery");
    await expect(dialog.getByText(/No other tasks match/)).toBeVisible();
    await axe(page);
  });

  test("WD-11: Cancel and Retry name the attempt and explain when they can't act", async ({ page }) => {
    await page.goto(`/work/${id(0x104)}?${scope}`);
    await expect(inspector(page).getByText("No agent attempt holds this task.")).toBeVisible();
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    const cancel = page.getByRole("menuitem", { name: /Cancel attempt/ });
    await expect(cancel).toHaveAttribute("aria-disabled", "true");
    await expect(cancel).toContainText("No agent attempt holds this task");
    // 0x104 never had an attempt, so there is nothing to retry (WD-11 remainder, work-rerun-fixes.spec.ts).
    await expect(page.getByRole("menuitem", { name: /Retry attempt/ })).toContainText("This task has never had an agent attempt to retry");
    await page.keyboard.press("Escape");

    await page.goto(`/work/${id(0x105)}?${scope}`);
    await expect(inspector(page).getByRole("link", { name: "Open session" })).toBeVisible();
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: /Cancel attempt/ })).not.toHaveAttribute("aria-disabled", "true");

    await page.goto(`/work/${id(0x102)}?${scope}`);
    await inspector(page).getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: /Retry attempt/ })).toContainText("AQ retries attempts of active tasks only");
    await expect(page.getByRole("menuitem", { name: /Cancel attempt/ })).toContainText("No agent attempt can hold a completed task");
  });

  test("WD-03: Create task limits the title to 512 and a blank title says it is required", async ({ page }) => {
    await page.goto(`/work?${scope}`);
    await page.getByRole("button", { name: "Create task" }).click();
    const dialog = page.getByRole("dialog", { name: "Create task" });
    const title = dialog.getByRole("textbox", { name: "Title" });
    await expect(title).toHaveAttribute("maxlength", "512");
    await title.fill("   ");
    await dialog.getByRole("button", { name: "Create task" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Title is required.");
  });

  test("WD-13: a malformed decision link is a neutral not-found without Try again", async ({ page }) => {
    for (const path of ["/decisions/not-a-uuid", "/decisions/not-a-uuid?kind=question"]) {
      await page.goto(path);
      await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toHaveCount(0);
      // The page and its inbox stay; only the evidence pane is neutral.
      await expect(page.getByRole("heading", { name: "Decisions", level: 1 })).toBeVisible();
    }
  });
});
