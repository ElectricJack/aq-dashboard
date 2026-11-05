import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// G9 (reference 06-playbooks.png): start, cancel and activation controls on labelled mock-mode fixtures.
const evidence = "docs/implementation/evidence/G9";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

async function expectClean(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("start run offers typed inputs from the current binding", async ({ page }) => {
      await page.goto("/playbooks");
      const roster = page.getByRole("region", { name: "Recent runs" });
      const start = roster.getByRole("button", { name: "Start run" });
      await expect(start).toBeEnabled({ timeout: 30_000 });
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/runs-start-${vp.name}.png` });
      await start.click();
      const dialog = page.getByRole("dialog", { name: "Start run" });
      await expect(dialog.getByRole("combobox", { name: "Binding" })).toHaveValue("worker-recovery");
      await dialog.getByRole("button", { name: "Add input" }).click();
      await dialog.getByRole("textbox", { name: "Input 1 name" }).fill("revision");
      await dialog.getByRole("combobox", { name: "Input 1 type" }).selectOption("number");
      await dialog.getByRole("textbox", { name: "Input 1 value" }).fill("3");
      await expect(dialog.locator("textarea")).toHaveCount(0);
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/start-dialog-${vp.name}.png` });
    });

    test("cancel requests an intent and the run keeps its server state", async ({ page }) => {
      await page.goto(`/playbooks/runs/${waiting}`);
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      const cancel = inspector.getByRole("button", { name: "Cancel run" });
      await expect(cancel).toBeEnabled({ timeout: 30_000 });
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/run-cancel-control-${vp.name}.png` });
      await cancel.click();
      const dialog = page.getByRole("dialog", { name: "Cancel run" });
      await dialog.getByRole("textbox", { name: "Reason" }).fill("Fixture: superseded by a newer revision");
      await dialog.getByRole("checkbox", { name: /Confirm cancellation request/ }).check();
      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog.getByRole("status")).toHaveText("Cancellation requested", { timeout: 15_000 });
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/cancel-requested-${vp.name}.png` });
      await dialog.getByRole("button", { name: "Close action" }).click();
      // Pending-safe: the badge is still the server's state, not "Cancelled".
      await expect(inspector.getByText(/^Waiting/).first()).toBeVisible();
      await expect(inspector.getByText(/^Cancelled$/)).toHaveCount(0);
    });

    test("activation detail separates activate and rollback for new runs", async ({ page }) => {
      await page.goto("/playbooks?view=activations");
      await page.getByRole("list", { name: "Current playbook activations" }).getByRole("button").first().click();
      const panel = page.getByRole("region", { name: "Activation for new runs" });
      await expect(panel.getByText(/Activation affects future runs only/).first()).toBeVisible({ timeout: 30_000 });
      // The fixture catalog has one definition, so activation has nothing else to bind.
      await expect(panel.getByRole("button", { name: "Activate definition" })).toBeDisabled();
      await expect(panel.getByText("No other definition is represented in this namespace")).toBeVisible();
      await panel.scrollIntoViewIfNeeded();
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/activation-${vp.name}.png`, fullPage: true });
      await panel.getByRole("button", { name: "Roll back activation" }).click();
      const dialog = page.getByRole("dialog", { name: "Roll back activation" });
      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Confirm this action before submitting.");
      await dialog.getByRole("checkbox", { name: "Confirm rollback for new runs." }).check();
      await dialog.getByRole("button", { name: "Submit" }).click();
      await expect(dialog.getByRole("status")).toHaveText("Rollback confirmed for new runs", { timeout: 15_000 });
      await expectClean(page);
      await page.screenshot({ path: `${evidence}/rollback-confirmed-${vp.name}.png` });
    });
  });
}
