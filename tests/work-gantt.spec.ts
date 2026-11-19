import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { GraphEnvelope, GraphNode } from "../src/api/adapters/humanGraph";

const project = "00000000-0000-0000-0000-000000000001";
const replay = "00000000-0000-0000-0000-000000000105";
const scope = `scope=project:${project}`;
const chartName = "Scrollable dependency tracks";

test("Overview opens the selected task in Work Gantt and keeps the chart beside its details", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/overview");
  const motion = page.getByRole("region", { name: "Work in motion", exact: true });
  const tracks = page.getByRole("region", { name: chartName });
  await expect(motion.getByText("Project activity summary", { exact: true })).toHaveCount(0);
  await expect(motion.getByText(/^Dependencies \(\d+\)$/)).toHaveCount(0);
  await motion.getByRole("link", { name: /Replay reconciliation Running/ }).locator("[data-gantt-label]").click();
  await expect(page).toHaveURL(new RegExp(`/work/${replay}.*view=gantt`));
  const detail = page.getByRole("region", { name: "Fixture: Replay reconciliation", exact: true });
  await expect(detail).toBeVisible();
  expect((await detail.boundingBox())!.x).toBeGreaterThan((await tracks.boundingBox())!.x);
  await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toHaveAttribute("aria-current", "page");
  await expect(tracks.getByRole("link", { name: /Define lease contract/ })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include("#content").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
});

test("wheel, keyboard zoom and drag pan preserve the All projects chart through selection", async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 820 });
  await page.goto("/work?view=gantt");
  const tracks = page.getByRole("region", { name: chartName });
  await tracks.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  const zoom = page.getByRole("button", { name: "Zoom 175%. Reset zoom" });
  await expect(zoom).toBeVisible();
  const rootLabel = tracks.getByRole("link", { name: /Replay reconciliation/ }).locator("[data-gantt-label]");
  const initialLabelX = (await rootLabel.boundingBox())!.x;
  const box = (await tracks.boundingBox())!;
  await page.mouse.move(box.x + 380, box.y + box.height - 28);
  await page.mouse.wheel(0, 190);
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Return to start" }).click();
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(0);
  // Drag can start on a task name without opening its inspector.
  const label = (await rootLabel.boundingBox())!;
  await page.mouse.move(label.x + 120, label.y + label.height / 2);
  await page.mouse.down();
  await page.mouse.move(label.x + 45, label.y + label.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  expect((await rootLabel.boundingBox())!.x).toBe(initialLabelX);
  await expect(page).toHaveURL(/\/work\?view=gantt$/);
  await page.getByRole("button", { name: "Return to start" }).click();
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(0);
  await rootLabel.click();
  await expect(page).toHaveURL(new RegExp(`taskProject=${project}`));
  await expect(tracks.getByText("Contract fixture", { exact: true })).toBeVisible();
  await expect(zoom).toBeVisible();
  await expect(page.getByRole("region", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
});

test.describe("phone Gantt", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("tracks pan internally and a task can close back to the same chart", async ({ page }, testInfo) => {
    await page.goto(`/work?${scope}`);
    await page.getByRole("button", { name: "Gantt", exact: true }).click();
    const tracks = page.getByRole("region", { name: chartName });
    await expect(tracks).toBeVisible();
    expect(await tracks.evaluate(el => el.scrollWidth)).toBeGreaterThan(await tracks.evaluate(el => el.clientWidth));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.getByRole("button", { name: "Zoom out" }).tap();
    const zoom = page.getByRole("button", { name: "Zoom 88%. Reset zoom" });
    await expect(zoom).toBeVisible();
    await tracks.getByRole("link", { name: /Replay reconciliation/ }).locator("[data-gantt-label]").tap();
    await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Close task" }).tap();
    await expect(zoom).toBeVisible();
    await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toBeFocused();
    if (process.env.GANTT_EVIDENCE) await page.screenshot({ animations: "disabled", path: testInfo.outputPath("gantt-phone.png") });
  });
});

