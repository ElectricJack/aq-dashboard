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
  await motion.getByRole("link", { name: /Replay reconciliation Running/ }).click();
  await expect(page).toHaveURL(new RegExp(`/work/${replay}.*view=gantt`));
  const detail = page.getByRole("region", { name: "Fixture: Replay reconciliation", exact: true });
  await expect(detail).toBeVisible();
  expect((await detail.boundingBox())!.x).toBeGreaterThan((await tracks.boundingBox())!.x);
  await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toHaveAttribute("aria-current", "page");
  await expect(tracks.getByRole("link", { name: /Define lease contract/ })).toHaveCount(0);
  const axe = await new AxeBuilder({ page }).include("#content").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(axe.violations.map(v => v.id)).toEqual([]);
});

test("keyboard zoom and drag pan preserve the All projects chart through selection", async ({ page }) => {
  await page.setViewportSize({ width: 1150, height: 820 });
  await page.goto("/work?view=gantt");
  const tracks = page.getByRole("region", { name: chartName });
  await tracks.focus();
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  await page.keyboard.press("+");
  const zoom = page.getByRole("button", { name: "Zoom 138%. Reset zoom" });
  await expect(zoom).toBeVisible();
  const box = (await tracks.boundingBox())!;
  await page.mouse.move(box.x + 300, box.y + box.height - 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 170, box.y + box.height - 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Return to start" }).click();
  await expect.poll(() => tracks.evaluate(el => el.scrollLeft)).toBe(0);
  await tracks.getByRole("link", { name: /Replay reconciliation/ }).click();
  await expect(page).toHaveURL(new RegExp(`taskProject=${project}`));
  await expect(tracks.getByText("Contract fixture", { exact: true })).toBeVisible();
  await expect(zoom).toBeVisible();
  await expect(page.getByRole("region", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
});

test.describe("phone Gantt", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("tracks pan internally and a task can close back to the same chart", async ({ page }) => {
    await page.goto(`/work?${scope}`);
    await page.getByRole("button", { name: "Gantt", exact: true }).click();
    const tracks = page.getByRole("region", { name: chartName });
    await expect(tracks).toBeVisible();
    expect(await tracks.evaluate(el => el.scrollWidth)).toBeGreaterThan(await tracks.evaluate(el => el.clientWidth));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await page.getByRole("button", { name: "Zoom out" }).tap();
    const zoom = page.getByRole("button", { name: "Zoom 88%. Reset zoom" });
    await expect(zoom).toBeVisible();
    await tracks.getByRole("link", { name: /Replay reconciliation/ }).tap();
    await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Close task" }).tap();
    await expect(zoom).toBeVisible();
    await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toBeFocused();
  });
});

test("a live completion hides the finished bar and moves its fork and join left", async ({ page }) => {
  const fixture = JSON.parse(readFileSync("contracts/live/human-graph/examples/task.json", "utf8")) as GraphEnvelope<GraphNode>;
  const id = (suffix: string) => `00000000-0000-0000-0000-000000000${suffix}`;
  const items = [
    { ...fixture.data, id: replay, title: "Fixture: Replay reconciliation", task_state: "active" },
    { ...fixture.data, id: id("104"), title: "Fixture: Approve recovery plan", task_state: "active" },
    { ...fixture.data, id: id("106"), title: "Fixture: Implement safe recovery", task_state: "draft" },
    { ...fixture.data, id: id("107"), title: "Fixture: Validate crash recovery", task_state: "draft" },
  ];
  const dependencies = [[replay, id("104")], [replay, id("106")], [id("104"), id("107")], [id("106"), id("107")]]
    .map(([source, target], index) => ({ id: id(`20${index}`), source, target, edge_type: "blocks", version: "1", description: null,
      source_revision: null, target_revision: null }));
  const attempt = { attempt_id: id("301"), session_id: id("302"), status: "running" };
  await page.clock.install();
  await page.addInitScript(({ project, items, dependencies, replay, attempt }) => {
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
  const join = tracks.getByRole("link", { name: /Validate crash recovery/ });
  const offset = (link: typeof running) => link.evaluate(el => (el as HTMLElement).offsetLeft);
  await expect(running).toBeVisible();
  await expect(join).toHaveCount(1);
  await expect(join).toHaveAccessibleName(/2 prerequisites/);
  const firstColumn = await offset(running);
  const secondColumn = await offset(approval);
  expect(secondColumn).toBeGreaterThan(firstColumn);
  expect(await offset(join)).toBeGreaterThan(secondColumn);
  await running.click();
  await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();

  await page.evaluate(() => sessionStorage.setItem("gantt-fixture-completed", "true"));
  await page.clock.fastForward(21_000);
  await expect(tracks.getByRole("link", { name: /Replay reconciliation/ })).toHaveCount(0);
  await expect.poll(() => offset(tracks.getByRole("link", { name: /Approve recovery plan Active/ }))).toBe(firstColumn);
  await expect.poll(() => offset(join)).toBe(secondColumn);
  await expect(page.getByRole("heading", { name: "Fixture: Replay reconciliation", exact: true })).toBeVisible();
});
