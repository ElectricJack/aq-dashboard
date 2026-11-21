import { expect, test } from "@playwright/test";

const project = "00000000-0000-0000-0000-000000000001";
const draft = "00000000-0000-0000-0000-000000000106";
const dependentDraft = "00000000-0000-0000-0000-000000000107";

for (const viewport of [
  { width: 1440, height: 900, compact: false },
  { width: 390, height: 844, compact: true },
  { width: 320, height: 720, compact: true },
]) {
  test(`activate one draft from the Work inspector at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(`/work/${draft}?scope=project:${project}`);
    const inspector = page.locator("[data-task-inspector]");
    const badge = inspector.locator("[data-task-status]");
    const menu = inspector.getByRole("button", { name: "Task actions" });
    const activate = inspector.getByRole(viewport.compact ? "menuitem" : "button", { name: "Activate task", exact: true });
    await expect(badge).toHaveAttribute("data-status", "draft");
    if (viewport.compact) await menu.click();
    await expect(activate).toBeEnabled();
    await expect(activate).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("activate-task-entry.png") });

    await activate.click();
    const dialog = page.getByRole("dialog", { name: "Activate task" });
    const confirm = dialog.getByRole("button", { name: "Activate", exact: true });
    await expect(dialog).toBeVisible();
    await expect(confirm).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("activate-task-confirmation.png") });

    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/v1/actions" && r.method() === "POST");
    await confirm.click();
    const sent = await request;
    const submission = sent.postDataJSON();
    expect(submission).toMatchObject({
      operation_id: expect.any(String),
      kind: "task.activate",
      subject: { type: "task", id: draft, revision: "1" },
      expected_versions: { task: "1" },
      payload: { operation_id: submission.operation_id, project_id: project, expected_version: "1" },
    });
    await expect(dialog.getByRole("status")).toHaveText("Task activated.");
    const effects = dialog.getByRole("list", { name: "Confirmed effects" }).getByRole("listitem");
    await expect(effects).toHaveText([`task · ${draft} · version 2`]);
    await dialog.getByRole("button", { name: "Close action" }).click();

    await expect(badge).toHaveAttribute("data-status", "waiting");
    await expect(badge).toContainText("Approve recovery plan");
    if (viewport.compact) await menu.click();
    await expect(activate).toHaveCount(0);
    if (viewport.compact) await menu.press("Escape");
    await page.screenshot({ path: testInfo.outputPath("activate-task-waiting.png") });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);

    const { replay, lookup, activeWork, dependentWork } = await page.evaluate(async ({
      project, draft, dependentDraft, bytes, operationId,
    }) => {
      const replay = await fetch("/api/v1/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-AQ-Request": "1" },
        body: bytes,
      });
      const lookup = await fetch(`/api/v1/operations/${operationId}`);
      const readWork = (task: string) => fetch(`/api/human/projects/${project}/tasks/${task}/work`);
      return {
        replay: await replay.json(),
        lookup: await lookup.json(),
        activeWork: await (await readWork(draft)).json(),
        dependentWork: await (await readWork(dependentDraft)).json(),
      };
    }, { project, draft, dependentDraft, bytes: sent.postData(), operationId: submission.operation_id });
    const receipt = await (await sent.response())?.json();
    expect(replay).toEqual(receipt);
    expect(lookup).toEqual(receipt);
    expect(activeWork.data).toMatchObject({ task_state: "active", version: "2", execution: null });
    expect(dependentWork.data).toMatchObject({ task_state: "draft", version: "1", execution: null });
  });
}

test("an activation persists after reload; its receipt survives, and a stale version is a conflict", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/work/${draft}?scope=project:${project}`);
  const inspector = page.locator("[data-task-inspector]");
  const badge = inspector.locator("[data-task-status]");
  await expect(badge).toHaveAttribute("data-status", "draft");
  await inspector.getByRole("button", { name: "Activate task", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Activate task" });
  const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/v1/actions" && r.method() === "POST");
  await dialog.getByRole("button", { name: "Activate", exact: true }).click();
  const sent = await request;
  await expect(dialog.getByRole("status")).toHaveText("Task activated.");
  const receipt = await (await sent.response())?.json();

  await page.reload();
  await expect(badge).toHaveAttribute("data-status", "waiting");
  await expect(inspector.getByRole("button", { name: "Activate task", exact: true })).toHaveCount(0);

  const { work, replay, lookup, stale } = await page.evaluate(async ({ project, draft, bytes, operationId }) => {
    const post = (body: string) => fetch("/api/v1/actions", { method: "POST", headers: { "Content-Type": "application/json", "X-AQ-Request": "1" }, body });
    const replay = await (await post(bytes)).json();
    const lookup = await (await fetch(`/api/v1/operations/${operationId}`)).json();
    // The same request under a new operation ID still expects version 1, which is no longer current.
    const fresh = crypto.randomUUID(), original = JSON.parse(bytes);
    const stale = await (await post(JSON.stringify({ ...original, operation_id: fresh, payload: { ...original.payload, operation_id: fresh } }))).json();
    const work = await (await fetch(`/api/human/projects/${project}/tasks/${draft}/work`)).json();
    return { work, replay, lookup, stale };
  }, { project, draft, bytes: sent.postData()!, operationId: receipt.data.operation_id });
  expect(work.data).toMatchObject({ task_state: "active", version: "2" });
  expect(replay).toEqual(receipt);
  expect(lookup).toEqual(receipt);
  expect(stale.data).toMatchObject({ disposition: "conflict", current_versions: { task: "2" }, affected_entities: [] });
});