test("story points set bar lengths and a shared dependent waits for the latest finish", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const fixture = JSON.parse(readFileSync("contracts/live/human-graph/examples/task.json", "utf8")) as GraphEnvelope<GraphNode>;
  const id = (suffix: string) => `00000000-0000-0000-0000-000000000${suffix}`;
  const items = [
    { ...fixture.data, id: replay, title: "Fixture: Replay reconciliation", task_state: "active", story_points: 5 },
    { ...fixture.data, id: id("104"), title: "Fixture: Approve recovery plan", task_state: "active", story_points: 3 },
    { ...fixture.data, id: id("106"), title: "Fixture: Implement safe recovery", task_state: "draft", story_points: 8 },
    { ...fixture.data, id: id("107"), title: "Fixture: Validate crash recovery", task_state: "draft", story_points: null },
  ];
  const dependencies = [[replay, id("104")], [replay, id("106")], [id("104"), id("107")], [id("106"), id("107")]]
    .map(([source, target], index) => ({ id: id(`20${index}`), source, target, edge_type: "blocks", version: "1", description: null,
      source_revision: null, target_revision: null }));
  const attempt = { attempt_id: id("301"), session_id: id("302"), status: "running" };
  await page.clock.install();
  await page.context().addInitScript(({ project, items, dependencies, replay, attempt }) => {
    const fetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, window.location.href);
      const path = `/api/human/projects/${project.id}/tasks`;
      const completed = sessionStorage.getItem("gantt-fixture-completed") === "true";
      const tasks = items.map(task => completed && task.id === replay ? { ...task, task_state: "completed", version: "2" } : task);
      const wrap = (data: unknown) => Promise.resolve(Response.json({
        contract: "human-graph-1", project, observed_at: new Date().toISOString(), data,
      }));
      if (url.pathname === path) return wrap({
        items: tasks, next_cursor: null, executions: completed ? [] : [{ ...attempt, task_id: replay }],
      });
      if (url.pathname.startsWith(path + "/") && url.pathname.endsWith("/graph")) {
        const id = url.pathname.split("/").at(-2);
        const edges = dependencies.filter(edge => edge.source === id || edge.target === id);
        const linked = new Set(edges.flatMap(edge => [edge.source, edge.target]));
        return wrap({ root_id: id, nodes: tasks.filter(task => task.id === id || linked.has(task.id)), edges, truncated: false });
      }
      return fetch(input, init);
    };
  }, { project: fixture.project, items, dependencies, replay, attempt });
  await page.goto(`/work?${scope}&view=gantt`);
  const tracks = page.getByRole("region", { name: chartName });
  const running = tracks.getByRole("link", { name: /Replay reconciliation Running/ });
  const approval = tracks.getByRole("link", { name: /Approve recovery plan Waiting/ });
  const implementation = tracks.getByRole("link", { name: /Implement safe recovery/ });
  const join = tracks.getByRole("link", { name: /Validate crash recovery/ });
  const bar = (link: typeof running) => link.locator("[data-gantt-bar]");
  const offset = (link: typeof running) => bar(link).evaluate(el => (el as HTMLElement).offsetLeft);
  const connector = (index: number) => tracks.locator(`[data-gantt-dependency$="/${id(`20${index}`)}"]`);
  const path = (index: number) => connector(index).getAttribute("d");
  await expect(running).toBeVisible();
  await expect(running).toHaveAccessibleName(/2 dependents/);
  await expect(running).toHaveAccessibleDescription(/Blocks Fixture: Approve recovery plan, Fixture: Implement safe recovery/);
  await expect(join).toHaveAccessibleDescription(/Waits for Fixture: Approve recovery plan, Fixture: Implement safe recovery/);
  await expect(page.getByText(/^Dependencies \(\d+\)$/)).toHaveCount(0);
  await expect(join).toHaveCount(1);
  await expect(join).toHaveAccessibleName(/2 prerequisites/);
  const firstColumn = await offset(running);
  const secondColumn = await offset(approval);
  expect(secondColumn).toBeGreaterThan(firstColumn);
  expect(await offset(implementation)).toBe(secondColumn);
  const approvalY = (await bar(approval).boundingBox())!.y;
  const implementationY = (await bar(implementation).boundingBox())!.y;
  expect(approvalY).not.toBe(implementationY);
  expect((await bar(join).boundingBox())!.y).toBeGreaterThan(Math.max(approvalY, implementationY));
  const joinStart = await offset(join);
  const unit = (secondColumn - firstColumn) / 5;
  expect(joinStart - secondColumn).toBe(8 * unit);
  const approvalWidth = (await bar(approval).boundingBox())!.width;
  const implementationWidth = (await bar(implementation).boundingBox())!.width;
  expect(implementationWidth - approvalWidth).toBe(5 * unit);
  await expect(join).toHaveAccessibleName(/Unestimated/);
  await expect(join).toHaveAttribute("data-unestimated", "true");
  const ruler = tracks.getByRole("group", { name: "Story points" });
  await expect(ruler.getByText("0", { exact: true })).toBeVisible();
  await expect(ruler.getByText("5", { exact: true })).toBeVisible();
  const forkSegment = (d: string | null) => d?.split(" V ")[0];
  expect(forkSegment(await path(0))).toBe(forkSegment(await path(1)));
  expect(await path(0)).not.toBe(await path(1));
  const bend = (d: string | null) => d?.match(/ H ([-\d.]+) V /)?.[1];
  expect(bend(await path(2))).not.toBe(bend(await path(3)));
  await running.locator("[data-gantt-label]").hover();
  await expect(connector(0)).toHaveAttribute("data-highlight", "true");
  await expect(connector(1)).toHaveAttribute("data-highlight", "true");
  if (process.env.GANTT_EVIDENCE) {
    await page.screenshot({ animations: "disabled", path: testInfo.outputPath("gantt-branching-desktop.png") });
    const overview = await page.context().newPage();
    await overview.setViewportSize({ width: 1440, height: 900 });
    await overview.goto("/overview");
    const motion = overview.getByRole("region", { name: "Work in motion", exact: true });
    await expect(motion.locator("[data-gantt-dependency]")).toHaveCount(4);
    await motion.getByRole("button", { name: "Zoom out" }).click();
    await motion.getByRole("button", { name: "Zoom out" }).click();
    await motion.evaluate(el => el.scrollIntoView({ block: "center" }));
    await overview.screenshot({ animations: "disabled", path: testInfo.outputPath("gantt-branching-overview.png") });
    await overview.close();
  }
  await bar(running).click();
  await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();

  await page.evaluate(() => sessionStorage.setItem("gantt-fixture-completed", "true"));
  await page.clock.fastForward(21_000);
  await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toHaveCount(0);
  await expect.poll(() => offset(tracks.getByRole("link", { name: /Approve recovery plan Active/ }))).toBe(firstColumn);
  await expect.poll(() => offset(join)).toBe(joinStart - 5 * unit);
  await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
});
