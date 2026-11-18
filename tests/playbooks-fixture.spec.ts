import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// PB-A (reference 06-playbooks.png): labelled mock-mode fixtures make the Playbooks page reviewable.
const evidence = "docs/evidence/playbooks-pb-a";
const waiting = "run-0000000000000284";
const VIEWPORTS = [
  { name: "d", width: 1440, height: 900 },
  { name: "m", width: 390, height: 844 },
];

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
}

for (const vp of VIEWPORTS) {
  test.describe(`${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("recent runs list labelled fixture runs in every state", async ({ page }) => {
      await page.goto("/playbooks?view=runs");
      const runs = page.getByRole("list", { name: "Playbook runs" });
      await expect(page.getByRole("link", { name: /worker.recovery/i })).toBeVisible({ timeout: 30_000 });
      await expect(runs.getByRole("listitem")).toHaveCount(6);
      for (const state of [/Completed/, /Running/, /Needs attention/, /Waiting/]) await expect(runs.getByText(state).first()).toBeAttached();
      await expect(page.getByText(/Fixture: project coding policy/)).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/playbooks-${vp.name}.png` });
    });

    test("waiting run shows its pin strip, receipts, decision wait and child", async ({ page }) => {
      await page.goto(`/playbooks/runs/${waiting}`);
      await expect(page.getByRole("heading", { name: /Recorded execution/ })).toBeVisible({ timeout: 30_000 });
      const inspector = page.getByRole("region", { name: `Run ${waiting}` });
      await expect(inspector.getByText(/This run:\s*Worker recovery/)).toBeVisible();
      await expect(inspector.getByText(/^sha256:a81c9e/).first()).toBeAttached();
      await expect(inspector.getByRole("list", { name: "Execution timeline" }).getByRole("listitem")).toHaveCount(3);
      await expect(inspector.getByText("Human decision")).toBeAttached();
      await expect(inspector.getByRole("link", { name: "run-285" })).toBeAttached();
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
      await page.screenshot({ path: `${evidence}/playbooks-run-${vp.name}.png`, fullPage: true });
    });

    test("the library and deployments show their current catalog rows", async ({ page }) => {
      for (const kind of ["definitions", "activations"]) {
        await page.goto(`/playbooks?view=${kind}`);
        const list = page.getByRole("list", { name: `Current playbook ${kind}` });
        await expect(list.getByRole("listitem")).toHaveCount(kind === "definitions" ? 2 : 1, { timeout: 30_000 });
        await expect(list.getByText(/worker[- ]recovery/i).first()).toBeVisible();
        await expectNoAxeViolations(page);
        await page.screenshot({ path: `${evidence}/playbooks-${kind}-${vp.name}.png` });
      }
    });

    test("the compiled workflow is browsable before opening any run", async ({ page }, testInfo) => {
      const runReads: string[] = [];
      page.on("request", request => {
        if (new URL(request.url()).pathname.startsWith("/api/playbooks/inspection/runs")) runReads.push(request.url());
      });
      await page.goto("/playbooks");
      const library = page.getByRole("list", { name: "Current playbook definitions" });
      const recovery = library.getByRole("button", { name: /^Worker recovery/ });
      const diagram = page.getByRole("region", { name: "Workflow diagram" });
      if (vp.width < 1200) {
        await expect(diagram).toHaveCount(0);
        await recovery.click();
        await expect(page.getByRole("link", { name: "All playbooks" })).toBeVisible();
      }
      const review = diagram.getByRole("button", { name: "Wait Request review" });
      await expect(review).toBeVisible({ timeout: 10_000 });
      await expect(diagram.getByRole("img", { name: /Request review to Start recovery.*Approved/ })).toBeAttached();
      await expect(diagram.getByRole("img", { name: /Retain source to Stop recovery.*On error/ })).toBeAttached();
      const fit = diagram.getByRole("button", { name: /fit view/i });
      await fit.click();
      const details = page.getByRole("complementary", { name: "Step details" });
      await expect(details).toHaveCount(0);
      const description = page.getByRole("heading", { name: "When to use this playbook" });
      await expect(description).toBeVisible();
      await expect(page.locator("strong").filter({ hasText: /^Preserve the source$/ })).toBeVisible();
      await review.focus();
      await page.keyboard.press("Enter");
      await expect(review).toHaveAttribute("aria-pressed", "true");
      await expect(details.getByRole("heading", { name: "Request review" })).toBeVisible();
      await expect(details.getByText("decision.resolved")).toBeVisible();
      await expect(details.getByText("review_decision")).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("step-inspector.png") });
      await description.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath("playbook-description.png") });
      if (vp.width < 1200) {
        await page.setViewportSize({ width: 320, height: vp.height });
        await expectNoHorizontalOverflow(page);
        await page.setViewportSize({ width: vp.width, height: vp.height });
      }
      await details.getByRole("button", { name: /Approved.*Start recovery/ }).click();
      await expect(details.getByRole("heading", { name: "Start recovery" })).toBeVisible();
      await details.getByRole("button", { name: "Close step details" }).click();
      await expect(details).toHaveCount(0);
      await expect(diagram.getByRole("button", { name: /Call playbook Start recovery/ })).toBeFocused();
      if (vp.width < 1200) await page.getByRole("link", { name: "All playbooks" }).click();
      await library.getByRole("button", { name: /^Validate candidate/ }).click();
      await page.getByRole("combobox", { name: "Entry point" }).selectOption("validate-recovery-inputs");
      await expect(diagram.getByRole("button", { name: /Report inputs/ })).toBeVisible();
      await expect(diagram.getByRole("button", { name: /Run checks/ })).toHaveCount(0);
      await expect(description).toHaveCount(0);
      expect(runReads).toEqual([]);
      await expectNoHorizontalOverflow(page);
      await expectNoAxeViolations(page);
    });

    test("the step inspector explains routing branches and where fields are used", async ({ page }, testInfo) => {
      test.setTimeout(45_000);
      await page.goto("/playbooks?scenario=playbook-step-inspection");
      const library = page.getByRole("list", { name: "Current playbook definitions" });
      await expect(page.getByText("Fixture: project coding policy")).toBeVisible({ timeout: 20_000 });
      if (vp.width < 1200) await library.getByRole("button", { name: /^Task routing/ }).click();

      const diagram = page.getByRole("region", { name: "Workflow diagram" });
      const read = diagram.getByRole("button", { name: /^Command.*Read$/ });
      const ask = diagram.getByRole("button", { name: "Command Ask" });
      const inspector = page.getByRole("complementary", { name: "Step details" });
      const transitions = inspector.getByRole("list", { name: "Outgoing transitions" });
      const later = inspector.getByRole("list", { name: "Used by later steps" });
      const earlier = inspector.getByRole("list", { name: "Uses from earlier steps" });
      await read.press("Enter");
      await expect(read).toHaveAttribute("aria-pressed", "true");
      await expect(inspector.getByRole("heading", { name: "Read", exact: true })).toBeVisible();
      await expect(inspector.getByText(/Uses the task ID in subject/)).toBeVisible();
      await expect(transitions.getByRole("button", { name: "Observed Owned" })).toHaveAccessibleDescription(/found the task and returned its details/);
      await expect(transitions.getByRole("button", { name: "Refused Skipped" })).toHaveAccessibleDescription(/task is unknown or its project does not use automatic routing/);
      await expect(transitions.getByRole("button", { name: "On error Failed" })).toHaveAccessibleDescription(/input was invalid or the runtime rejected the command/);
      await expect(later.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Owned", exact: true }) })).toContainText("task.facts.route");
      const assessment = later.getByRole("listitem").filter({ has: page.getByRole("button", { name: "Ask", exact: true }) });
      for (const field of ["title", "description", "kind"]) await expect(assessment.getByText(`task.facts.${field}`, { exact: true })).toBeVisible();
      await expect(inspector.getByText("If the workflow reaches these steps.")).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("routing-read.png") });
      await transitions.evaluate(list => list.scrollIntoView({ block: "center" }));
      await page.screenshot({ path: testInfo.outputPath("routing-read-outcomes.png") });
      await expect(inspector.getByText("work.read", { exact: true })).toBeHidden();
      await inspector.getByText("Details", { exact: true }).click();
      await expect(inspector.getByText("work.read", { exact: true })).toBeVisible();
      await inspector.getByText("Details", { exact: true }).click();

      await transitions.getByRole("button", { name: "Observed Owned" }).press("Enter");
      await expect(inspector.getByRole("heading", { name: "Owned", exact: true })).toBeVisible();
      await expect(inspector.getByText(/Checks whether an owner already set the task's route by comparing task\.facts\.route with owner/)).toBeVisible();
      await expect(earlier.getByRole("button", { name: "Read", exact: true })).toBeVisible();
      await expect(transitions.getByRole("button", { name: "True Skipped" })).toHaveAccessibleDescription(/An owner already set the task's route/);
      await expect(transitions.getByRole("button", { name: "False Ask" })).toHaveAccessibleDescription(/no route or its route was set by the router/);
      await expect(transitions.getByRole("button", { name: "Unknown Failed" })).toHaveAccessibleDescription(/condition could not be evaluated/);
      await page.screenshot({ path: testInfo.outputPath("routing-owned.png") });

      await transitions.getByRole("button", { name: "False Ask" }).press("Enter");
      await expect(inspector.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
      await expect(inspector.getByText(/Requests a model assessment using the task's title, description, and kind/)).toBeVisible();
      for (const field of ["title", "description", "kind"]) await expect(earlier.getByText(`task.facts.${field}`, { exact: true })).toBeVisible();
      await expect(transitions.getByRole("button", { name: "Accepted Await" })).toHaveAccessibleDescription(/queued the assessment/);
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: testInfo.outputPath("routing-ask.png") });
      await expectNoAxeViolations(page);

      await earlier.getByRole("button", { name: "Read", exact: true }).press("Enter");
      await expect(inspector.getByRole("heading", { name: "Read", exact: true })).toBeVisible();
      await later.getByRole("button", { name: "Ask", exact: true }).press("Enter");
      await expect(inspector.getByRole("heading", { name: "Ask", exact: true })).toBeVisible();
      if (vp.width < 1200) {
        await page.setViewportSize({ width: 320, height: vp.height });
        await expectNoHorizontalOverflow(page);
      }
      await inspector.getByRole("button", { name: "Close step details" }).press("Enter");
      await expect(inspector).toHaveCount(0);
      await expect(ask).toBeFocused();
    });
  });
}

