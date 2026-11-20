import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import type { GraphEdge } from "../src/api/adapters/humanGraph";
import { graphEnvelope, graphId, graphNode, graphProject } from "../src/test/humanGraph";

const BASE = "/api/playbooks/decisions";
const HANDLE = graphId(8001);
const TASK = { ...graphNode("task", 8002), title: "Fixture: Review recovery plan", task_state: "completed" };
const DOCUMENT = {
  ...graphNode("knowledge", 8003),
  title: "Fixture: Recovery contract",
  labels: ["test:RECOVERY-1"],
  content_revision: "2",
  body: "## Recovery rules\n\nKeep one owner.\n\nWait for a stop receipt before retrying.",
};
const OLD_DOCUMENT = { ...DOCUMENT, content_revision: "1", body: "## Recovery rules\n\nKeep one owner.\n\nRetry after a timeout." };
const DRAFTS = Array.from({ length: 6 }, (_, i) => ({
  ...graphNode("task", 8010 + i),
  title: `Fixture: Draft ${i + 1}`,
  task_state: "draft",
  labels: ["test:PLAN", `sp:${i + 1}`],
}));
const ACTIVE = { ...graphNode("task", 8016), title: "Fixture: Already active", task_state: "active" };
const EXTERNAL = { ...graphNode("task", 8017), title: "Fixture: External blocker" };
const edge = (n: number, source: string, target: string, edge_type: string): GraphEdge => ({
  id: graphId(n), source, target, edge_type, description: null, version: "1", source_revision: null, target_revision: null,
});
const nodes = [TASK, ...DRAFTS, ACTIVE, EXTERNAL];
const edges = [
  ...[...DRAFTS, ACTIVE].map((node, i) => edge(8020 + i, TASK.id, node.id, "parent-child")),
  edge(8030, DRAFTS[0]!.id, DRAFTS[1]!.id, "blocks"),
  edge(8031, EXTERNAL.id, DRAFTS[2]!.id, "blocks"),
];
// A depth-one Context exposes only edges incident to the queried task.
const graphs = Object.fromEntries([TASK, ...DRAFTS].map(root => {
  const visibleEdges = edges.filter(edge => edge.source === root.id || edge.target === root.id);
  const visibleIds = new Set([root.id, ...visibleEdges.flatMap(edge => [edge.source, edge.target])]);
  return [root.id, graphEnvelope({ nodes: nodes.filter(node => visibleIds.has(node.id)), edges: visibleEdges, root_id: root.id, truncated: false })];
}));
const detailPath = `/decisions/${HANDLE}?kind=playbook`;
const question = "Fixture: Is the recovery plan ready?";
const evidence = process.env.HOST_DECISION_EVIDENCE;

async function installFixture(page: Page, options: { document?: boolean; reviews?: boolean; responder?: boolean; loseResponse?: boolean; expired?: boolean } = {}) {
  // The mock service worker owns the existing fixtures, so wrap its fetch in the page.
  await page.addInitScript(({ base, handle, task, document, prior, graphs, project, question, options }) => {
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
      status, headers: { "Content-Type": "application/json" },
    });
    let principal = "";
    let answered = false;
    const requestBodies: string[] = [];
    Object.assign(window, { hostDecisionRequests: requestBodies });
    const wrap = (inner: typeof fetch): typeof fetch => async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
      if (url.pathname === "/api/v1/bootstrap") {
        const response = await inner(input, init);
        const body = await response.json();
        principal = body.data.principal.id;
        if (options.reviews === false) {
          body.data.capabilities = body.data.capabilities.map((cap: { name: string }) =>
            cap.name === "decisions.read" ? { ...cap, enabled: false } : cap);
        }
        body.data.capabilities.push({ name: "playbooks.decisions", version: "1", enabled: true });
        return json(body);
      }
      const row = {
        namespace: { namespace_id: "00000000-0000-4000-8000-000000008005", generation: 1, name: "test", workspace_id: task.project.workspace_id, project_id: project, owner_user_id: "00000000-0000-4000-8000-000000008007" },
        handle, subject: { id: task.data.id, revision: 4 }, question, choices: ["approved", "rejected"],
        responders: [`user:${options.responder === false ? "00000000-0000-4000-8000-000000008006" : principal}`],
        expires_at_ms: Date.parse("2099-01-01T00:00:00Z"),
      };
      if (url.pathname === base) return json({ decisions: answered ? [] : [row] });
      if (url.pathname === `${base}/${handle}`) return answered ? json({ error: "not_found" }, 404)
        : json({ ...row, subject_task_id: task.data.id, produced_knowledge_ids: options.document === false ? [] : [document.data.id] });
      if (url.pathname === `${base}/${handle}/answer`) {
        if (init?.method !== "POST" || new Headers(init.headers).get("X-AQ-Request") !== "1") return json({ error: "invalid" }, 400);
        const body = String(init.body);
        requestBodies.push(body);
        if (options.expired) return json({ error: "conflict" }, 409);
        answered = true;
        if (options.loseResponse && requestBodies.length === 1) throw new TypeError("Fixture: response lost after recording");
        const { choice } = JSON.parse(requestBodies[0]!);
        return json({ outcome: choice, output: { reference: `decision:${handle}`, subject: row.subject } });
      }
      const taskPath = `/api/human/projects/${project}/tasks/`;
      if (url.pathname === taskPath + task.data.id) return json(task);
      if (url.pathname.startsWith(taskPath) && url.pathname.endsWith("/graph")) {
        const graph = graphs[url.pathname.slice(taskPath.length, -"/graph".length)];
        if (graph) return json(graph);
      }
      if (url.pathname === `/api/human/projects/${project}/knowledge/${document.data.id}`) {
        return json(url.searchParams.get("revision") === "1" ? prior : document);
      }
      return inner(input, init);
    };
    let current = wrap(window.fetch.bind(window));
    Object.defineProperty(window, "fetch", { configurable: true, get: () => current, set: (next: typeof fetch) => { current = wrap(next); } });
  }, {
    base: BASE, handle: HANDLE, task: graphEnvelope(TASK), document: graphEnvelope(DOCUMENT),
    prior: graphEnvelope(OLD_DOCUMENT), graphs, project: graphProject, question, options,
  });
}

