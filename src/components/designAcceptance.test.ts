import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// G11: every selected mockup is accepted with a named subset, deferred differences, captures,
// reviewer and served bundle (docs/design/visual-acceptance.md). The reference PNGs are unchanged.
const root = process.cwd();
const read = (path: string) => readFileSync(resolve(root, path));
const manifest = JSON.parse(read("docs/design/manifest.json").toString()) as { assets: { file: string; sha256: string; bytes: number }[] };
const acceptance = JSON.parse(read("docs/design/acceptance.json").toString()) as {
  served_bundle: { manifest_sha256: string };
  assets: Record<string, Record<string, unknown> & { captures: { fixture: string[]; live?: string[] } }>;
  pages: Record<string, Record<string, unknown> & { captures: { fixture: string[]; live?: string[] } }>;
};

test("acceptance covers exactly the manifest assets", () => {
  expect(Object.keys(acceptance.assets).sort()).toEqual(manifest.assets.map((a) => a.file).sort());
});

test.each(manifest.assets.map((a) => [a.file, a] as const))("%s keeps its manifest digest", (_file, asset) => {
  const bytes = read(`docs/design/${asset.file}`);
  expect(bytes.length).toBe(asset.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(asset.sha256);
});

const records = [...Object.entries(acceptance.assets), ...Object.entries(acceptance.pages)];
test.each(records)("%s is accepted with a complete record and existing captures", (_name, record) => {
  expect(["accepted", "open"]).toContain(record.status);
  for (const field of ["reference", "delivered_subset", "reviewer"]) expect(String(record[field] ?? "")).not.toBe("");
  expect(Array.isArray(record.deferred_differences)).toBe(true);
  // An open record names what it waits for and has no served bundle yet; accepting it records the bundle digest.
  if (record.status === "open") { expect(String(record.reason ?? "")).not.toBe(""); expect(record.served_bundle_sha256 ?? null).toBeNull(); }
  else if (record.live_served_bundle_sha256) {
    // A record accepted on its own later live run names that run's bundle, which must match its evidence bundle.json.
    expect(record.served_bundle_sha256).toBe(record.live_served_bundle_sha256);
    const evidence = JSON.parse(read(`${String(record.live_evidence).replace(/[^/]+$/, "")}bundle.json`).toString());
    expect(`sha256:${record.served_bundle_sha256}`.replace("sha256:sha256:", "sha256:")).toBe(`sha256:${evidence.manifest_sha256}`);
  } else expect(record.served_bundle_sha256).toBe(acceptance.served_bundle.manifest_sha256);
  const captures = [...record.captures.fixture, ...(record.captures.live ?? [])];
  expect(captures.filter((c) => /desktop-1440/.test(c)).length).toBeGreaterThan(0);
  expect(captures.filter((c) => /phone-390/.test(c)).length).toBeGreaterThan(0);
  for (const capture of captures) expect(existsSync(resolve(root, capture)), capture).toBe(true);
});

// WCAG 2.2 AA contrast for the 0002 section 2 tokens (1.4.3 text 4.5:1, 1.4.11 focus indicator 3:1).
const css = read("src/components/tokens.css").toString();
const token = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, "i").exec(css)?.[1] ?? "";
function luminance(hex: string) {
  const linear = (i: number) => { const c = parseInt(hex.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}
function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const grounds = ["color-canvas", "color-panel", "color-raised"];

test.each(["color-text", "color-text-secondary", "color-accent", "color-attention", "color-error", "color-success"].flatMap((fg) => grounds.map((bg) => [fg, bg])))(
  "%s on %s meets 4.5:1",
  (fg, bg) => expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5),
);

test("accent controls keep 4.5:1 text", () => {
  expect(contrast(token("color-accent-contrast"), token("color-accent"))).toBeGreaterThanOrEqual(4.5);
});

test.each(grounds)("focus ring on %s meets 3:1", (bg) => {
  expect(contrast(token("color-focus"), token(bg))).toBeGreaterThanOrEqual(3);
});
