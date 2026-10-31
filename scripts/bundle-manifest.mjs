import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

const root = process.argv[2] ?? "dist";
const files = {};
async function add(name) {
  const bytes = await readFile(join(root, name));
  files[name] = { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
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
await writeFile(join(root, "dashboard-manifest.json"), JSON.stringify({ schema_version: 1, api_version: "dashboard-read-1", files }, null, 2) + "\n");
console.log(`Dashboard manifest: ${Object.keys(files).length} files`);
