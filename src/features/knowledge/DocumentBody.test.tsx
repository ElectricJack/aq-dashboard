import { render, screen } from "@testing-library/react";
import { DocumentBody } from "./DocumentBody";

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
