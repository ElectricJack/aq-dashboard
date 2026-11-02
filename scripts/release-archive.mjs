// GNU tar and gzip are release build tools, not runtime dependencies.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sha256, sourceProvenance, requiredCapabilities } from "./bundle-manifest.mjs";

const [root, output, tag, repository] = process.argv.slice(2);
if (!root || !output || !/^v\d+\.\d+\.\d+$/.test(tag ?? "") || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) {
  throw new Error("Usage: release-archive.mjs <dist> <output> <vX.Y.Z> <owner/repository>");
}
const source = sourceProvenance(true);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const bytes = await readFile(join(root, "dashboard-manifest.json"));
const manifest = JSON.parse(bytes);
if (`v${pkg.version}` !== tag || manifest.version !== pkg.version) throw new Error("Release tag and manifest must match package version");
if (manifest.schema_version !== 2 || manifest.source?.revision !== source.revision || manifest.source?.dirty !== false || manifest.source?.official !== true) {
  throw new Error("Release requires an official schema 2 manifest from the current clean source revision");
}
if (manifest.toolchain?.lockfile_sha256 !== sha256(await readFile("pnpm-lock.yaml")) || manifest.api_version !== "dashboard-read-1" || JSON.stringify(manifest.required_api_versions) !== JSON.stringify(["dashboard-read-1"]) || JSON.stringify(manifest.required_capabilities) !== JSON.stringify(requiredCapabilities)) {
  throw new Error("Manifest compatibility or lockfile digest does not match release source");
}
const names = Object.keys(manifest.files);
if (!names.includes("index.html") || names.some((name) => name !== "index.html" && !/^assets\/[A-Za-z0-9_.-]+\.(js|css|woff2?|png|svg|jpg|webp|ico)$/.test(name))) {
  throw new Error("Unexpected manifest file path");
}
const allowed = new Set([...names, "dashboard-manifest.json"]);
async function inspect(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (name === "assets" && entry.isDirectory()) await inspect(join(dir, entry.name), "assets/");
    else if (!entry.isFile() || !allowed.has(name)) throw new Error(`Unexpected release path: ${name}`);
  }
}
await inspect(root);
for (const name of names) {
  const content = await readFile(join(root, name));
  if (sha256(content) !== manifest.files[name].sha256 || content.length !== manifest.files[name].bytes) throw new Error(`Bundle digest mismatch: ${name}`);
}
const tar = execFileSync("tar", ["--sort=name", "--format=ustar", "--mtime=@0", "--owner=0", "--group=0", "--numeric-owner", "--mode=0644", "-C", root, "-cf", "-", ...[...allowed].sort()], { maxBuffer: 40 * 1024 * 1024 });
const archive = execFileSync("gzip", ["-n", "-9"], { input: tar, maxBuffer: 40 * 1024 * 1024 });
const name = `aq-dashboard-${tag}.tar.gz`;
const record = {
  schema_version: 1, tag, version: pkg.version, source_revision: source.revision,
  asset_url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
  archive_sha256: sha256(archive), dashboard_digest: `sha256:${sha256(bytes)}`,
  manifest_schema_version: manifest.schema_version,
};
await mkdir(output, { recursive: true });
await writeFile(join(output, name), archive);
await writeFile(join(output, `${name}.sha256`), `${record.archive_sha256}  ${name}\n`);
await writeFile(join(output, `${name}.release.json`), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record, null, 2));
