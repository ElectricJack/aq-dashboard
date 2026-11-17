import type { Candidate, DocumentKind } from "../../api/roleSettings";

/**
 * The few edits the Settings pages make to a role or profile document without the person typing Markdown.
 * The grammar is the server's (aq-server `crates/aq-profiles/README.md`); the server stays the judge of every document.
 */
export const HARNESSES = ["claude", "codex", "opencode", "gemini"] as const;
/** The reasoning values each harness accepts; `default` is the harness's own setting. */
export const HARNESS_REASONING: Record<string, readonly string[]> = {
  claude: ["default", "off", "low", "medium", "high", "xhigh", "max"],
  codex: ["default", "low", "medium", "high"],
  opencode: ["default", "low", "medium", "high"],
  gemini: ["default"],
};
/** The reasoning values every one of `harnesses` accepts. */
export function reasoningChoices(harnesses: string[]): string[] {
  const known = harnesses.filter(harness => HARNESS_REASONING[harness]);
  if (!known.length) return ["default"];
  return HARNESS_REASONING[known[0]!]!.filter(value => known.every(harness => HARNESS_REASONING[harness]!.includes(value)));
}
/** The provider a harness requires, when it requires one. */
export const HARNESS_PROVIDER: Record<string, string> = { claude: "anthropic", codex: "openai" };
/** A bare word of a list or a table cell. */
export const isToken = (value: string) => /^[A-Za-z0-9._@/:+-]+$/.test(value);
export const isDocumentId = (value: string) => /^[a-z][a-z0-9-]{0,62}$/.test(value);

