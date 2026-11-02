#!/usr/bin/env node
// Deterministic fixture review of the production bundle. No AQ writes are sent.
import { chromium, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { supervisorActor, supervisorDiscovery, supervisorHistory, supervisorMessage } from "../src/test/supervisor.ts";
import { graphEnvelope, graphNode, graphProject, graphId } from "../src/test/humanGraph.ts";
import { decisionDetail, decisionPage, decisionId } from "../src/test/decisions.ts";
const origin = process.env.AQ_PREVIEW_URL ?? "http://127.0.0.1:4192";
const output = process.env.AQ_VISUAL_OUTPUT ?? "docs/implementation/evidence/G12";
const fixture = JSON.parse(await readFile(new URL("../contracts/live/fixtures/bootstrap.json", import.meta.url), "utf8"));
const requirements = JSON.parse(await readFile(new URL("../src/app/bundle-requirements.json", import.meta.url), "utf8"));
const manifest = await readFile(new URL("../dist/dashboard-manifest.json", import.meta.url));
const manifestDigest = `sha256:${createHash("sha256").update(manifest).digest("hex")}`;
const enabled = new Set(["supervisor.history.read", "supervisor.message.enqueue", "human.graph.read", "tasks.read", "tasks.create", "projects.read", "decisions.read", "decisions.resolve"]);
const browser = await chromium.launch({ headless: true }); await mkdir(output, { recursive: true });
const errors = [], writes = [], views = []; let page; let interceptedDecisionRefusals = 0;
async function capture(name) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  await page.screenshot({ path: join(output, name) });
}
try {
  for (const [name, width, height] of [["desktop",1440,1000],["phone",390,844],["narrow",320,740]]) {
    page = await browser.newPage({ viewport: { width, height } }); page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    let digest = manifestDigest; let decisions = false;
    await page.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (decisions && request.method() === "POST" && path.endsWith("/resolve")) { interceptedDecisionRefusals++; return route.fulfill({status:426,body:""}); }
      if (request.method() !== "GET") { writes.push(path); return route.fulfill({status:503,body:'{}'}); }
      let body;
      if (path === "/api/v1/bootstrap") body = { ...fixture, data: { ...fixture.data, principal: { ...fixture.data.principal, id: supervisorActor, display_name: "G12 fixture owner" }, product: { ...fixture.data.product, dashboard_digest: digest }, capabilities: requirements.required_capabilities.map(name => ({ name, version: "1", enabled: enabled.has(name), reason: "Unavailable in this G12 fixture" })) } };
      else if (path === "/api/v1/projects") body = { ...fixture, data: { items: [{ id: graphProject, label: "G12 fixture project" }], next_cursor: null, has_more: false, snapshot_id: "fixture", total: { value: 1, accuracy: "exact" } } };
      else if (path === "/api/projects") body = { items: [], next_cursor: null };
      else if (path === "/api/human/conversations/global") body = supervisorDiscovery;
      else if (path.endsWith(`/conversations/${supervisorDiscovery.conversation.id}/messages`)) body = supervisorHistory([supervisorMessage(1, "G12 fixture: retained human message. This conversation has no connected supervisor runtime.")]);
      else if (path === "/api/reviews/decisions") body = decisionPage();
      else if (path === `/api/reviews/decisions/${decisionId(1)}`) { body = decisionDetail(); body.request.eligible_owners = [supervisorActor]; }
      else if (path.endsWith("/graph")) body = graphEnvelope({root_id:graphId(10),nodes:[graphNode("task")],edges:[],truncated:false});
      else if (path === `/api/human/projects/${graphProject}/tasks/${graphId(10)}`) body = graphEnvelope(graphNode("task"));
      else if (path === `/api/human/projects/${graphProject}/tasks`) body = graphEnvelope({ items: [{ ...graphNode("task"), title: "G12 fixture task: verify safe dashboard update" }], next_cursor: null });
      if (body) return route.fulfill({ json: body });
      return route.fulfill({ status: 503, json: { message: "Unavailable in G12 fixture" } });
    });
    await page.clock.install();
    await page.goto(`${origin}/supervisor`);
    const input = page.getByRole("textbox", { name: "Message the global supervisor", exact: true });
    await expect(input).toBeVisible(); await input.fill("G12 fixture unsent draft: preserve my text after Reload.");
    digest = `sha256:${"b".repeat(64)}`; await page.clock.fastForward(30_001);
    const notice = page.getByRole("note", { name: "Dashboard version" });
    await expect(notice).toContainText("A new dashboard version is available"); await expect(input).toHaveValue(/preserve my text/);
    await capture(`supervisor-update-${name}.png`);
    const nav = page.getByRole("navigation", { name: name === "desktop" ? "Primary" : "Primary (compact)", exact: true });
    await expect(nav).toBeVisible(); await expect(notice.getByRole("button", { name: "Reload" })).toBeInViewport();
    await notice.getByRole("button", { name: "Reload" }).click(); await page.waitForLoadState("domcontentloaded");
    await expect(input).toHaveValue("G12 fixture unsent draft: preserve my text after Reload."); await expect(notice).toHaveCount(0);
    await capture(`supervisor-restored-${name}.png`);
    await page.goto(`${origin}/work?scope=project:${graphProject}`);
    await page.getByRole("button", { name: "Create task", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Create task", exact: true });
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("G12 fixture unsent task");
    await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Keep this description through an explicit reload.");
    await dialog.getByRole("textbox", { name: "Acceptance criteria", exact: true }).fill("All fields return; no task is submitted.");
    await dialog.getByRole("combobox", { name: "Initial task state" }).selectOption("active");
    await capture(`task-draft-${name}.png`);
    const create = dialog.getByRole("button", { name: "Create task", exact: true }); await create.scrollIntoViewIfNeeded(); await expect(create).toBeInViewport();
    if (name === "narrow") await capture("task-controls-narrow.png");
    await page.keyboard.press("Escape");
    digest = `sha256:${"c".repeat(64)}`; await page.clock.fastForward(30_001); await expect(notice).toBeVisible();
    await capture(`work-update-${name}.png`); await notice.getByRole("button", { name: "Reload" }).click();
    await page.waitForLoadState("domcontentloaded"); await page.getByRole("button", { name: "Create task", exact: true }).click();
    await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("G12 fixture unsent task");
    await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Keep this description through an explicit reload.");
    await expect(dialog.getByRole("textbox", { name: "Acceptance criteria", exact: true })).toHaveValue("All fields return; no task is submitted.");
    await expect(dialog.getByRole("combobox", { name: "Initial task state" })).toHaveValue("active");
    expect(page.url()).not.toMatch(/unsent|description|criteria/); expect(writes).toEqual([]);
    await page.keyboard.press("Escape");
    await page.goto(`${origin}/work?scope=project:${graphProject}&operation=${graphId(99)}`);
    const recovered = page.getByRole("region", { name: "Recovered local task draft" });
    await expect(recovered.getByRole("textbox", { name: "Title", exact: true })).toHaveValue("G12 fixture unsent task");
    await expect(recovered.getByRole("textbox", { name: "Title", exact: true })).toHaveAttribute("readonly");
    await expect(page.getByRole("button", { name: "Retry exact submission" })).toHaveCount(0);
    await capture(`task-recovered-${name}.png`); expect(writes).toEqual([]);
    await page.getByRole("button", {name:"Check status",exact:true}).scrollIntoViewIfNeeded();
    await expect(page.getByRole("button", {name:"Check status",exact:true})).toBeInViewport();
    if (name !== "desktop") await capture(`task-recovered-controls-${name}.png`);
    await page.keyboard.press("Escape");
    await page.goto(`${origin}/work/${graphId(10)}?scope=project:${graphProject}&view=graph`);
    const graph = page.getByRole("region", {name:"Scrollable task graph"}); await expect(graph).toBeVisible();
    await graph.getByRole("link", {name:/Implement recovery/}).click();
    await expect(page.getByRole("heading", {name:"Implement recovery",exact:true})).toBeVisible();
    if (name === "desktop") await page.getByRole("navigation", {name:"Primary",exact:true}).getByRole("link", {name:"Work",exact:true}).click();
    else await page.getByRole("link", {name:"All tasks",exact:true}).click();
    await expect(page.getByRole("region", {name:"1 tasks loaded",exact:true})).toBeVisible();
    await expect(graph).toHaveCount(0);
    decisions = true; await page.goto(`${origin}/decisions/${decisionId(1)}`);
    const decisionNote = page.getByRole("textbox", {name:"Decision note",exact:true}); await decisionNote.fill("G12 fixture review note: preserve after upgrade refusal.");
    await page.getByRole("button", {name:"Approve revision 1",exact:true}).click();
    await expect(notice).toContainText("Install compatible versions, then reload."); await expect(decisionNote).toHaveValue(/preserve after upgrade refusal/);
    await expect(page.getByRole("button", {name:"Retry same answer"})).toHaveCount(0);
    await capture(`decision-upgrade-${name}.png`);
    await page.evaluate(() => window.scrollTo(0, 0)); await capture(`decision-upgrade-top-${name}.png`);
    views.push({ name, width, height, graph_navigation_and_exit: true, decision_refusal_retains_note_and_evidence: true, recovered_uncertain_text_visible_without_replay: true, explicit_reload_restores_both_composers: true, no_horizontal_overflow: true, visible_navigation_and_reload: true }); await page.close();
  }
  expect(errors).toEqual([]); expect(writes).toEqual([]);
  const result = { passed: true, fixture: "G12 labelled deterministic fixtures intercepted at HTTP boundary; production bundle served unchanged", origin, manifest_digest: manifestDigest, views, mutations: writes, intercepted_decision_refusals: interceptedDecisionRefusals, page_errors: errors };
  await writeFile(join(output, "browser-result.json"), JSON.stringify(result,null,2)+"\n"); console.log(JSON.stringify(result));
} catch (error) { if (page && !page.isClosed()) await page.screenshot({ path: join(output,"failure.png") }); throw error; }
finally { await browser.close(); }
