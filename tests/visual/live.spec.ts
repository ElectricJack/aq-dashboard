// G11 live captures: the compiled bundle (`pnpm build`) served by `pnpm preview` and proxied to a
// local daemon (AQ_DAEMON_URL). Run with AQ_VISUAL_LIVE_URL=<preview origin> and, optionally,
// AQ_VISUAL_LIVE_PROJECT=<project id> / AQ_VISUAL_LIVE_TASK=<task id>.
// Read-only: any request other than GET/HEAD fails the test. The served bundle must equal dist/.
import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { AXE_TAGS, VIEWPORTS, settle } from "./pages";

const OUTPUT = join(process.env.VISUAL_OUTPUT ?? "test-results/visual", "live");
mkdirSync(OUTPUT, { recursive: true });
const project = process.env.AQ_VISUAL_LIVE_PROJECT ?? "e0000000-0000-4000-8000-000000000002";
const task = process.env.AQ_VISUAL_LIVE_TASK ?? "e0000000-0000-4000-8000-000000000004";
const scope = `scope=project:${project}`;
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

const LIVE = [
  { id: "overview", path: `/overview?${scope}` },
  { id: "work", path: `/work/${task}?${scope}` },
  { id: "decisions", path: "/decisions" },
  { id: "supervisor-full", path: "/supervisor" },
  { id: "playbooks", path: "/playbooks" },
  { id: "knowledge", path: `/knowledge?${scope}` },
  { id: "agents", path: "/agents" },
  { id: "results", path: "/results" },
  { id: "settings", path: "/settings" },
];

test("served bundle is the compiled dist bundle", async ({ request }) => {
  const served = await request.get("/dashboard-manifest.json");
  expect(served.status()).toBe(200);
  const bytes = await served.body();
  const local = readFileSync("dist/dashboard-manifest.json");
  expect(sha(bytes)).toBe(sha(local));
  const manifest = JSON.parse(bytes.toString()) as { files: Record<string, { sha256: string }> };
  for (const [path, entry] of Object.entries(manifest.files)) {
    const asset = await request.get(`/${path}`);
    expect(asset.status(), path).toBe(200);
    expect(sha(await asset.body()), path).toBe(entry.sha256);
  }
  writeFileSync(join(OUTPUT, "bundle.json"), JSON.stringify({ manifest_sha256: sha(bytes), files: Object.keys(manifest.files).length }, null, 2) + "\n");
});

for (const vp of VIEWPORTS) {
  test.describe(vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    for (const surface of LIVE) {
      test(`${surface.id} renders live data read-only and passes axe`, async ({ page }) => {
        const errors: string[] = [], writes: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => { if (!["GET", "HEAD"].includes(r.method())) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
        await page.goto(surface.path);
        await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
        await page.waitForLoadState("networkidle");
        await settle(page);
        // Live captures never carry the mock label or fixture facts.
        await expect(page.getByText("Mock data", { exact: true })).toHaveCount(0);
        await expect(page.getByText("[Fixture]")).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
        await page.screenshot({ path: join(OUTPUT, `${surface.id}-${vp.name}.png`) });
        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(", ")}`)).toEqual([]);
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
      });
    }
  });
}
