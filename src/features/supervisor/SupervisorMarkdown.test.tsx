import { render, screen, within } from "@testing-library/react";
import { SupervisorMarkdown } from "./SupervisorMarkdown";

const sample = [
  "# Plan", "", "Some **bold**, *italic* and `inline code` with a [link](https://example.com/a).", "",
  "- one", "  - nested", "- [x] done", "- [ ] todo", "", "1. first", "2. second", "", "> quoted", "", "---", "",
  "```ts", "const  spaced   = 1;", "```", "", "| A | B |", "| - | - |", "| 1 | 2 |",
].join("\n");

test("renders headings, lists, emphasis, links, code, quotes, rules, tables and task lists", () => {
  const { container } = render(<SupervisorMarkdown source={sample} />);
  expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  expect(container.querySelector("strong")).toHaveTextContent("bold");
  expect(container.querySelector("em")).toHaveTextContent("italic");
  expect(container.querySelector("ul ul")).toHaveTextContent("nested");
  expect(container.querySelector("ol")?.children).toHaveLength(2);
  expect(container.querySelector("blockquote")).toHaveTextContent("quoted");
  expect(container.querySelector("hr")).not.toBeNull();
  expect(container.querySelector("pre code")?.textContent).toBe("const  spaced   = 1;\n");
  const checks = screen.getAllByRole("checkbox"); expect(checks).toHaveLength(2); expect(checks[0]).toBeChecked(); expect(checks[1]).not.toBeChecked();
  const table = screen.getByRole("table"); expect(within(table).getAllByRole("columnheader").map(cell => cell.textContent)).toEqual(["A", "B"]);
  expect(table.parentElement).toHaveAttribute("tabindex", "0");
  const link = screen.getByRole("link", { name: "link" });
  expect(link).toHaveAttribute("href", "https://example.com/a"); expect(link).toHaveAttribute("target", "_blank"); expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("plain text stays readable", () => {
  render(<SupervisorMarkdown source="Just a plain reply, nothing special." />);
  expect(screen.getByText("Just a plain reply, nothing special.")).toBeInTheDocument();
});

test("streaming partial Markdown re-renders without throwing", () => {
  const { container, rerender } = render(<SupervisorMarkdown source="Working on **it" />);
  for (const partial of ["```ts\nconst a", "```ts\nconst a = 1;\n```\n\n| A | B", "| A | B |\n| - |", sample]) {
    rerender(<SupervisorMarkdown source={partial} />);
  }
  expect(container.querySelector("table")).not.toBeNull();
});

test("embedded HTML and unsafe link protocols are inert", () => {
  const { container } = render(<SupervisorMarkdown source={'<script>window.__pwn = 1</script><img src=x onerror="window.__pwn = 1">\n\n<b onclick="x()">raw</b>\n\n[bad](javascript:alert(1)) [data](data:text/html;base64,AAAA) ![pic](https://example.com/p.png)'} />);
  expect(container.querySelector("script, img, b")).toBeNull();
  for (const anchor of container.querySelectorAll("a")) expect(anchor.getAttribute("href") ?? "").not.toMatch(/^(javascript|data|vbscript):/i);
  expect((window as unknown as Record<string, unknown>).__pwn).toBeUndefined();
});
