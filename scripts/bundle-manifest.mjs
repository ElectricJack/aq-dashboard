import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Capability identifiers from dashboard-read-1 bootstrap. These describe the
// bundle's compatibility requirements, not the current principal's grants.
export const requiredCapabilities = [
  "dashboard.overview", "decisions.read", "decisions.resolve", "human.graph.read",
  "human.overview.tasks.read", "knowledge.read", "notifications.read",
  "playbooks.catalog.read", "playbooks.inspect", "playbooks.loaded-definitions.read",
  "projects.read", "provider.quota", "providers.configured.read", "results.media.read",
  "results.media.upload", "results.read", "search.read", "session.events.read",
  "session.usage.read", "sessions.read", "status.read", "supervisor.history.read",
  "supervisor.message.enqueue", "tasks.create", "tasks.read", "terminal.control",
  "terminal.watch", "workers.read",
].sort();

export function sourceProvenance(official) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  const revision = git("rev-parse", "HEAD");
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error("Expected full source revision SHA");
  const dirty = git("status", "--porcelain", "--untracked-files=all").length > 0;
  if (official && dirty) throw new Error("Official dashboard builds refuse a dirty source tree");
  return { revision, dirty, official };
}

export async function writeManifest(root, official) {
  const source = sourceProvenance(official);
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const pnpm = execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim();
  if (official && pkg.packageManager !== `pnpm@${pnpm}`) throw new Error("Official pnpm version must match packageManager");
  const files = {};
  async function add(name) {
    const bytes = await readFile(join(root, name));
    files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  await add("index.html");
  for (const item of (await readdir(join(root, "assets"), { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    if (!item.isFile() || !/^[A-Za-z0-9_.-]+\.(js|css|woff2?|png|svg|jpg|webp|ico)$/.test(item.name)) {
      throw new Error(`Unexpected bundle asset: ${item.name}`);
    }
    await add(`assets/${item.name}`);
  }
  if (Object.keys(files).length > 512 || Object.values(files).reduce((n, f) => n + f.bytes, 0) > 32 * 1024 * 1024) {
    throw new Error("Dashboard bundle exceeds server limits");
  }
  const manifest = {
    schema_version: 2, api_version: "dashboard-read-1", version: pkg.version, source,
    toolchain: { node: process.version, pnpm, lockfile_sha256: sha256(await readFile("pnpm-lock.yaml")) },
    required_api_versions: ["dashboard-read-1"], required_capabilities: requiredCapabilities, files,
  };
  await writeFile(join(root, "dashboard-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Dashboard manifest: ${Object.keys(files).length} files, source ${source.revision}`);
}

if (resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await writeManifest(process.argv[2] ?? "dist", process.argv.includes("--official"));
}
