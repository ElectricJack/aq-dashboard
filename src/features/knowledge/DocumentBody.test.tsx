import { render, screen } from "@testing-library/react";
import { DocumentBody, documentOutline } from "./DocumentBody";

test("formats document headings lists and fenced code with semantic elements", () => {
  render(<DocumentBody body={'# Decision\n\nFirst paragraph.\n\n## Why this matters\n\n- One authority\n- Separate observations\n\n1. Read the record\n2. Check the revision\n\n```rust\nlet revision = 4;\n```'} />);
  expect(screen.getByRole("heading", { name: "Decision", level: 3 })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Why this matters", level: 4 })).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(4);
  expect(screen.getByText("let revision = 4;").tagName).toBe("CODE");
});
test("HTML links and unsupported syntax stay literal and cannot execute", () => {
  const { container } = render(<DocumentBody body={'## <img src=x onerror=alert(1)>\n\n<script>alert(1)</script> [Open](javascript:alert(1))\n\n```html\n<iframe src="https://evil.example"/>\n```'} />);
  expect(screen.getByRole("heading", { name: "<img src=x onerror=alert(1)>" })).toBeVisible();
  expect(container.querySelector("img,script,iframe,a")).toBeNull();
  expect(container).toHaveTextContent("javascript:alert(1)");
});
test("bounds renderer work even for pathological tiny blocks", () => {
  render(<DocumentBody body={Array.from({ length: 5000 }, () => "- x").join("\n")} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(1024);
  expect(screen.getByRole("status")).toHaveTextContent("Document preview truncated");
});
test("headings get stable unique ids that match the section outline", () => {
  const body = "# Decision\n\nText.\n\n## Why this matters\n\nMore.\n\n## Why this matters\n\n```md\n# Not a heading\n```\n\n#### Deep detail";
  expect(documentOutline(body, "doc")).toEqual([
    { id: "doc-decision", text: "Decision", level: 1 },
    { id: "doc-why-this-matters", text: "Why this matters", level: 2 },
    { id: "doc-why-this-matters-2", text: "Why this matters", level: 2 },
  ]);
  const { container } = render(<DocumentBody body={body} idPrefix="doc" />);
  expect([...container.querySelectorAll("[id]")].map(e => e.id)).toEqual(["doc-decision", "doc-why-this-matters", "doc-why-this-matters-2", "doc-deep-detail"]);
  const { container: plain } = render(<DocumentBody body={body} />);
  expect(plain.querySelector("[id]")).toBeNull();
});
test("inline code, strong and emphasis render while other inline syntax stays literal (WD-10)", () => {
  const { container } = render(<DocumentBody body={"add `pub fn hello() -> &'static str` returning **Bold** and *soft* text\n\n- a `code` item with __strong__\n\nsnake_case_name, 2 * 3 * 4 and [link](https://example.org) <b>x</b>"} />);
  expect(screen.getByText("pub fn hello() -> &'static str").tagName).toBe("CODE");
  expect(screen.getByText("Bold").tagName).toBe("STRONG");
  expect(screen.getByText("soft").tagName).toBe("EM");
  expect(screen.getByText("code").tagName).toBe("CODE");
  expect(screen.getByText("strong").tagName).toBe("STRONG");
  expect(container.querySelectorAll("em")).toHaveLength(1);
  expect(container.querySelector("a,b")).toBeNull();
  expect(container).toHaveTextContent("snake_case_name, 2 * 3 * 4 and [link](https://example.org) <b>x</b>");
  expect(container).not.toHaveTextContent("`");
});
test("inline parsing stays bounded on pathological input", () => {
  const started = performance.now();
  render(<DocumentBody body={"`".repeat(16000) + "*".repeat(16000)} />);
  expect(performance.now() - started).toBeLessThan(2000);
});
