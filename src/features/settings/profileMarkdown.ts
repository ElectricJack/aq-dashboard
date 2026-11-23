import { ProfileDocument } from "./ProfileDocument";
import type { Candidate, DocumentKind } from "../../api/roleSettings";

export { HARNESSES, HARNESS_REASONING, HARNESS_PROVIDER, isToken, reasoningChoices } from "./candidateEditing";
export { isDocumentId } from "./ProfileDocument";

export { documentId, frontmatterValue, frontmatterText, setFrontmatterValue, setFrontmatterText } from "./ProfileDocument";

const HEADER = "| provider | model | reasoning | harnesses |", RULE = "|---|---|---|---|";
function cells(line = ""): string[] | null {
  const trimmed = line.trim();
  if (!/^\|[\s\S]*\|$/.test(trimmed)) return null;
  return trimmed.slice(1, -1).split("|").map(cell => cell.trim());
}
function candidateHeader(rows: string[]) {
  const rule = cells(rows[1]);
  return cells(rows[0])?.join("|") === "provider|model|reasoning|harnesses"
    && rule?.length === 4 && rule.every(cell => /^:?-+:?$/.test(cell));
}
/**
 * The rows of the `## Candidates` table, in order. Cells are returned as written, so a row still being typed can be shown;
 * null when the section or its table cannot be read, and the Markdown has to be edited directly.
 */
export function readCandidates(markdown: string): Candidate[] | null {
  const document = new ProfileDocument(markdown);
  const found = document.candidates();
  if (!found) return null;
  const rows = document.lines.slice(found.start + 1, found.end).filter(line => line.trim() !== "");
  if (!candidateHeader(rows)) return null;
  const out: Candidate[] = [];
  for (const row of rows.slice(2)) {
    const candidate = parseCandidate(cells(row));
    if (!candidate) return null;
    out.push(candidate);
  }
  return out;
}
function parseCandidate(row: string[] | null): Candidate | null {
  if (row?.length !== 4) return null;
  return { provider: row[0]!, model: row[1]!, reasoning: row[2]!, harnesses: row[3]!.split(",").map(item => item.trim()).filter(Boolean) };
}
const cell = (value: string) => value.replace(/[|\r\n]/g, "").trim();
function formatCandidate(c: Candidate) {
  return `| ${cell(c.provider)} | ${cell(c.model)} | ${cell(c.reasoning)} | ${c.harnesses.map(cell).filter(Boolean).join(", ")} |`;
}
/** The document with its `## Candidates` table replaced by `candidates`, in that order; everything else is left as written. */
export function writeCandidates(markdown: string, candidates: Candidate[]): string {
  const table = [HEADER, RULE, ...candidates.map(formatCandidate)];
  const document = new ProfileDocument(markdown);
  const found = document.candidates();
  if (!found) return `${markdown.replace(/\n*$/, "")}\n\n## Candidates\n${table.join("\n")}\n`;
  const rest = document.lines.slice(found.end);
  // A following section keeps one blank line above it; a table that ends the document ends with a newline.
  return [...document.lines.slice(0, found.start + 1), ...table, ...(rest.length ? ["", ...rest] : [""])].join("\n");
}

/** The starting text of a new document. The person fills it in; the server checks the result. */
export function newDocument(kind: DocumentKind, references: { execution?: string } = {}): string {
  switch (kind) {
    case "role": return `---\nid: new-role\nname: New role\nexecution: ${references.execution ?? "sandbox"}\noperations: [task.read, knowledge.read]\nenabled: true\n---\n## Role\nDescribe the work this role does.\n\n## Rules\n- Report the exact commands you ran and their outcomes.\n`;
    case "intelligence": return `---\nid: new-level\nname: New level\n---\n## Candidates\n${HEADER}\n${RULE}\n`;
    case "execution": return `---\nid: new-profile\nname: New profile\nharnesses: [claude]\nenvironment: \nconfinement: container\n---\n## Credentials\n- claude: \n\n## Limits\n- wall_time_ms: 900000\n- memory_bytes: 4294967296\n- cpu_millis: 2000\n- process_limit: 512\n- startup_context_bytes: 65536\n- max_output_tokens: 32000\n`;
  }
}
