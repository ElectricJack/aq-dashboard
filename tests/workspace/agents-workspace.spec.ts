import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import bootstrap from "../../contracts/proposed/bootstrap.json" with { type: "json" };
import requirements from "../../src/app/bundle-requirements.json" with { type: "json" };
import { SWARM_MOCKUP } from "../../src/mocks/swarm";

// Labelled deterministic fixtures: actual browser, xterm and client transport;
// HTTP and WebSocket peers below are simulated, never the owner's live agents.
const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const project = uuid(1), repository = uuid(2);
const now = () => Date.now();
const sessions = () => Array.from({ length: 5 }, (_, i) => ({
  id: uuid(10 + i), node_id: SWARM_MOCKUP.machines[0]!.nodes[i % 2]!.node.id,
  project_id: project, spec: { project_name: `Fixture agent ${i + 1}`, repository_id: repository,
    provider: i % 2 ? "openai" : "anthropic", model: i % 2 ? "Fixture Codex" : "Fixture Claude" },
  status: "running", stage: "Running", desired_running: true,
  created_at_ms: now() - 86_400_000 * 3, updated_at_ms: now(), worker_seen_at_ms: now(),
}));

async function fixture(page: Page, hostEnabled = false) {
  let hostShell: null | {id:string;status:string;desired_running:boolean} = null;
  const hostInputs: string[] = [], hostStops: string[] = [];
  const agents = sessions(), connects = new Map<string, number>(), inputs = new Map<string, string>();
  const sockets = new Map<string, WebSocketRoute>(), stops: string[] = [], sizes: number[][] = [];
  const chunks = Array.from({ length: 40 }, (_, i) => ({ sequence: i + 1,
    text: i === 31 ? "ébegin needle" : i === 32 ? " across pages 🐈\n" : `Fixture retained line ${i + 1}\n` }));
  const archive = (id = agents[0]!.id) => ({ ...agents.find(a => a.id === id)!, archive: { state: "complete", coverage: "complete", reason: null,
    first_sequence: 1, last_sequence: 40, bytes: Buffer.byteLength(chunks.map(c => c.text).join("")), updated_at_ms: now() } });
  await page.route(url => url.pathname.startsWith("/api/"), async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const scope = url.searchParams.get("scope");
    const envelope = { ...bootstrap, api_version: "dashboard-read-1", server_time: new Date().toISOString(),
      scope: scope?.startsWith("project:") ? {kind:"project",project_id:scope.slice(8)} : {kind:"all_authorized"} };
    let json: unknown;
    if (path === "/api/v1/bootstrap") json = { ...envelope, data: { ...bootstrap.data,
      principal: { ...bootstrap.data.principal, display_name: "Fixture owner" },
      contracts: [{name:"dashboard-read",version:"dashboard-read-1",digest:`sha256:${"0".repeat(64)}`}],
      capabilities: [...new Set([...requirements.required_capabilities,"swarm.read",...(hostEnabled?["swarm.worker.control"]:[])])].map(name => ({ name, version: "1", enabled: ["sessions.read", "swarm.read", "tasks.create", "projects.read", ...(hostEnabled?["swarm.worker.control"]:[])].includes(name), reason:"Disabled in this fixture" })) } };
    else if (path === "/api/v1/swarm") json = { ...envelope, data: { ...SWARM_MOCKUP, machines: SWARM_MOCKUP.machines.map(m => ({ ...m, nodes: m.nodes.map(n => ({ ...n, agents: [] })) })) } };
    else if (path === "/api/v1/projects" || path === "/api/v1/sessions") json = { ...envelope, data: { items: path.endsWith("projects") ? [{ id: project, label: "Fixture project" }] : [], next_cursor: null, has_more: false, snapshot_id: "fixture", total: { value: path.endsWith("projects") ? 1 : 0, accuracy: "exact" } } };
    else if (path.startsWith("/api/worker-terminals/") && !path.includes("/terminal/")) {
      if (path.endsWith("/stop")) { hostStops.push(hostShell!.id); hostShell!.desired_running=false; hostShell!.status="ended"; }
      else if (request.method()==="POST" && !hostShell?.desired_running) hostShell={id:uuid(99),status:"running",desired_running:true};
      json={ready:true,node_name:"Fixture WSL worker",shell:hostShell};
    }
    else if (path === "/api/manual-agents") json = { sessions: agents, workers: [], slots: [], projects: [], server_time_ms: now() };
    else if (path === "/api/manual-agents/history") json = { sessions: [archive()], next_cursor: null, server_time_ms: now() };
    else if (path.endsWith("/transcript/search")) {
      const text = chunks.map(c => c.text).join(""), q = url.searchParams.get("q") ?? "";
      json = { matches: [{ offset: Buffer.byteLength(text.slice(0, text.indexOf(q))), length: Buffer.byteLength(q), sequence: 32, excerpt: q }], next_after: null, has_more: false, through_sequence: 40, server_time_ms: now() };
    } else if (path.endsWith("/transcript")) {
      const after = Number(url.searchParams.get("after") ?? 0), limit = Number(url.searchParams.get("limit") ?? 32), end = Math.min(after + limit, 40);
      json = { session: archive(path.split("/")[3]), chunks: chunks.slice(after, end), next_after: end, has_more: end < 40, through_sequence: 40, server_time_ms: now() };
    } else if (path.endsWith("/terminal/connect")) {
      const id = path.split("/")[3]!; connects.set(id, (connects.get(id) ?? 0) + 1); json = { generation: connects.get(id) };
    } else if (path.endsWith("/stop")) {
      const id = path.split("/")[3]!; stops.push(id); const a = agents.find(a => a.id === id)!; a.status = "stopped"; a.desired_running = false; json = a;
    } else {
      await route.fulfill({ status: 404, json: { error: "fixture_not_supported" } }); return;
    }
    await route.fulfill({ json });
  });
  await page.routeWebSocket(/\/api\/manual-agents\/.*\/terminal\/live/, ws => {
    const id = new URL(ws.url()).pathname.split("/")[3]!; sockets.set(id, ws);
    ws.onMessage(message => {
      if (typeof message === "string") { const v = JSON.parse(message); if (v.kind === "resize") sizes.push([v.columns, v.rows]); }
      else { inputs.set(id, (inputs.get(id) ?? "") + message.toString()); ws.send(message); }
    });
    ws.send(JSON.stringify({ kind: "ready", server_time_ms: now() }));
    ws.send(Buffer.from(`\x1b[2J\x1b[HFixture live terminal ${id.slice(-2)}\r\n$ `));
  });
  await page.routeWebSocket(/\/api\/worker-terminals\/shells\/.*\/terminal\/live/, ws=>{
    ws.onMessage(message=>{if(typeof message!=="string"){hostInputs.push(message.toString());ws.send(message);}});
    ws.send(JSON.stringify({kind:"ready",server_time_ms:now()}));ws.send(Buffer.from("\r\nFixture host shell\r\n$ "));
  });
  return { hostInputs, hostStops, agents, connects, inputs, sockets, stops, sizes, chunks };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function openFour(page: Page) {
  const roster = page.getByRole("complementary", { name: "Agent roster" });
  for (let i = 1; i <= 4; i++) await roster.getByRole("button", { name: `Add Fixture agent ${i} to workspace` }).click();
  await expect(page.locator("[data-interactive-terminal][data-controlling]")).toHaveCount(4);
}

