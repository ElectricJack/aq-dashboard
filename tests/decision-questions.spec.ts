import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** F5: labelled agent-question fixtures (`?scenario=questions`, src/mocks/questions.ts) in the
 * decision inbox, the question page and its `question.answer` bar, on desktop and phone. */
const EVIDENCE = process.env.F5_EVIDENCE_DIR;
const QUESTION = "00000000-0000-4000-8000-000000002561";

test.describe("desktop-1440", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("questions sit in the inbox and an answer is recorded, then refreshed", async ({ page }) => {
    await page.goto("/decisions?scenario=questions");
    const questions = page.getByRole("list", { name: "Agent questions" });
    await expect(questions.getByRole("listitem")).toHaveCount(2);
    const row = questions.locator(`a[href*="/decisions/${QUESTION}"]`);
    await expect(row).toContainText("Fixture: Replay reconciliation");
    await expect(row).toContainText("· Question");
    await expect(row).toContainText(/Expires in \d+h/);
    await expect(page.getByRole("list", { name: "Review inbox" }).getByRole("listitem")).toHaveCount(3);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/questions-inbox-desktop-1440.png` });

    await row.click();
    await expect(page).toHaveURL(new RegExp(`/decisions/${QUESTION}\\?.*kind=question`));
    await expect(row).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-question-text]")).toContainText("two events with the same sequence number");
    await expect(page.getByRole("region", { name: "Question context" })).toContainText("Fixture: Replay reconciliation");
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/questions-detail-desktop-1440.png` });

    await page.getByRole("textbox", { name: "Answer" }).fill("Fixture answer: stop and report the conflict.");
    await page.getByRole("button", { name: "Send answer" }).click();
    await expect(page.locator("[data-question-answer]")).toHaveText("Fixture answer: stop and report the conflict.");
    await expect(page.getByText("Delivered to the waiting agent.")).toBeVisible();
    await expect(questions.getByRole("listitem")).toHaveCount(1);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/questions-answered-desktop-1440.png` });
  });
});

test.describe("phone-390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("the question link opens the question with a way back and an answer bar", async ({ page }) => {
    await page.goto(`/decisions/${QUESTION}?scenario=questions&kind=question`);
    await expect(page.locator("[data-question-text]")).toBeVisible();
    await expect(page.getByRole("list", { name: "Agent questions" })).not.toBeVisible();
    await expect(page.getByRole("link", { name: "All decisions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Send answer" })).toBeAttached();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
    if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/questions-detail-phone-390.png`, fullPage: true });
  });
});
