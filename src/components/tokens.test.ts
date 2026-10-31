import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Vitest stubs CSS imports, so read the source file directly.
const css = readFileSync(resolve(process.cwd(), "src/components/tokens.css"), "utf8");

function token(name: string): string | undefined {
  return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

// Values from docs/specs/0002-product-design.md section 2.
test.each([
  ["color-canvas", "#111418"],
  ["color-panel", "#191f26"],
  ["color-raised", "#222a34"],
  ["color-text", "#eef1f5"],
  ["color-text-secondary", "#b6c1ce"],
  ["color-accent", "#b1b2ff"],
  ["color-focus", "#f3c576"],
  ["color-border", "#36414f"],
  ["space-1", "4px"],
  ["space-2", "8px"],
  ["space-3", "12px"],
  ["space-4", "16px"],
  ["space-5", "24px"],
  ["space-6", "32px"],
  ["space-7", "48px"],
  ["radius-control", "8px"],
  ["radius-panel", "12px"],
  ["font-size-body", "16px"],
  ["font-size-meta", "14px"],
  ["rail-width", "224px"],
  ["gutter-desktop", "24px"],
  ["gutter-mobile", "16px"],
  ["touch-target", "44px"],
])("defines --%s as %s", (name, value) => {
  expect(token(name)).toBe(value);
});

test("defines attention, error and success colors", () => {
  for (const name of ["color-attention", "color-error", "color-success"]) {
    expect(token(name)).toMatch(/^#[0-9a-f]{6}$/);
  }
});

test("disables transitions when reduced motion is requested", () => {
  expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
});