test("four live panes isolate input and keep attachments across focus, search, layout, close and stop", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const f = await fixture(page);
  await page.goto("/agents"); await openFour(page);
  const rail = page.getByRole("navigation", { name: "Primary", exact: true });
  expect((await rail.getByRole("link").allTextContents()).slice(0, 4)).toEqual(["Overview", "Supervisor", "Agents", "Work"]);
  for (let i = 0; i < 4; i++) {
    const terminal = page.getByRole("region", { name: `Fixture agent ${i + 1} terminal output`, exact: true });
    await terminal.locator(".xterm-helper-textarea").focus(); await page.keyboard.type(`only-${i + 1}`);
    await expect.poll(() => f.inputs.get(f.agents[i]!.id)).toBe(`only-${i + 1}`);
  }
  const counts = [...f.connects];
  await page.getByRole("textbox", { name: "Search agents" }).fill("fixture");
  await page.getByRole("region", { name: "Fixture agent 1 terminal", exact: true }).getByRole("button", { name: "Expand" }).click();
  await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
  await page.getByRole("button", { name: "Restore" }).click();
  await page.getByRole("button", { name: "Add Fixture agent 5 to workspace" }).click();
  await expect(page.getByRole("alert")).toHaveText("Close a pane before adding another agent.");
  await expect(page.locator("[data-interactive-terminal]")).toHaveCount(4);
  expect([...f.connects]).toEqual(counts);
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("terminals-1440.png") });
  const a11y = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(a11y.violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(", ")}`)).toEqual([]);
  await page.getByRole("button", { name: "Close Fixture agent 1 pane" }).click();
  expect(f.stops).toEqual([]);
  const second = page.getByRole("region", { name: "Fixture agent 2 terminal", exact: true });
  await second.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(second.getByText(/Ended/).first()).toBeVisible();
  await expect(second.getByRole("link", { name: "History" })).toHaveAttribute("href", new RegExp(`session=manual%3A${f.agents[1]!.id}`));
  expect(f.stops).toEqual([f.agents[1]!.id]);
  expect(f.sizes.every(([cols, rows]) => cols >= 80 && rows >= 8)).toBe(true);
});

test("tablet and phone switches preserve panes and an expanded terminal always has a visible exit", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto("/agents"); await openFour(page);
  const counts = [...f.connects];
  for (const [width, height] of [[900, 1000], [390, 844], [320, 740]]) {
    await page.setViewportSize({ width: width!, height: height! });
    const switcher = page.getByRole("navigation", { name: "Open terminals" });
    await switcher.getByRole("button", { name: "Fixture agent 2" }).click();
    const second = page.getByRole("region", { name: "Fixture agent 2 terminal", exact: true });
    await expect(second).toBeVisible();
    await second.getByRole("button", { name: "Expand" }).click();
    await switcher.getByRole("button", { name: "Fixture agent 3" }).click();
    await expect(page.getByRole("region", { name: "Fixture agent 3 terminal", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restore" })).toBeInViewport();
    await page.getByRole("button", { name: "Restore" }).click();
    if (width! < 768) {
      const current = page.getByRole("region", {name:"Fixture agent 3 terminal output",exact:true});
      await expect(current.getByRole("button", {name:"Type",exact:true})).toBeInViewport({ratio:1});
      await expect(current.getByRole("button", {name:"Ctrl",exact:true})).toBeInViewport({ratio:1});
      const key = await current.getByRole("button", {name:"Type",exact:true}).boundingBox();
      const pane = await page.getByRole("region", {name:"Fixture agent 3 terminal",exact:true}).boundingBox();
      expect(key!.y + key!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
    }
    await noOverflow(page);
    await page.screenshot({ path: test.info().outputPath(`terminals-${width}.png`) });
  }
  expect([...f.connects]).toEqual(counts);
  expect(f.sizes.every(([cols, rows]) => cols >= 80 && rows >= 8)).toBe(true);
});

test("retained history finds unloaded cross-page text and downloads the whole archive", async ({ page }) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/agents/sessions?scope=project:${project}&session=manual:${f.agents[0]!.id}`);
  await expect(page).toHaveURL(/\/agents\/history\?/);
  const output = page.getByLabel("Terminal transcript", { exact: true });
  await expect(output).toContainText("Fixture retained line 1");
  await page.getByRole("textbox", { name: "Find", exact: true }).fill("needle across pages");
  await page.getByRole("button", { name: "Find", exact: true }).click();
  await expect(output.locator("mark")).toHaveText("needle across pages");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download retained output" }).click();
  const saved = await download, stream = await saved.createReadStream(), parts: Buffer[] = [];
  for await (const part of stream!) parts.push(Buffer.from(part));
  expect(Buffer.concat(parts).toString()).toBe(f.chunks.map(c => c.text).join(""));
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("history-1440.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "← Sessions" })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: test.info().outputPath("history-390.png") });
  await page.getByRole("button", { name: "← Sessions" }).click();
  await expect(page.getByRole("textbox", { name: "Search sessions" })).toBeVisible();
  expect(f.connects.size).toBe(0);
});

