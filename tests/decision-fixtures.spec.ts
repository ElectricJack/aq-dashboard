import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** DC-N: labelled mock fixtures for every review decision state (reference 03). Mock mode. */
const EVIDENCE = process.env.DCN_EVIDENCE_DIR;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CURRENT = id(1);
const SUPERSEDED = id(21);

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

async function axeClean(page: Page) {
  const results = await new AxeBuilder({ page }).include("main").analyze();
  expect(results.violations).toEqual([]);
}
// DC-L's inbox column: the "Review inbox" list plus its empty and error states.
const inbox = (page: Page) => page.getByRole("region", { name: "Decision inbox" });
const shot = (page: Page, name: string, vp: string) =>
  EVIDENCE ? page.screenshot({ path: `${EVIDENCE}/${name}-${vp}.png`, fullPage: true }) : Promise.resolve();

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("open inbox lists current, superseded and other-project reviews", async ({ page }) => {
      await page.goto("/decisions?state=open");
      await expect(inbox(page).getByRole("link").first()).toBeVisible();
      expect(await inbox(page).getByRole("link").count()).toBeGreaterThanOrEqual(3);
      await expect(inbox(page).getByText("Newer report exists")).toHaveCount(1);
      await shot(page, "decisions-open", vp.name);
      await axeClean(page);
    });

    test("resolved inbox lists recorded reviews with receipts", async ({ page }) => {
      await page.goto("/decisions?state=closed");
      await expect(inbox(page).getByRole("link").first()).toBeVisible();
      expect(await inbox(page).getByRole("link").count()).toBeGreaterThanOrEqual(1);
      await inbox(page).getByRole("link").first().click();
      await expect(page.getByText(/^Recorded decision: (approve|reject)$/)).toBeVisible();
      await expect(page.getByText(/^Fixture · /)).toBeVisible();
      await shot(page, "decisions-resolved", vp.name);
      await axeClean(page);
    });

    test("superseded review is historical and not answerable", async ({ page }) => {
      await page.goto(`/decisions/${SUPERSEDED}?state=open`);
      await expect(page.getByText("A newer result report exists. This review is historical and can't be answered.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Approve/ })).toHaveCount(0);
      await axeClean(page);
    });

    test("approving the current review records the receipt", async ({ page }) => {
      await page.goto(`/decisions/${CURRENT}?state=open`);
      await expect(page.getByText("Fixture: recovery tests retained")).toBeVisible();
      await shot(page, "decisions-form", vp.name);
      await axeClean(page);
      await page.getByRole("button", { name: "Approve task version 3" }).click();
      await expect(page.getByText("Recorded decision: approve")).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve task version 3" })).toHaveCount(0);
      await shot(page, "decisions-recorded", vp.name);
      await axeClean(page);
      // The answered review leaves Open and appears under Resolved. On phone the
      // detail replaces the inbox (DC-L list-then-detail), so go back to it first.
      const back = page.getByRole("link", { name: "All decisions" });
      if (await back.isVisible()) await back.click();
      await page.getByRole("button", { name: "Resolved" }).click();
      await expect(inbox(page).locator(`a[href^="/decisions/${CURRENT}"]`)).toBeVisible();
    });

    test("decision-conflict scenario refuses the answer and keeps the note", async ({ page }) => {
      await page.goto(`/decisions/${CURRENT}?state=open&scenario=decision-conflict`);
      const note = page.getByRole("textbox", { name: "Decision note" });
      await note.fill("Fixture note");
      await page.getByRole("button", { name: "Approve task version 3" }).click();
      await expect(page.getByText(/^The review changed\. Your note is preserved/)).toBeVisible();
      await expect(note).toHaveValue("Fixture note");
      await axeClean(page);
    });

    test("reads-failed shows the inbox error, not an empty inbox", async ({ page }) => {
      await page.goto("/decisions?state=open&scenario=reads-failed");
      await expect(inbox(page).getByRole("alert")).toContainText("Couldn't load review inbox");
      await expect(page.getByText(/No open reviews/)).toHaveCount(0);
      await shot(page, "decisions-failed", vp.name);
      await axeClean(page);
    });

    test("empty scenario shows the empty inbox", async ({ page }) => {
      await page.goto("/decisions?state=open&scenario=empty");
      await expect(inbox(page).getByText("No open reviews")).toBeVisible();
      await expect(inbox(page).getByRole("link")).toHaveCount(0);
    });
  });
}
