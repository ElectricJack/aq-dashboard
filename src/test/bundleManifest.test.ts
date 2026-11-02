// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, test } from "vitest";

const manifestScript = resolve("scripts/bundle-manifest.mjs");
const archiveScript = resolve("scripts/release-archive.mjs");
const temporary: string[] = [];
const hash = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dashboard-release-"));
  temporary.push(root);
  mkdirSync(join(root, "dist/assets"), { recursive: true });
  writeFileSync(join(root, ".gitignore"), "dist/\n");
  writeFileSync(join(root, "package.json"), JSON.stringify({ version: "0.1.0", packageManager: "pnpm@10.34.5" }));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(join(root, "dist/index.html"), '<script src="/assets/app.js"></script>');
  writeFileSync(join(root, "dist/assets/app.js"), 'console.log("release");');
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--quiet"); git("add", "."); git("commit", "--quiet", "-m", "fixture");
  const run = (script: string, ...args: string[]) => execFileSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const output = mkdtempSync(join(tmpdir(), "dashboard-assets-")); temporary.push(output);
  return { root, run, git, output };
}
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });

test("bundle_manifest_lists_required_capabilities_and_digest", () => {
  const { root, run, git, output } = fixture();
  run(manifestScript, "dist", "--official");
  const manifestBytes = readFileSync(join(root, "dist/dashboard-manifest.json"));
  const manifest = JSON.parse(manifestBytes.toString());
  expect(manifest.schema_version).toBe(2);
  expect(manifest.version).toBe("0.1.0");
  expect(manifest.api_version).toBe("dashboard-read-1");
  expect(manifest.required_api_versions).toEqual(["dashboard-read-1"]);
  expect(manifest.required_capabilities).toEqual(expect.arrayContaining(["results.media.read", "playbooks.inspect"]));
  expect(manifest.required_capabilities.every((cap: string) => /^[a-z][a-z.-]+$/.test(cap))).toBe(true);
  expect(manifest.source).toEqual({ revision: git("rev-parse", "HEAD"), dirty: false, official: true });
  expect(manifest.toolchain).toEqual({ node: process.version, pnpm: "10.34.5", lockfile_sha256: hash(readFileSync(join(root, "pnpm-lock.yaml"))) });
  expect(manifest.files["assets/app.js"]).toEqual({ sha256: hash(readFileSync(join(root, "dist/assets/app.js"))), bytes: 23 });
  run(archiveScript, "dist", output, "v0.1.0", "ElectricJack/aq-dashboard");
  const basename = "aq-dashboard-v0.1.0.tar.gz";
  const archive = readFileSync(join(output, basename));
  const record = JSON.parse(readFileSync(join(output, `${basename}.release.json`), "utf8"));
  expect(record.archive_sha256).toBe(hash(archive));
  expect(record.dashboard_digest).toBe(`sha256:${hash(manifestBytes)}`);
  expect(record.source_revision).toBe(manifest.source.revision);
  expect(record.asset_url).toBe(`https://github.com/ElectricJack/aq-dashboard/releases/download/v0.1.0/${basename}`);
  expect(readFileSync(join(output, `${basename}.sha256`), "utf8")).toBe(`${hash(archive)}  ${basename}\n`);
  expect(manifest).not.toHaveProperty("archive_sha256");
  const extracted = mkdtempSync(join(tmpdir(), "dashboard-extract-")); temporary.push(extracted);
  execFileSync("tar", ["-xzf", join(output, basename), "-C", extracted]);
  expect(readFileSync(join(extracted, "dashboard-manifest.json"))).toEqual(manifestBytes);
  utimesSync(join(root, "dist/assets/app.js"), new Date(), new Date());
  run(archiveScript, "dist", output, "v0.1.0", "ElectricJack/aq-dashboard");
  expect(readFileSync(join(output, basename))).toEqual(archive);
}, 15000);

test("official_manifest_refuses_dirty_tracked_and_untracked_sources", () => {
  const { root, run } = fixture();
  writeFileSync(join(root, "new-source.ts"), "changed");
  expect(() => run(manifestScript, "dist", "--official")).toThrow(/dirty/i);
  rmSync(join(root, "new-source.ts"));
  writeFileSync(join(root, "pnpm-lock.yaml"), "changed");
  expect(() => run(manifestScript, "dist", "--official")).toThrow(/dirty/i);
  run(manifestScript, "dist");
  expect(JSON.parse(readFileSync(join(root, "dist/dashboard-manifest.json"), "utf8")).source).toMatchObject({ dirty: true, official: false });
});

test("release_refuses_mismatched_tag_tampered_assets_and_undeclared_paths", () => {
  const { root, run, output } = fixture();
  run(manifestScript, "dist", "--official");
  expect(() => run(archiveScript, "dist", output, "v0.2.0", "ElectricJack/aq-dashboard")).toThrow(/version/i);
  writeFileSync(join(root, "dist/secret.txt"), "undeclared");
  expect(() => run(archiveScript, "dist", output, "v0.1.0", "ElectricJack/aq-dashboard")).toThrow(/unexpected/i);
  rmSync(join(root, "dist/secret.txt"));
  writeFileSync(join(root, "dist/assets/app.js"), "tampered");
  expect(() => run(archiveScript, "dist", output, "v0.1.0", "ElectricJack/aq-dashboard")).toThrow(/digest/i);
});