test("a project without playbooks can open the same view across all projects", async ({ page }) => {
  const scope = "project:a22afccc-d61a-5f77-aef8-9fd73311c68a";
  for (const [view, collection] of [
    ["library", "Current playbook definitions"],
    ["deployment", "Current playbook activations"],
    ["runs", "Playbook runs"],
    ["start-requests", "Playbook start requests"],
  ]) {
    await page.goto(`/playbooks?${new URLSearchParams({ scope, view })}`);
    await expect(page.getByText("Playbooks are unavailable for the selected project.")).toBeVisible();
    await expect(page.getByRole("list", { name: collection })).toHaveCount(0);
    await page.getByRole("link", { name: "View playbooks across all projects" }).click();
    await expect(page).toHaveURL(new RegExp(`/playbooks\\?view=${view}$`));
    await expect(page.getByRole("list", { name: collection })).toBeVisible();
  }
});

test("empty, failed and unavailable scenarios switch playbook reads", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/playbooks?view=runs&scenario=empty");
  await expect(page.getByText("No runs recorded in this configured namespace.")).toBeVisible({ timeout: 30_000 });
  await page.goto("/playbooks?view=runs&scenario=failed");
  await expect(page.getByText("Couldn't load playbook runs.", { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("link", { name: /worker.recovery/i })).toHaveCount(0);
  await page.goto("/playbooks?view=runs&scenario=unavailable");
  await expect(page.getByText(/Playbooks is not available/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/playbook runtime is not configured/)).toBeVisible();
});