const lineOf = (line: string) => line.endsWith("\r") ? line.slice(0, -1) : line;
const isFence = (line: string) => /^\s*(```|~~~)/.test(line);
const isHeading = (line: string) => line.startsWith("## ") || line.trimEnd() === "##";

/** The line indexes of the frontmatter's opening and closing `---`, or null when the text has no closed frontmatter. */
function frontmatter(lines: string[]): { end: number } | null {
  if (lineOf(lines[0] ?? "").trimEnd() !== "---") return null;
  for (let i = 1; i < lines.length; i++) if (lineOf(lines[i]!).trimEnd() === "---") return { end: i };
  return null;
}
function keyOf(line: string): string | null {
  const at = line.indexOf(":");
  return at < 0 ? null : line.slice(0, at).trim();
}
/** The text of a frontmatter key, as written (unquoted values only); null when the key is absent. */
export function frontmatterValue(markdown: string, key: string): string | null {
  const lines = markdown.split("\n"), front = frontmatter(lines);
  if (!front) return null;
  for (let i = 1; i < front.end; i++) {
    const line = lineOf(lines[i]!);
    if (keyOf(line) === key) return line.slice(line.indexOf(":") + 1).trim();
  }
  return null;
}
/** The document with a frontmatter key set: its line is replaced, or added as the last key. Null when there is no frontmatter to edit. */
export function setFrontmatterValue(markdown: string, key: string, value: string): string | null {
  const lines = markdown.split("\n"), front = frontmatter(lines);
  if (!front) return null;
  for (let i = 1; i < front.end; i++) if (keyOf(lineOf(lines[i]!)) === key) { lines[i] = `${key}: ${value}`; return lines.join("\n"); }
  lines.splice(front.end, 0, `${key}: ${value}`);
  return lines.join("\n");
}
/**
 * A frontmatter key's text as a person reads it: a quoted value is unquoted. Empty when the key is absent, and null
 * when the document has no frontmatter to read (the text then has to be edited as Markdown).
 */
export function frontmatterText(markdown: string, key: string): string | null {
  if (frontmatter(markdown.split("\n")) === null) return null;
  const written = frontmatterValue(markdown, key) ?? "";
  if (!written.startsWith("\"")) return written;
  try { const parsed: unknown = JSON.parse(written); return typeof parsed === "string" ? parsed : written; } catch { return written; }
}
/**
 * The document with a frontmatter key set to free text on one line: line breaks become spaces, and text the grammar would
 * read as something else (it starts with a quote or a bracket) is quoted. Empty text removes the key, since a key cannot
 * be empty. Null when there is no frontmatter to edit.
 */
export function setFrontmatterText(markdown: string, key: string, text: string): string | null {
  const lines = markdown.split("\n"), front = frontmatter(lines);
  if (!front) return null;
  const line = text.replace(/[\r\n]+/g, " ");
  if (line.trim() !== "") return setFrontmatterValue(markdown, key, /^\s|\s$|^["[]/.test(line) ? JSON.stringify(line) : line);
  return lines.filter((candidate, i) => !(i > 0 && i < front.end && keyOf(lineOf(candidate)) === key)).join("\n");
}
/** The id a document states. */
export const documentId = (markdown: string) => frontmatterValue(markdown, "id");

const HEADER = "| provider | model | reasoning | harnesses |", RULE = "|---|---|---|---|";
/** Where `## <title>` starts and where its text ends (the next heading or the end), outside fenced blocks. */
function section(lines: string[], title: string): { start: number; end: number } | null {
  const front = frontmatter(lines);
  let fenced = false, start = -1;
  for (let i = front ? front.end + 1 : 0; i < lines.length; i++) {
    const line = lineOf(lines[i]!);
    if (isFence(line)) fenced = !fenced;
    if (fenced || !isHeading(line)) continue;
    if (start >= 0) return { start, end: i };
    if (line.slice(2).trim() === title) start = i;
  }
  return start >= 0 ? { start, end: lines.length } : null;
}
function cells(line: string): string[] | null {
  const trimmed = line.trim();
  if (trimmed.length < 2 || !trimmed.startsWith("|") || !trimmed.endsWith("|")) return null;
  return trimmed.slice(1, -1).split("|").map(cell => cell.trim());
}
/**
 * The rows of the `## Candidates` table, in order. Cells are returned as written, so a row still being typed can be shown;
 * null when the section or its table cannot be read, and the Markdown has to be edited directly.
 */
export function readCandidates(markdown: string): Candidate[] | null {
  const lines = markdown.split("\n"), found = section(lines, "Candidates");
  if (!found) return null;
  const rows = lines.slice(found.start + 1, found.end).map(lineOf).filter(line => line.trim() !== "");
  const header = rows[0] === undefined ? null : cells(rows[0]), rule = rows[1] === undefined ? null : cells(rows[1]);
  if (header?.join("|") !== "provider|model|reasoning|harnesses" || rule?.length !== 4 || !rule.every(cell => /^:?-+:?$/.test(cell))) return null;
  const out: Candidate[] = [];
  for (const row of rows.slice(2)) {
    const row4 = cells(row);
    if (row4?.length !== 4) return null;
    out.push({ provider: row4[0]!, model: row4[1]!, reasoning: row4[2]!, harnesses: row4[3]!.split(",").map(item => item.trim()).filter(Boolean) });
  }
  return out;
}
const cell = (value: string) => value.replace(/[|\r\n]/g, "").trim();
/** The document with its `## Candidates` table replaced by `candidates`, in that order; everything else is left as written. */
export function writeCandidates(markdown: string, candidates: Candidate[]): string {
  const table = [HEADER, RULE, ...candidates.map(c => `| ${cell(c.provider)} | ${cell(c.model)} | ${cell(c.reasoning)} | ${c.harnesses.map(cell).filter(Boolean).join(", ")} |`)];
  const lines = markdown.split("\n"), found = section(lines, "Candidates");
  if (!found) return `${markdown.replace(/\n*$/, "")}\n\n## Candidates\n${table.join("\n")}\n`;
  const rest = lines.slice(found.end);
  // A following section keeps one blank line above it; a table that ends the document ends with a newline.
  return [...lines.slice(0, found.start + 1), ...table, ...(rest.length ? ["", ...rest] : [""])].join("\n");
}

/** The starting text of a new document. The person fills it in; the server checks the result. */
export function newDocument(kind: DocumentKind, references: { execution?: string } = {}): string {
  switch (kind) {
    case "role": return `---\nid: new-role\nname: New role\nexecution: ${references.execution ?? "sandbox"}\noperations: [task.read, knowledge.read]\nenabled: true\n---\n## Role\nDescribe the work this role does.\n\n## Rules\n- Report the exact commands you ran and their outcomes.\n`;
    case "intelligence": return `---\nid: new-level\nname: New level\n---\n## Candidates\n${HEADER}\n${RULE}\n`;
    case "execution": return `---\nid: new-profile\nname: New profile\nharnesses: [claude]\nenvironment: \nconfinement: container\n---\n## Credentials\n- claude: \n\n## Limits\n- wall_time_ms: 900000\n- memory_bytes: 4294967296\n- cpu_millis: 2000\n- process_limit: 512\n- startup_context_bytes: 65536\n- max_output_tokens: 32000\n`;
  }
}
