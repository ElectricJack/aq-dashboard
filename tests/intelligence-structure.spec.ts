import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const width of [1440, 390, 320]) {
  test(`the Intelligence tab is usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/settings");
    await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
    const levels = page.getByRole("table", { name: "Levels", exact: true });
    await expect(levels.getByRole("row", { name: "Fixture standard, high" })).toContainText("anthropic · fixture-model-large · high · claude");
    await page.getByRole("button", { name: "Edit Fixture standard, high" }).click();
    const editor = page.getByRole("region", { name: "Edit Fixture standard, high" });
    await expect(editor.getByLabel("Model of candidate 1")).toHaveValue("fixture-model");
    await expect(editor.getByLabel("Markdown")).toHaveValue(/## Candidates/);
    await expect(page.getByRole("region", { name: "Selection defaults" }).getByLabel("Attempts per task")).toHaveValue("2");
    await expect(page.getByRole("region", { name: "Internal work" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
    await expect(page.getByText(/An agent turns each saved version into a playbook/)).toBeVisible();
    await expect(page.getByRole("switch", { name: "Route tasks with this playbook" })).toBeDisabled();
    await expect(page.getByText(/^Active snapshot [0-9a-f]{12} · revision 1$/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
  });
  for (const [tab, table, name] of [["Roles", "Roles", "Fixture developer"], ["Execution", "Execution profiles", "Fixture sandbox"]] as const) {
    test(`the ${tab} tab is usable at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/settings");
      await page.getByRole("tab", { name: tab, exact: true }).click();
      await expect(page.getByRole("table", { name: table, exact: true }).getByRole("row", { name })).toBeVisible();
      await page.getByRole("button", { name: `Edit ${name}` }).click();
      const editor = page.getByRole("region", { name: `Edit ${name}` });
      await expect(editor.getByLabel("Markdown")).toHaveValue(/^---\nid: /);
      await expect(editor.getByRole("heading", { name: /^How AQ reads the saved/ })).toBeVisible();
      // The store's limits open beside the snapshot line, by keyboard.
      const limits = page.getByRole("tabpanel", { name: tab }).locator("summary", { hasText: /^Limits$/ });
      await limits.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("group", { name: "Limits of roles, levels and execution profiles" }).getByLabel("One document (bytes)")).toHaveValue("65536");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(results.violations.map(v => v.id)).toEqual([]);
    });
  }
}

