import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

// WK-E: contextual task inspector against design reference 02 (labelled mock fixture, src/mocks/humanGraph.ts).
const project = "00000000-0000-0000-0000-000000000001", approve = "00000000-0000-0000-0000-000000000104";
const scope = `scope=project:${project}`;
const evidence = process.env.EVIDENCE_DIR;

async function axe(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
}
const inspector = (page: Page) => page.locator("[data-task-inspector]");

async function actionsAboveStatus(panel: Locator) {
  const statusTop = (await panel.getByRole("heading", { name: "Status" }).boundingBox())!.y;
  // Copy controls (spec 0004 item 1), Expand and section folds are not actions; one primary action plus More
  // actions (a phone has one Task actions menu, P1-02).
  return panel.getByRole("button").evaluateAll((els, top) => els.filter((e) => !e.getAttribute("aria-label")?.startsWith("Copy") && !e.hasAttribute("aria-expanded") && !e.hasAttribute("aria-pressed") || e.getAttribute("aria-haspopup") === "menu").filter((e) => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.top < top;
  }).length, statusTop);
}

for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "phone", width: 390, height: 844 }]) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("inspector leads with identity and one primary action row", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const panel = inspector(page);
      const description = panel.getByRole("heading", { name: "Description" });
      await expect(description).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-${vp.name}.png` });
      const above = await actionsAboveStatus(panel);
      expect(above).toBe(vp.name === "desktop" ? 2 : 1);
      // Header, then Status, then the comment composer, all in the first desktop viewport (spec 0004 §3, P1-03).
      if (vp.name === "desktop") await expect(panel.getByLabel("Add a comment")).toBeInViewport({ ratio: 1 });
      await expect(panel.getByText(/^Revision \d+$/)).toBeAttached();
      // The inspector is the single task view (spec 0004 §3, WD-02).
      await expect(panel.getByRole("link", { name: "Open full task" })).toHaveCount(0);
      const actions = vp.name === "desktop" ? "More actions" : "Task actions";
      await panel.getByRole("button", { name: actions }).click();
      const menu = page.getByRole("menu");
      // Includes Change role (the server states the task's role) and Set route, offered because this fixture task is ready under an automatic router (spec 0011 §8).
      await expect(menu.getByRole("menuitem")).toHaveCount(vp.name === "desktop" ? 8 : 9);
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-menu-${vp.name}.png` });
      await axe(page);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(panel.getByRole("button", { name: actions })).toBeFocused();
    });

    test("the recorded requester fits in Status and older tasks omit it", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const panel = inspector(page);
      const requester = panel.locator("[data-task-requester]");
      await expect(requester).toHaveText("Requested by fixture.requester · fixture.requester@engineering-operations.example.test");
      await expect(requester).toBeInViewport({ ratio: 1 });
      expect(await requester.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      if (evidence) await page.screenshot({ path: `${evidence}/requester-${vp.name}.png` });
      await axe(page);

      if (vp.name === "phone") {
        const allTasks = panel.getByRole("link", { name: "All tasks" });
        await expect(allTasks).toBeInViewport({ ratio: 1 });
        await allTasks.click();
      }
      await page.getByRole("list", { name: "Tasks" }).getByRole("link", { name: /Implement safe recovery/ }).click();
      await expect(panel.getByRole("heading", { name: "Fixture: Implement safe recovery" })).toBeVisible();
      await expect(requester).toHaveCount(0);
      if (evidence) await page.screenshot({ path: `${evidence}/legacy-${vp.name}.png` });
    });

    test("the owner sets a route on a task that waits for routing, then clears it", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const panel = inspector(page);
      const route = panel.locator("[data-task-route]");
      await expect(route).toContainText("Waiting for routing · 4 min");
      const actions = vp.name === "desktop" ? "More actions" : "Task actions";
      const choose = async (name: string) => {
        await panel.getByRole("button", { name: actions }).click();
        await page.getByRole("menuitem", { name }).click();
        return page.getByRole("dialog", { name });
      };
      const set = await choose("Set route");
      await set.getByLabel("Level").selectOption("standard-high");
      await expect(set.getByRole("checkbox", { name: "fixture-provider" })).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-set-route-${vp.name}.png` });
      await axe(page);
      await set.getByRole("button", { name: "Submit" }).click();
      await expect(set.getByText("Route set to Standard · High")).toBeVisible();
      await set.getByRole("button", { name: "Close action" }).click();
      await expect(route).toContainText("Standard · High");
      await expect(route).toContainText("Set by the owner");
      await route.getByText("Why this route").click();
      await expect(route.getByText("Fixture: the owner set this route.")).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-routed-${vp.name}.png` });
      const clear = await choose("Clear route");
      await clear.getByRole("button", { name: "Submit" }).click();
      await expect(clear.getByText("Route cleared")).toBeVisible();
      await clear.getByRole("button", { name: "Close action" }).click();
      await expect(route).toContainText("Waiting for routing");
      await axe(page);
    });

    test("Status shows the task's role; the owner changes it, and the change shows without leaving the task", async ({ page }) => {
      await page.goto(`/work/${approve}?${scope}`);
      const panel = inspector(page), role = panel.locator("[data-task-role]");
      await expect(role).toHaveText("Role Fixture developer · project default");
      await panel.getByRole("button", { name: vp.name === "desktop" ? "More actions" : "Task actions" }).click();
      await page.getByRole("menuitem", { name: "Change role" }).click();
      const dialog = page.getByRole("dialog", { name: "Change role" });
      const select = dialog.getByLabel("Role");
      await expect(select.locator("option")).toHaveText(["Fixture developer (project default)", "Fixture developer", "Fixture reviewer"]);
      // By keyboard: the select takes focus, arrow keys choose, and Tab reaches Submit.
      await select.focus();
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(select).toHaveValue("reviewer");
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-change-role-${vp.name}.png` });
      await axe(page);
      await page.keyboard.press("Tab");
      await expect(dialog.getByRole("button", { name: "Submit" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog.getByText("Role set to Fixture reviewer")).toBeVisible();
      await dialog.getByRole("button", { name: "Close action" }).click();
      await expect(role).toHaveText("Role Fixture reviewer · set on this task");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await axe(page);
    });

    test("a task whose attempt has started shows what it ran with and no longer offers Change role", async ({ page }) => {
      await page.goto(`/work/00000000-0000-0000-0000-000000000105?${scope}`);
      const panel = inspector(page);
      await expect(panel.locator("[data-holding-attempt] [data-ran-with]")).toHaveText("Ran as developer · Standard · High · claude-opus-5-5 · high reasoning · claude-code");
      await panel.getByRole("button", { name: vp.name === "desktop" ? "More actions" : "Task actions" }).click();
      const item = page.getByRole("menuitem", { name: /^Change role/ });
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toContainText("The role is fixed once an attempt has started");
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      await axe(page);
    });

    test("without task capabilities one shared reason replaces repeated hints", async ({ page }) => {
      // MSW serves bootstrap inside the page, so use the mock's labelled actions-unavailable scenario.
      await page.goto(`/work/${approve}?${scope}&scenario=actions-unavailable`);
      const panel = inspector(page);
      await expect(panel.getByRole("heading", { name: "Description" })).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-nocaps-${vp.name}.png` });
      expect(await page.getByText("Not offered by this AQ server").count()).toBeLessThanOrEqual(1);
      await expect(panel.locator("[data-inspector-header]").getByRole("note")).toHaveText("Task actions unavailable · Fixture scenario: actions are not offered");
      await expect(panel.getByRole("button", { name: /^(More|Task) actions$/ })).toHaveCount(0);
      await axe(page);
    });

    test("a missing task keeps an All tasks exit", async ({ page }) => {
      await page.goto(`/work/00000000-0000-0000-0000-0000000001ff?${scope}`);
      await expect(page.getByText("This item does not exist or is not available to you.")).toBeVisible();
      await expect(page.getByRole("link", { name: "All tasks" })).toBeVisible();
      if (evidence) await page.screenshot({ path: `${evidence}/work-inspector-notfound-${vp.name}.png` });
      await axe(page);
    });
  });
}