test("desktop inbox includes playbook decisions beside reviews and displays the document and its diff", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await installFixture(page);
  await page.goto("/overview");
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: /^Decisions/ }).click();
  await expect(page.getByRole("list", { name: "Review inbox" })).toBeVisible();
  await page.getByRole("list", { name: "Playbook decisions" }).getByText(question, { exact: true }).click();

  await expect(page.getByRole("heading", { name: DOCUMENT.title })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recovery rules" })).toBeVisible();
  await expect(page.getByText("test:RECOVERY-1", { exact: true })).toBeVisible();
  await expect(page.getByText("Version 2", { exact: true })).toBeVisible();
  await page.getByText("Changes since previous version", { exact: true }).click();
  const diff = page.getByRole("list", { name: "Document changes" });
  await expect(diff.getByRole("listitem")).toHaveText([
    /Removed line 5 Retry after a timeout/,
    /Added line 5 Wait for a stop receipt before retrying/,
  ]);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  if (evidence) await page.screenshot({ path: `${evidence}/host-decision-desktop.png`, fullPage: true });
});

test("phone host-only inbox shows the empty document state and draft dependencies including a points total", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installFixture(page, { document: false, reviews: false });
  await page.goto("/overview");
  await page.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("list", { name: "More destinations" }).getByRole("link", { name: /^Decisions/ }).click();
  await page.getByRole("list", { name: "Playbook decisions" }).getByRole("link").click();

  await expect(page.getByRole("link", { name: "All decisions" })).toBeVisible();
  await expect(page.getByText("No document produced", { exact: true })).toBeVisible();
  const table = page.getByRole("table", { name: "Draft child tasks" });
  await expect(table.locator("tbody tr")).toHaveCount(6);
  await expect(table.getByRole("row", { name: /^Fixture: Draft 2/ }).getByRole("link", { name: "Fixture: Draft 1" })).toBeVisible();
  await expect(table.getByRole("row", { name: /^Fixture: Draft 3/ }).getByRole("link", { name: EXTERNAL.title })).toBeVisible();
  await expect(table.getByRole("row", { name: /Total points shown/ })).toContainText("21");
  const task = table.getByRole("link", { name: "Fixture: Draft 6" });
  await expect(task).toHaveAttribute("href", `/work/${DRAFTS[5]!.id}?scope=project%3A${graphProject}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  expect((await new AxeBuilder({ page }).include("main").analyze()).violations).toEqual([]);
  if (evidence) {
    await page.screenshot({ path: `${evidence}/host-decision-phone.png` });
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/host-decision-phone-tasks.png` });
  }
  await page.getByRole("link", { name: "All decisions" }).click();
  await expect(page.getByRole("list", { name: "Playbook decisions" })).toBeVisible();
  await page.getByRole("list", { name: "Playbook decisions" }).getByRole("link").click();
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(table).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
});

test("requesting changes requires a note and a lost response can recover the same answer", async ({ page }) => {
  await installFixture(page, { loseResponse: true });
  await page.goto(detailPath);
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Request changes", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Add a note explaining the requested changes.");
  const note = page.getByRole("textbox", { name: "Decision note" });
  await expect(note).toBeFocused();
  await note.fill("Fixture: include the recovery logs.");
  await page.getByRole("button", { name: "Request changes", exact: true }).click();
  await expect(note).toBeDisabled();
  await page.getByRole("button", { name: "Retry same answer" }).click();

  await expect(page.getByText("Request for changes recorded.", { exact: true })).toBeVisible();
  const bodies = await page.evaluate(() => (window as Window & { hostDecisionRequests?: string[] }).hostDecisionRequests);
  const body = JSON.stringify({ choice: "rejected", note: "Fixture: include the recovery logs." });
  expect(bodies).toEqual([body, body]);
  await expect(page.getByRole("list", { name: "Playbook decisions" })).toHaveCount(0);
  await page.getByRole("navigation", { name: "Primary", exact: true }).getByRole("link", { name: "Decisions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Choose a review", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("This item does not exist or is not available to you.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("a viewer outside the responder list can inspect the question", async ({ page }) => {
  await installFixture(page, { responder: false });
  await page.goto(detailPath);
  await expect(page.getByText(question, { exact: true }).last()).toBeVisible();
  await expect(page.getByText("Only a listed responder can answer this decision.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);
});

test("a decision the server reports as closed cannot be answered again", async ({ page }) => {
  await installFixture(page, { expired: true });
  await page.goto(detailPath);
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  await approve.click();
  await expect(page.getByRole("alert").filter({ hasText: "This decision is no longer open for answering." })).toBeVisible();
  await expect(approve).toBeDisabled();
});
