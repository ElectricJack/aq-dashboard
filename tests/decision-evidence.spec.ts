import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * DC-M: reference 03 middle column (evidence/proposal workspace). Mock mode.
 *
 * The mock decision's task is not in the labelled human-graph fixture, so the
 * "title available" and "superseded" cases overlay the mock responses in this
 * test only: MSW serves them from a service worker that `page.route` cannot
 * reach, so a page-level fetch wrapper rewrites them. Overlaid values are
 * labelled "Fixture:" like the shared graph fixture.
 */
const EVIDENCE = process.env.DCM_EVIDENCE_DIR;
const DECISION = "00000000-0000-4000-8000-000000000001";
const PROJECT = "00000000-0000-4000-8000-000000000003";
const TASK = "00000000-0000-4000-8000-000000000004";
const TITLE = "Fixture: Approve recovery plan";

const VIEWPORTS = [
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "phone-390", width: 390, height: 844 },
];

async function overlay(page: Page, { title, superseded }: { title: boolean; superseded: boolean }) {
  await page.addInitScript(({ decision, project, task, title, superseded }) => {
    const original = window.fetch.bind(window);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (superseded && url.pathname === `/api/reviews/decisions/${decision}`) {
        const body = await (await original(input, init)).json();
        return json({ ...body, current_report_head: false });
      }
      if (title && url.pathname === `/api/human/projects/${project}/tasks/${task}`) {
        // Reuse a labelled graph fixture node, re-addressed to the decision's task and project.
        const source = await (await original("/api/human/projects/00000000-0000-0000-0000-000000000001/tasks/00000000-0000-0000-0000-000000000104")).json();
        return json({ ...source, project: { ...source.project, id: project, name: "Fixture project" }, data: { ...source.data, id: task, title } });
      }
      return original(input, init);
    };
  }, { decision: DECISION, project: PROJECT, task: TASK, title: title ? TITLE : "", superseded });
}

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("evidence workspace header, callout, criteria and related evidence", async ({ page }) => {
      await overlay(page, { title: true, superseded: false });
      await page.goto(`/decisions/${DECISION}`);
      const panel = page.locator("[data-decision-evidence]");
      const heading = panel.getByRole("heading", { level: 2 });
      await expect(heading).toHaveText(TITLE);
      await expect(heading).not.toHaveText(/^Review task [0-9a-f]{8}$/);
      await expect(panel).toHaveAccessibleName(TITLE);

      const crumbs = panel.getByRole("navigation", { name: "Breadcrumb" });
      await expect(crumbs.getByRole("listitem")).toHaveText(["Fixture project", TITLE]);

      const chips = panel.getByRole("list", { name: "Review state" }).getByRole("listitem");
      await expect(chips).toHaveText(["Task version 3", "Awaiting your decision"]);
      await expect(panel.getByRole("status")).toHaveCount(0);

      const note = page.getByRole("note", { name: /Decision requested/ });
      await expect(note).toBeVisible();
      await expect(note).toContainText("Validation policy · fixture-validation-policy");

      await expect(panel.locator("ol[data-decision-criteria] > li")).toHaveCount(2);
      await expect(panel.getByRole("heading", { level: 3, name: "Acceptance criteria" })).toBeVisible();

      await expect(panel.getByRole("link", { name: /^Result report · 00000000…0005/ })).toHaveAttribute("href", /^\/results\?scope=project.*task=/);
      await expect(panel.getByRole("link", { name: `Task · ${TITLE}` })).toHaveAttribute("href", new RegExp(`^/work/${TASK}\\?scope=`));
      for (const label of ["Copy repository id", "Copy base object", "Copy resulting object"])
        await expect(panel.getByRole("button", { name: label })).toBeVisible();
      await expect(panel.locator("dl code")).toHaveText(["00000000…0006", "04".repeat(6), "05".repeat(6)]);

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow).toBe(false);
      if (EVIDENCE) {
        await page.screenshot({ path: `${EVIDENCE}/after-${vp.name}.png` });
        await page.screenshot({ path: `${EVIDENCE}/after-full-${vp.name}.png`, fullPage: true });
        await panel.screenshot({ path: `${EVIDENCE}/after-panel-${vp.name}.png` });
      }
      const results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
    });

    test("title falls back to the short task id when the task read has no title", async ({ page }) => {
      await page.goto(`/decisions/${DECISION}`);
      const panel = page.locator("[data-decision-evidence]");
      await expect(panel.getByRole("heading", { level: 2 })).toHaveText("Review task 00000000");
      await expect(page.getByRole("note", { name: /Decision requested/ })).toBeVisible();
      await expect(panel.locator("ol[data-decision-criteria] > li")).toHaveCount(2);
    });

    test("superseded review shows the warning first and cannot be answered", async ({ page }) => {
      await overlay(page, { title: true, superseded: true });
      await page.goto(`/decisions/${DECISION}`);
      const panel = page.locator("[data-decision-evidence]");
      const warning = panel.getByRole("status").filter({ hasText: "newer result" });
      await expect(warning).toBeVisible();
      await expect(warning).toContainText("A newer result report exists. This review is historical and can't be answered.");
      await expect(warning.getByRole("link", { name: "View the newer report" })).toHaveAttribute("href", /^\/results\?scope=project.*task=/);
      const first = await panel.evaluate(el => el.firstElementChild?.getAttribute("role"));
      expect(first).toBe("status");
      expect(await panel.evaluate(el => el.firstElementChild?.textContent ?? "")).toContain("newer result");
      await expect(panel.locator("[data-decision-status]")).toHaveText("Historical review");
      await expect(page.getByRole("note", { name: /Decision requested/ })).toContainText("earlier result report");
      await expect(panel.getByRole("button", { name: /Approve revision/ })).toHaveCount(0);
      if (EVIDENCE) await panel.screenshot({ path: `${EVIDENCE}/after-superseded-${vp.name}.png` });
      const results = await new AxeBuilder({ page }).include("main").analyze();
      expect(results.violations).toEqual([]);
    });
  });
}
