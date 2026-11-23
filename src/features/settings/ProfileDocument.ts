/** The profile grammar permits frontmatter at the start, followed by Markdown sections. */
export class ProfileDocument {
  readonly lines: string[];
  private readonly frontmatterEnd: number;

  constructor(markdown: string) {
    this.lines = markdown.split("\n");
    this.frontmatterEnd = this.closingDelimiter();
  }

  private closingDelimiter() {
    const isDelimiter = (line: string) => line.trimEnd() === "---";
    if (!isDelimiter(this.lines[0]!)) return -1;
    return this.lines.findIndex((line, index) => index > 0 && isDelimiter(line));
  }

  field(key: string) {
    if (this.frontmatterEnd < 0) return null;
    const entries = this.lines.slice(1, this.frontmatterEnd);
    const matches = entries.flatMap((line, index) => {
      const colon = line.indexOf(":");
      if (colon < 0 || line.slice(0, colon).trim() !== key) return [];
      return [index + 1];
    });
    return new FrontmatterField({ lines: this.lines, end: this.frontmatterEnd, matches, key });
  }

  private *headings() {
    let fenced = false;
    for (let i = this.frontmatterEnd + 1; i < this.lines.length; i++) {
      const line = this.lines[i]!;
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) continue;
      if (line.startsWith("## ") || line.trimEnd() === "##") yield i;
    }
  }

  candidates() {
    let start: number | undefined;
    for (const index of this.headings()) {
      if (start !== undefined) return { start, end: index };
      if (this.lines[index]!.slice(2).trim() === "Candidates") start = index;
    }
    return start === undefined ? null : { start, end: this.lines.length };
  }
}

type FieldLocation = { lines: string[]; end: number; matches: number[]; key: string };

class FrontmatterField {
  constructor(private readonly location: FieldLocation) {}

  get value() {
    const { lines, matches } = this.location;
    const index = matches[0];
    if (index === undefined) return null;
    const line = lines[index]!;
    return line.slice(line.indexOf(":") + 1).trim();
  }

  get text() {
    const written = this.value ?? "";
    if (!written.startsWith('"')) return written;
    try {
      const parsed: unknown = JSON.parse(written);
      return typeof parsed === "string" ? parsed : written;
    } catch {
      return written;
    }
  }

  replace(value: string) {
    const { lines, matches, end, key } = this.location;
    const index = matches[0] ?? end;
    const result = [...lines];
    result.splice(index, matches.length ? 1 : 0, `${key}: ${value}`);
    return result.join("\n");
  }

  writeText(text: string) {
    const line = text.replace(/[\r\n]+/g, " ");
    if (line.trim() === "") {
      const matches = new Set(this.location.matches);
      return this.location.lines.filter((_, index) => !matches.has(index)).join("\n");
    }
    return this.replace(/^\s|\s$|^["[]/.test(line) ? JSON.stringify(line) : line);
  }
}

function readField(read: (field: FrontmatterField) => string | null) {
  return (markdown: string, key: string) => {
    const field = new ProfileDocument(markdown).field(key);
    return field && read(field);
  };
}

function editField(edit: (field: FrontmatterField, replacement: string) => string) {
  return (markdown: string, key: string, replacement: string) => {
    const field = new ProfileDocument(markdown).field(key);
    return field && edit(field, replacement);
  };
}

/** A missing key has no raw value. */
export const frontmatterValue = readField(field => field.value);
/** A missing key reads as empty text, and a quoted value reads as its unquoted contents. */
export const frontmatterText = readField(field => field.text);
/** Replace the key's first occurrence or append it to the frontmatter. */
export const setFrontmatterValue = editField((field, value) => field.replace(value));
/** Write free text on one line, quoting ambiguous values. Empty text removes the key. */
export const setFrontmatterText = editField((field, text) => field.writeText(text));
/** The id a document states. */
export const documentId = (markdown: string) => frontmatterValue(markdown, "id");

export const isDocumentId = (value: string) => /^[a-z][a-z0-9-]{0,62}$/.test(value);
