import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// RS-J (calm-vault-46.13): the feedback draft keeps Cancel and its primary action
// in a sticky footer, and "Existing task ID" is a searchable picker that still
// accepts a pasted id. Uses the labelled Results fixtures in `vite --mode mock`.
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];
const SHOTS = process.env.FIXTURE_SHOTS;
const PASTED = "00000000-0000-4000-8000-000000000070";

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function inViewport(page: Page, target: Locator) {
  const box = await target.boundingBox(), vp = page.viewportSize()!;
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
}
async function openDraft(page: Page) {
  await page.goto("/results");
  // RS-H / reference 10: the card has no feedback button; the entry is the per-comment
  // "Create feedback task" in the discussion (side pane on desktop, comments sheet on phone).
  const feed = page.getByRole("list", { name: "Results feed" });
  await feed.getByRole("article", { name: /^Result / }).first().getByRole("button", { name: /^Comments/ }).click();
  const discussion = page.getByRole("complementary", { name: "Discussion" }).or(page.getByRole("dialog", { name: "Result comments" })).first();
  await discussion.getByRole("button", { name: "Create feedback task" }).first().click();
  const draft = page.getByRole("dialog", { name: "Create feedback task" });
  await expect(draft).toBeVisible();
  return draft;
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("feedback draft keeps Cancel and the primary action visible without scrolling", async ({ page }) => {
      const draft = await openDraft(page);
      const primary = draft.getByRole("button", { name: "Create linked task" });
      const cancel = draft.getByRole("button", { name: "Cancel" });
      await inViewport(page, primary);
      await inViewport(page, cancel);
      // Cancel precedes the primary action in the footer.
      expect((await cancel.boundingBox())!.x).toBeLessThan((await primary.boundingBox())!.x);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-feedback-draft-${vp.name}.png` });
      // The body scrolls; the footer stays put.
      await draft.getByText("Exact pins").scrollIntoViewIfNeeded();
      await inViewport(page, primary);
      await axe(page);
      await cancel.click();
      await expect(draft).toBeHidden();
    });

    test("link mode offers a searchable task picker that accepts a pasted id", async ({ page }) => {
      const draft = await openDraft(page);
      await draft.getByLabel("Action").selectOption("link");
      const picker = draft.getByRole("combobox", { name: "Existing task ID" });
      await expect(picker).toBeVisible();
      await picker.fill("caption");
      await expect(draft.getByText(/Search by title or paste a task ID/)).toBeVisible();
      // Fixture project has no task search here; the picker says so concisely and stays usable.
      await expect(draft.getByText(/Task search unavailable|No matching tasks|Searching tasks/)).toBeVisible();
      await picker.press("Escape");
      await expect(draft).toBeVisible();
      await picker.fill(PASTED);
      await expect(picker).toHaveValue(PASTED);
      const primary = draft.getByRole("button", { name: "Link existing task" });
      await expect(primary).toBeEnabled();
      await inViewport(page, primary);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/results-feedback-link-${vp.name}.png` });
      await axe(page);
    });
  });
}
