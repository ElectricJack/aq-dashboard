import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const project="00000000-0000-0000-0000-000000000001", root="00000000-0000-0000-0000-000000000003", next="00000000-0000-0000-0000-000000000004";
const scope=`scope=project:${project}`, work=`/work/${root}?${scope}`;
const PAGES = [
  { path: "/overview", ready: (p: Page) => p.getByRole("region", { name: "Needs your attention" }).getByRole("listitem").first() },
  { path: `/work?${scope}`, ready: (p: Page) => p.getByRole("list", { name: "Tasks" }) },
  { path: work, ready: (p: Page) => p.getByRole("heading", { level: 2, name: "Contract fixture: task inspection" }) },
  { path: `${work}&view=graph&root=${root}`, ready: (p: Page) => p.getByRole("region", { name: "Dependency graph" }) },
  { path: "/agents", ready: (p: Page) => p.getByRole("list", { name: "Sessions" }) },
  { path: "/agents/sess-07", ready: (p: Page) => p.getByRole("heading", { level: 2, name: "Worker 07" }) },
];

const VIEWPORTS = [
  { name: "phone-320", width: 320, height: 640 },
  { name: "desktop-1440", width: 1440, height: 900 },
];

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const pg of PAGES) {
      test(`${pg.path} reflows and passes axe`, async ({ page }) => {
        await page.goto(pg.path);
        await expect(pg.ready(page)).toBeVisible();
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
        );
        expect(overflow).toBe(false);
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
      });
    }

    test("Back from a task restores focus to its row", async ({ page }) => {
      await page.goto(`/work?${scope}`);
      const link = page.getByRole("list", { name: "Tasks" }).getByRole("link", { name: "Contract fixture: task inspection" });
      await link.click();
      await expect(page.getByRole("heading", { level: 2, name: "Contract fixture: task inspection" })).toBeFocused();
      await page.goBack();
      await expect(link).toBeFocused();
    });
  });
}

test("desktop shows list and inspector side by side", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(work);
  await expect(page.getByRole("list", { name: "Tasks" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Contract fixture: task inspection" })).toBeVisible();
});

test("phone shows the task detail instead of the list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(work);
  await expect(page.getByRole("heading", { level: 2, name: "Contract fixture: task inspection" })).toBeVisible();
  await expect(page.getByRole("list", { name: "Tasks" })).toBeHidden();
});

test("search is a real modal: focus stays inside and Escape returns it", async ({ page }) => {
  await page.goto(`/overview?${scope}`);
  const button = page.getByRole("button", { name: "Search" });
  await expect(button).toBeVisible();
  await page.keyboard.press("Control+k");
  const dialog = page.getByRole("dialog", { name: "Search" });
  await expect(dialog.getByRole("searchbox")).toBeFocused();
  await dialog.getByRole("searchbox").fill("recovery");
  await expect(dialog.getByRole("link").first()).toBeVisible();
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await dialog.evaluate((d) => d.contains(document.activeElement) || document.activeElement === document.body)).toBe(true);
  }
  await dialog.getByRole("button",{name:"Close search"}).focus();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(button).toBeFocused();
});

test("graph nodes are keyboard reachable and selection keeps positions", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${work}&view=graph&root=${root}`);
  const node = page.getByRole("region",{name:"Scrollable task graph"}).getByRole("link", { name: /Fixture: verify recovery/ });
  const offset = () => node.evaluate((el: HTMLElement) => [el.offsetLeft, el.offsetTop]);
  const before = await offset();
  await node.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/work/${next}`));
  await expect(node).toHaveAttribute("aria-current", "page");
  expect(await offset()).toEqual(before);
});

test("phone: Graph opens from a task, a node opens its detail and Back returns to the graph", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(work);
  await page.getByRole("button", { name: "Graph" }).click();
  const graph = page.getByRole("region", { name: "Dependency graph" });
  await expect(graph).toBeVisible();
  await graph.getByRole("link", { name: /Fixture: verify recovery/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Fixture: verify recovery" })).toBeVisible();
  await expect(graph).toBeHidden();
  await page.goBack();
  await expect(page.getByRole("region", { name: "Dependency graph" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Fixture: verify recovery/ })).toBeFocused();
});

test("returning to Work retains the served list without proposed task requests", async ({ page }) => {
  await page.goto(`/work?${scope}`);
  const list = page.getByRole("list", { name: "Tasks" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Agents" }).click();
  await expect(page.getByRole("heading", { name: "Agents", level:1 })).toBeVisible();
  let proposedRequests = 0;
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/v1/tasks") proposedRequests++; });
  await page.goBack();
  await expect(page.getByRole("list", { name: "Tasks" }).getByRole("listitem")).toHaveCount(2);
  expect(proposedRequests).toBe(0);
});
