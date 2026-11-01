import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const started = Date.now();
const origin = process.env.AQ_LIVE_URL, artifact = process.env.AQ_LIVE_LOADED_ARTIFACT, bundleDigest = process.env.AQ_LIVE_BUNDLE_MANIFEST_SHA256;
if (!origin || !artifact || !/^sha256:[0-9a-f]{64}$/.test(artifact) || !/^[0-9a-f]{64}$/.test(bundleDigest ?? "")) throw new Error("Explicit configured fixture URL, actual loaded artifact and verified bundle digest required");
const url = new URL(origin); if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Disposable loopback fixture only");
const output = process.env.AQ_LIVE_OUTPUT_DIR ?? "/tmp/aq-loaded-playbooks-browser";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [], mutations = [], foreign = []; let reads = 0, startupEngineReads = 0, intentionalRunsReads = 0, definitionsView = true;
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => { if (new URL(request.url()).origin !== url.origin) foreign.push(request.url()); if (!["GET", "HEAD"].includes(request.method())) mutations.push(request.method()); if (request.url().includes("/inspection/loaded-definitions")) reads++; if (/\/api\/playbooks\/(inspection\/(runs|admissions)|runs|bindings|status)(\/|\?|$)/.test(request.url())) { if (definitionsView) startupEngineReads++; else intentionalRunsReads++; } });
try {
  const bootstrap = await (await page.request.get(new URL("/api/v1/bootstrap", origin).href)).json();
  const capability = bootstrap.data.capabilities.find(cap => cap.name === "playbooks.loaded-definitions.read");
  expect(capability?.enabled).toBe(true); expect(capability?.version).toBe("1");
  expect(bootstrap.data.product.dashboard_digest).toBe(`sha256:${bundleDigest}`);
  const actual = await (await page.request.get(new URL("/api/playbooks/inspection/loaded-definitions", origin).href)).json();
  expect(actual.source).toBe("runtime_startup_configuration"); expect(actual.current_catalog).toBe(false);
  expect(actual.items.map(item => item.artifact)).toEqual([artifact]);
  const definition = actual.items.find(item => item.artifact === artifact); expect(definition).toBeTruthy();
  await page.goto(new URL("/playbooks?view=definitions", origin).href);
  const list = page.getByRole("list", { name: "Loaded playbook definitions" });
  await expect(list).toBeVisible(); await list.getByRole("button", { name: `Inspect definition ${definition.name}`, exact: true }).click();
  const detail = page.getByRole("region", { name: `Definition ${definition.name}`, exact: true });
  await expect(detail).toBeVisible();
  const pins = detail.getByRole("region", { name: "Immutable artifact", exact: true });
  for (const [label, value] of [["Artifact", artifact], ["Executable fingerprint", definition.executable_fingerprint], ["Source digest", definition.source_digest], ["Compiler", definition.compiler]]) {
    await expect(pins.getByText(label, { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(value);
  }
  await expect(detail.getByRole("region", { name: "Purpose", exact: true }).getByText(definition.purpose || "No purpose text was supplied.", { exact: true })).toBeVisible();
  const entries = detail.getByRole("region", { name: "Entry points", exact: true });
  for (const entry of definition.entries) await expect(entries.getByText(entry, { exact: true })).toBeVisible();
  const dependencies = detail.getByRole("region", { name: "Declared dependencies", exact: true });
  for (const [name, pin] of Object.entries(definition.dependency_pins)) {
    await expect(dependencies.getByText(name, { exact: true })).toBeVisible();
    await expect(dependencies.getByText(name, { exact: true }).locator("xpath=following-sibling::dd[1]")).toHaveText(pin);
  }
  await expect(page.getByRole("button", { name: /^(activate|install|create playbook)$/i })).toHaveCount(0);
  await expect(detail.getByText("This startup configuration does not report current installation or activation.", { exact: true })).toBeVisible();
  await page.screenshot({ path: join(output, "loaded-definitions-desktop.png"), fullPage: true });
  await page.reload(); await expect(detail.getByText(artifact, { exact: true })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(detail).toBeVisible(); await expect(list).toBeHidden();
    await expect(page.getByRole("button", { name: "All definitions", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    await page.screenshot({ path: join(output, `loaded-definitions-${width}.png`) });
    await page.getByRole("button", { name: "All definitions", exact: true }).click();
    await expect(list).toBeVisible();
    await expect(list.getByRole("button", { name: `Inspect definition ${definition.name}`, exact: true })).toBeFocused();
    await list.getByRole("button", { name: `Inspect definition ${definition.name}`, exact: true }).click();
  }
  expect(startupEngineReads).toBe(0); definitionsView = false;
  await page.getByRole("button", { name: "Runs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Recent runs", exact: true })).toBeVisible();
  await expect(page.getByText("No runs recorded in this configured namespace.", { exact: true })).toBeVisible();
  expect(errors).toEqual([]); expect(mutations).toEqual([]); expect(foreign).toEqual([]);
  await writeFile(join(output, "result.json"), JSON.stringify({ passed: true, elapsed_ms: Date.now() - started, artifact, bundle_manifest_sha256: bundleDigest, source: actual.source, current_catalog: false, loaded_definitions: actual.items.length, browser_reads: reads, startup_view_engine_reads: startupEngineReads, intentional_runs_view_reads: intentionalRunsReads, mutations, foreign_requests: foreign, errors, viewports: [1440, 390, 320], max_name_length: definition.name.length, max_entry_length: Math.max(...definition.entries.map(entry => entry.length)), max_dependency_alias_length: Math.max(0, ...Object.keys(definition.dependency_pins).map(name => name.length)), browser_interception: false }, null, 2) + "\n");
} finally { await browser.close(); }
