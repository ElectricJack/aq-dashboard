#!/usr/bin/env node
// Fails if a production bundle contains mock-harness code or fixture data.
// Usage: node scripts/check-bundle.mjs [distDir]
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN = [
  "mockServiceWorker",
  "virtual:msw",
  "setupWorker",
  "proposed-0",
  "Sample Owner",
  "account-sample-",
  "fixture-provider-usage",
];

const dir = process.argv[2] ?? "dist";

function* files(root) {
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) yield* files(path);
    else if (!name.endsWith(".map")) yield path;
  }
}

const hits = [];
for (const file of files(dir)) {
  if (file.endsWith("mockServiceWorker.js")) hits.push(`${file}: mock worker script`);
  const text = readFileSync(file, "utf8");
  for (const needle of FORBIDDEN) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
}

if (hits.length) {
  console.error(`Mock code or fixtures found in ${dir}:\n  ${hits.join("\n  ")}`);
  process.exit(1);
}
console.log(`${dir}: no mock code or fixtures`);
