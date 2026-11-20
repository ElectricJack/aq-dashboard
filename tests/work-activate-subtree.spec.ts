import { expect, test } from "@playwright/test";

const project = "00000000-0000-0000-0000-000000000001";
const parent = "00000000-0000-0000-0000-000000000101";
const leaf = "00000000-0000-0000-0000-000000000105";
const taskUrl = (id: string) => `/work/${id}?scope=project:${project}`;

for (const viewport of [
  { width: 1440, height: 900, menu: "More actions" },
  { width: 390, height: 844, menu: "Task actions" },
]) {
  test(`activate draft descendants from the Work inspector at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(taskUrl(leaf));
    const inspector = page.locator("[data-task-inspector]");
    const menu = inspector.getByRole("button", { name: viewport.menu });
    const activate = inspector.getByRole("menuitem", { name: "Activate subtree" });
    await menu.click();
    await expect(activate).toHaveCount(0);

    await page.goto(taskUrl(parent));
    await expect(inspector.locator("[data-child-counts]")).toHaveText(/2 draft/);
    await menu.click();
    await expect(activate).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("activation-menu.png") });
    await activate.click();
    const dialog = page.getByRole("dialog", { name: "Activate subtree" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("activation-dialog.png") });
    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/v1/actions" && r.method() === "POST");
    await dialog.getByRole("button", { name: "Activate subtree" }).click();
    expect((await request).postDataJSON()).toMatchObject({
      kind: "task.activate.subtree",
      subject: { type: "task", id: parent },
      payload: { project_id: project },
    });
    await expect(dialog.getByRole("status")).toHaveText("2 activated, 7 skipped");
    await dialog.getByRole("button", { name: "Close action" }).click();
    await expect(inspector.locator("[data-child-counts]")).toHaveText(/9 descendants: 6 active, 2 completed, 1 canceled/);
    await menu.click();
    await expect(activate).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  });
}