for (const width of [1440, 390, 320]) {
  test(`a level's description and Max agents are edited on the Levels page at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    // `level-limits`: the labelled swarm fixture lists the fixture levels, so their limits can be set.
    await page.goto("/settings?tab=intelligence&scenario=level-limits");
    const levels = page.getByRole("table", { name: "Levels", exact: true });
    await expect(levels.getByRole("columnheader")).toHaveText(["Name", "Description", "Candidates (provider · model · reasoning · harness)", "Max agents", "Actions"]);
    // Low before high.
    await expect(levels.locator("tbody tr")).toHaveCount(2);
    expect(await levels.locator("tbody tr").evaluateAll(rows => rows.map(row => row.getAttribute("data-document-id")))).toEqual(["standard-low", "standard-high"]);
    const limit = page.getByRole("textbox", { name: "Max agents for Fixture standard, low on fixture-provider" });
    await expect(limit).toHaveValue("2");
    await limit.fill("3");
    const save = page.getByRole("button", { name: "Save max agents" });
    await save.scrollIntoViewIfNeeded();
    await save.press("Enter");
    await expect(page.getByText("Max agents saved.")).toBeVisible();
    await expect(limit).toHaveValue("3");
    await page.getByRole("button", { name: "Edit Fixture standard, high" }).click();
    const editor = page.getByRole("region", { name: "Edit Fixture standard, high" });
    const description = editor.getByRole("textbox", { name: "Description" });
    await expect(description).toHaveValue("Labelled fixture level");
    await expect(editor.getByText("The router reads this text when it chooses a level for a task.", { exact: false })).toBeVisible();
    await description.fill("Fixture: work that touches several parts.");
    await expect(editor.getByLabel("Markdown")).toHaveValue(/\ndescription: Fixture: work that touches several parts\.\n/);
    await editor.getByRole("button", { name: "Save level" }).click();
    await expect(editor.getByRole("status")).toHaveText("Saved.");
    await expect(levels.getByRole("row", { name: "Fixture standard, high" })).toContainText("Fixture: work that touches several parts.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Max agents for Fixture standard, low on fixture-provider" })).toHaveValue("3");
  });
}

test("a reordered candidates table is saved and is still in that order after a reload", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByRole("button", { name: "Edit Fixture standard, high" }).click();
  const editor = page.getByRole("region", { name: "Edit Fixture standard, high" });
  await editor.getByRole("button", { name: "Move candidate 2 up" }).click();
  await expect(editor.getByRole("button", { name: "Move candidate 1 down" })).toBeFocused();
  await expect(editor.getByLabel("Markdown")).toHaveValue(/\| anthropic \| fixture-model-large \| high \| claude \|\n\| fixture-provider \| fixture-model \| high \| opencode \|\n$/);
  await editor.getByRole("button", { name: "Save level" }).click();
  await expect(editor.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  const items = page.getByRole("table", { name: "Levels", exact: true }).getByRole("row", { name: "Fixture standard, high" }).getByRole("listitem");
  await expect(items).toHaveText(["anthropic · fixture-model-large · high · claude", "fixture-provider · fixture-model · high · opencode"]);
  await expect(page.getByText(/· revision 2$/)).toBeVisible();
});

test("an invalid role shows the server's problems beside the editor, and a referenced execution profile is not deleted", async ({ page }) => {
  await page.goto("/settings?tab=roles");
  await page.getByRole("button", { name: "Edit Fixture developer" }).click();
  const editor = page.getByRole("region", { name: "Edit Fixture developer" });
  const text = await editor.getByLabel("Markdown").inputValue();
  await editor.getByLabel("Markdown").fill(text.replace("execution: fixture-sandbox", "execution: nowhere"));
  await editor.getByRole("button", { name: "Save role" }).click();
  await expect(editor.getByRole("alert")).toContainText("role `developer`: execution: no execution profile `nowhere` exists");
  await page.getByRole("tab", { name: "Execution", exact: true }).click();
  await page.getByRole("button", { name: "Delete Fixture sandbox" }).click();
  await page.getByRole("button", { name: "Confirm delete Fixture sandbox" }).click();
  await expect(page.getByRole("tabpanel", { name: "Execution" }).getByRole("alert")).toContainText("role `reviewer`: execution: no execution profile `fixture-sandbox` exists");
  await expect(page.getByRole("row", { name: "Fixture sandbox" })).toBeVisible();
});

test("routing markdown persists across reload", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByLabel("Markdown").fill("# Saved routing\n\nUse Standard for ordinary work.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(page.getByLabel("Markdown")).toHaveValue("# Saved routing\n\nUse Standard for ordinary work.");
});

test("a saved document is written into a playbook, shows what it does, and routing can be turned on", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const policy = page.getByRole("region", { name: "Routing policy" });
  const toggle = policy.getByRole("switch", { name: "Route tasks with this playbook" });
  // The first read waits for the mock network and every Settings panel to load.
  await expect(toggle).toBeDisabled({ timeout: 15_000 });
  await policy.getByLabel("Markdown").fill("# Routing\n\nBug fixes are Standard, high effort.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(policy.getByText("Writing the playbook…")).toBeVisible();
  const cases = policy.getByRole("region", { name: "What the playbook does" });
  await expect(cases).toContainText("Fixture: a bug fix that failed once", { timeout: 10_000 });
  await expect(cases.getByRole("table")).toContainText("Claude or Codex");
  await expect(policy.getByText("Writing the playbook…")).toHaveCount(0);
  await toggle.click();
  await expect(toggle).toBeChecked();
  await page.reload();
  await expect(page.getByRole("switch", { name: "Route tasks with this playbook" })).toBeChecked();
});

test("a question from the agent is shown beside the document with each sentence's line", async ({ page }) => {
  await page.goto("/settings?tab=intelligence&scenario=playbook-question");
  const policy = page.getByRole("region", { name: "Routing policy" });
  const asking = policy.getByRole("region", { name: "The playbook needs an answer" });
  await expect(asking).toContainText("Which one wins?", { timeout: 15_000 });
  await expect(asking.getByRole("listitem").first()).toContainText("Line 3");
  await expect(policy.getByLabel("Markdown")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("a sentence that cannot be carried out and a refusal are shown with their reasons", async ({ page }) => {
  await page.goto("/settings?tab=intelligence&scenario=playbook-unable");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await expect(policy.getByText("This sentence cannot be carried out")).toBeVisible({ timeout: 15_000 });
  await expect(policy.getByText("Fixture: Art and visual design go to the plotter.")).toBeVisible();
  await page.goto("/settings?tab=intelligence&scenario=playbook-refused");
  await expect(page.getByRole("region", { name: "Routing policy" }).getByText(/Fixture: The document asks to send task text/)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("region", { name: "Routing policy" }).getByText("The previous playbook is still in effect.")).toBeVisible();
});

/** What each authoring state shows, to wait for before checking the page. */
const STATES: [string, RegExp][] = [
  ["playbook-running", /Writing the playbook…/], ["playbook-question", /Which one wins\?/], ["playbook-unable", /This sentence cannot be carried out/],
  ["playbook-refused", /The playbook was not written/], ["playbook-saved", /Fixture: a bug fix that failed once/], ["playbook-many", /Fixture: situation 1,/],
];
for (const width of [1440, 390, 320]) for (const [scenario, shown] of STATES) {
  test(`${scenario} has no accessibility violation and no horizontal scroll at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/settings?tab=intelligence&scenario=${scenario}`);
    await expect(page.getByRole("region", { name: "Routing policy" }).getByText(shown).first()).toBeVisible({ timeout: 15_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(results.violations.map(v => v.id)).toEqual([]);
  });
}

test("rolling back asks first, names what comes back, and then the previous playbook is in effect", async ({ page }) => {
  await page.goto("/settings?tab=intelligence&scenario=playbook-saved");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByRole("button", { name: "Roll back to the previous playbook" }).click({ timeout: 15_000 });
  const ask = policy.getByRole("group", { name: "Put the previous playbook back?" });
  await expect(ask).toContainText("Tasks routed from now on follow the previous playbook.");
  await expect(policy.getByRole("button", { name: "Keep the current playbook" })).toBeFocused();
  await ask.getByRole("button", { name: "Roll back" }).click();
  await expect(policy.getByText("There is no earlier playbook to compare it with.")).toBeVisible();
  await expect(policy.getByRole("button", { name: /Roll back/ })).toHaveCount(0);
});

test("one Save includes a level edit and the routing Markdown", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByRole("button", { name: "Edit Fixture standard, low" }).click();
  const editor = page.getByRole("region", { name: "Edit Fixture standard, low" });
  await editor.getByLabel("Reasoning of candidate 1").selectOption("medium");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByLabel("Markdown").fill("# Routing\n\nChoose a level.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("row", { name: "Fixture standard, low" })).toContainText("fixture-provider · fixture-model · medium · opencode");
  await expect(page.getByRole("region", { name: "Routing policy" }).getByLabel("Markdown")).toHaveValue("# Routing\n\nChoose a level.");
});

test("leaving Settings warns, staying and switching tabs retain drafts", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const policy = page.getByRole("region", { name: "Routing policy" });
  await policy.getByLabel("Markdown").fill("# Unsaved routing");
  await page.getByRole("tab", { name: "Display", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  const warning = page.getByRole("alertdialog", { name: "Leave Settings with unsaved changes?" });
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Stay in Settings" }).click();
  await page.getByRole("tab", { name: "Intelligence", exact: true }).click();
  await expect(policy.getByLabel("Markdown")).toHaveValue("# Unsaved routing");
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await expect(warning).toBeVisible();
  await warning.getByRole("button", { name: "Leave without saving" }).click();
  await expect(page).toHaveURL(/\/overview/);
});

test("reloading warns until Intelligence changes are saved", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  await page.getByLabel("Markdown").fill("# Unsaved source");
  const dialog = page.waitForEvent("dialog");
  // A cancelled reload has no navigation to satisfy Playwright's load wait.
  const reload = page.reload({ timeout: 2000 }).catch(() => null);
  const warning = await dialog;
  expect(warning.type()).toBe("beforeunload");
  await warning.dismiss();
  await reload;
  await expect(page.getByLabel("Markdown")).toHaveValue("# Unsaved source");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("status", { name: "Intelligence save status", exact: true })).toHaveText("Saved.");
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  const dialogs: string[] = [];
  page.on("dialog", async current => { dialogs.push(current.type()); await current.dismiss(); });
  await page.reload();
  expect(dialogs).toEqual([]);
  await expect(page.getByLabel("Markdown")).toHaveValue("# Unsaved source");
});

test("internal work default and a purpose override persist across reload", async ({ page }) => {
  await page.goto("/settings?tab=intelligence");
  const panel = page.getByRole("region", { name: "Internal work" });
  await expect(panel.getByText("No profile is set. Internal work will fail until one is chosen.")).toBeVisible();
  await panel.getByLabel("Default profile", { exact: true }).selectOption({ label: "Fixture standard, low" });
  await panel.getByLabel("Playbook compilation", { exact: true }).selectOption({ label: "Fixture standard, high" });
  await panel.getByRole("button", { name: "Save internal work", exact: true }).click();
  await expect(panel.getByRole("status")).toHaveText("Saved.");
  await page.reload();
  await expect(panel.getByLabel("Default profile", { exact: true })).toHaveValue("standard-low");
  await expect(panel.getByLabel("Playbook compilation", { exact: true })).toHaveValue("standard-high");
  await expect(panel.getByLabel("Playbook calls", { exact: true })).toHaveValue("");
});
