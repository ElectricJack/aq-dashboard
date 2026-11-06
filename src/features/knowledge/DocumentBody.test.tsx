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

/* P1-05: comments opt in to http(s) links, bare-URL autolinks and block quotes; raw HTML stays text. */
test("links opt-in: Markdown links, <autolinks> and bare URLs open safely in a new tab", () => {
  const { container } = render(<DocumentBody links quotes body={"See [the run](https://example.com/runs/1?x=1) and <https://example.org/a_b_c>.\n\nBare https://example.net/path_with_under_scores, then (https://example.com/x)."} />);
  const links = [...container.querySelectorAll("a")];
  expect(links.map(a => [a.textContent, a.getAttribute("href")])).toEqual([
    ["the run", "https://example.com/runs/1?x=1"],
    ["https://example.org/a_b_c", "https://example.org/a_b_c"],
    ["https://example.net/path_with_under_scores", "https://example.net/path_with_under_scores"],
    ["https://example.com/x", "https://example.com/x"],
  ]);
  for (const a of links) { expect(a).toHaveAttribute("target", "_blank"); expect(a).toHaveAttribute("rel", "noopener noreferrer"); }
  // Trailing punctuation and an unopened bracket stay outside the link; underscores in a URL aren't emphasis.
  expect(container).toHaveTextContent("under_scores, then (https://example.com/x).");
  expect(container.querySelector("em")).toBeNull();
});
test("links opt-in: only http and https become links; HTML and other schemes stay literal", () => {
  const { container } = render(<DocumentBody links quotes body={'[x](javascript:alert(1)) [y](data:text/html,hi) <script>alert(1)</script> <img src=x onerror=alert(1)> ftp://example.com [z](https://ok.example/"onmouseover=alert(1))'} />);
  expect(container.querySelector("script,img,iframe")).toBeNull();
  const links = [...container.querySelectorAll("a")];
  expect(links.every(a => /^https:\/\//.test(a.getAttribute("href")!))).toBe(true);
  expect(container).toHaveTextContent("[x](javascript:alert(1)) [y](data:text/html,hi) <script>alert(1)</script> <img src=x onerror=alert(1)> ftp://example.com");
  for (const a of links) expect([...a.attributes].map(attr => attr.name).sort()).toEqual(["href", "rel", "target"]);
});
test("links opt-in: link text is formatted, never nested, and code spans keep URLs literal", () => {
  const { container } = render(<DocumentBody links body={"[**bold** label](https://example.com) and `https://example.com/in-code` and **https://example.com/strong**"} />);
  expect(container.querySelectorAll("a")).toHaveLength(2);
  expect(container.querySelector("a strong")).toHaveTextContent("bold");
  expect(container.querySelector("a a")).toBeNull();
  expect(container.querySelector("code")).toHaveTextContent("https://example.com/in-code");
  expect(container.querySelector("strong > a")).toHaveAttribute("href", "https://example.com/strong");
});
test("quotes opt-in: consecutive > lines form a block quote with its own formatting", () => {
  const { container } = render(<DocumentBody links quotes body={"Before\n> quoted **line**\n> second https://example.com\n>\n> > nested\nAfter"} />);
  const quote = container.querySelector("blockquote")!;
  expect(quote).toHaveTextContent("quoted line second https://example.com");
  expect(quote.querySelector("strong")).toHaveTextContent("line");
  expect(quote.querySelector("a")).toHaveAttribute("href", "https://example.com/");
  expect(quote.querySelector("blockquote")).toHaveTextContent("nested");
  expect(container.querySelectorAll(":scope > div > p")).toHaveLength(2);
});
test("without the opt-ins, links and quotes stay literal (knowledge documents are unchanged)", () => {
  const { container } = render(<DocumentBody body={"> quote https://example.com [x](https://example.com)"} />);
  expect(container.querySelector("a,blockquote")).toBeNull();
  expect(container).toHaveTextContent("> quote https://example.com [x](https://example.com)");
});
test("links opt-in parsing stays bounded on pathological input", () => {
  const started = performance.now();
  render(<DocumentBody links quotes body={"https://".repeat(4000) + "[".repeat(4000) + ">".repeat(4000)} />);
  expect(performance.now() - started).toBeLessThan(2000);
});
