import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const home = "00000000-0000-0000-0000-000000000001";
const target = "00000000-0000-0000-0000-000000000090";
const task = "00000000-0000-0000-0000-000000000104";

for (const width of [1440, 390]) {
  test(`workspace requests and target approval are usable at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 870 });
    await page.goto(`/work/${task}?scope=project:${home}&scenario=workspace-resources`);
    await page.getByRole("button", { name: "Workspace resources", exact: true }).click();
    await expect(page.getByText("No additional sources requested.")).toBeVisible();
    await page.getByLabel("Source project").selectOption(target);
    await page.getByLabel("Source access").selectOption("write");
    await page.getByRole("button", { name: "Request source", exact: true }).click();
    await expect(page.getByText("Awaiting approval", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Request PostgreSQL service" }).click();
    await expect(page.getByText("PostgreSQL service requested.")).toBeVisible();
    const resources = page.locator("[data-section=workspace]");
    await resources.getByText("Awaiting approval", { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("task-workspace-resources.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    expect((await new AxeBuilder({ page }).include("[data-section=workspace]")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);

    await page.getByRole("combobox", { name: "Scope" }).selectOption(`project:${target}`);
    // Project scope changes in the shell retain the selected task URL. Open the
    // project's Work list before reviewing its incoming requests.
    if (width < 768) await page.getByRole("button", { name: "More", exact: false }).click();
    await page.getByRole("link", { name: "Work", exact: true }).click();
    await page.getByText("Incoming workspace requests", { exact: true }).click();
    const requests = page.getByRole("list", { name: "Incoming workspace requests" });
    await expect(requests.getByText("Read and write")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("incoming-workspace-requests.png") });
    await requests.getByRole("button", { name: "Approve access" }).click();
    await expect(page.getByText("Source access approved.")).toBeVisible();
    await expect(page.getByText("No incoming workspace requests.")).toBeVisible();
  });

  test(`workspace declarations fit the task composer at ${width}px`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    await page.setViewportSize({ width, height: 870 });
    await page.goto(`/work?scope=project:${home}&scenario=workspace-resources`);
    await page.getByRole("button", { name: "Create task", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create task" });
    await dialog.getByText("Declare workspace resources", { exact: true }).click();
    await dialog.getByRole("button", { name: "Add source project" }).click();
    await dialog.getByLabel("Source access 1").selectOption("write");
    await dialog.getByRole("checkbox", { name: "Request PostgreSQL service" }).check();
    await expect(dialog.getByLabel("Initial task state")).toHaveValue("draft");
    await expect(dialog.getByLabel("Initial task state")).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Close task composer" })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("create-task-with-workspace.png") });
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    expect((await new AxeBuilder({ page }).include("dialog")
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  });
}