test("connection loss freezes only its pane and explicit reconnect never replays input", async ({page}) => {
  const f = await fixture(page);
  await page.setViewportSize({width:1440,height:1000}); await page.goto('/agents'); await openFour(page);
  const id = f.agents[0]!.id;
  const terminal = page.getByRole('region',{name:'Fixture agent 1 terminal output',exact:true});
  await terminal.locator('.xterm-helper-textarea').focus(); await page.keyboard.type('before-loss');
  await expect.poll(()=>f.inputs.get(id)).toBe('before-loss');
  await expect(terminal.locator('.xterm-rows')).toContainText('before-loss');
  await f.sockets.get(id)!.close({code:1000,reason:'Fixture disconnect'});
  await expect(terminal.getByRole('figure',{name:'Last observation'})).toContainText('before-loss');
  await expect(page.locator('[data-interactive-terminal][data-controlling]')).toHaveCount(3);
  await page.keyboard.type('never-replay');
  expect(f.inputs.get(id)).toBe('before-loss');
  await terminal.getByRole('button',{name:'Reconnect',exact:true}).click();
  await expect(page.locator('[data-interactive-terminal][data-controlling]')).toHaveCount(4);
  expect(f.connects.get(id)).toBe(2);
  expect(f.agents.slice(1,4).map(a=>f.connects.get(a.id))).toEqual([1,1,1]);
  expect(f.inputs.get(id)).toBe('before-loss');
});

test("preview serves every asset recorded in its production manifest", async ({ request }) => {
  test.skip(!!process.env.WORKSPACE_PREVIEW_URL, "External development preview is not a production bundle");
  const response = await request.get("/dashboard-manifest.json"); expect(response.ok()).toBe(true);
  const manifest = await response.json();
  for (const [path, entry] of Object.entries(manifest.files) as [string, { sha256: string }][]) {
    const asset = await request.get(`/${path}`); expect(asset.ok()).toBe(true);
    expect(createHash("sha256").update(await asset.body()).digest("hex")).toBe(entry.sha256);
  }
  await test.info().attach("served-bundle", { body: JSON.stringify(manifest, null, 2), contentType: "application/json" });
});


test("worker host shell has phone keys, detaches on leaving and ends independently of agents",async({page})=>{
 const f=await fixture(page,true);const route=`/agents/worker/${uuid(500)}`;
 await page.goto(route);await page.getByRole('button',{name:'Open terminal',exact:true}).click();
 await expect(page.getByRole('region',{name:'Worker host terminal',exact:true})).toBeVisible();
 await expect(page.locator('[data-interactive-terminal][data-controlling]')).toHaveCount(1);
 const terminal=page.getByRole('region',{name:'Worker host terminal',exact:true});
 await terminal.locator('.xterm-helper-textarea').focus();await page.keyboard.insertText('host-only');
 await expect.poll(()=>f.hostInputs.join('')).toBe('host-only');expect([...f.inputs.values()]).toEqual([]);
 await page.screenshot({path:test.info().outputPath('host-terminal-1440.png')});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await expect(terminal.getByRole('button',{name:'Type',exact:true})).toBeVisible();
  await expect(terminal.getByRole('button',{name:'Ctrl',exact:true})).toBeVisible();await noOverflow(page);
  await page.screenshot({path:test.info().outputPath(`host-terminal-${width}.png`)});
 }
 await page.getByRole('link',{name:'← Swarm',exact:true}).click();expect(f.hostStops).toEqual([]);
 await page.goto(route);await expect(page.locator('[data-interactive-terminal][data-controlling]')).toHaveCount(1);
 await page.getByRole('button',{name:'End shell',exact:true}).click();
 await expect(page.getByRole('button',{name:'Open terminal',exact:true})).toBeVisible();
 expect(f.hostStops).toHaveLength(1);expect(f.stops).toEqual([]);
});
