import { useMemo, type ReactNode } from "react";
import { renderInline } from "./documentInline";
export { renderInline, type InlineOptions } from "./documentInline";
import styles from "./HumanNodeWorkspace.module.css";

export type DocumentOutlineEntry = { id: string; text: string; level: number };

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section";

/** Opt-in syntax beyond the document subset: links (see `LINKS`) and `>` block quotes. */
export type DocumentOptions = { links?: boolean; quotes?: boolean };
const QUOTE = /^\s{0,3}>\s?(.*)$/, MAX_QUOTE_DEPTH = 4;

const FENCE = /^\s*```/;
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const LIST = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/;
const BLOCK_START = /^(?:#{1,6}\s|\s*```|\s*[-+*]\s|\s*\d+\.\s)/;

type SourceLine = { index: number; text: string };
type HeadingInfo = { level: number; text: string };
type DocumentContext = { idPrefix?: string; options: DocumentOptions; depth: number };

/** A reader consumes at most 1,024 lines and 512 blocks at each quote depth. */
class BlockReader {
  private readonly lines: string[];
  private readonly limit: number;
  private readonly used = new Map<string, number>();
  private readonly outline: DocumentOutlineEntry[] = [];
  private index = 0;

  constructor(body: string, private readonly context: DocumentContext) {
    this.lines = body.slice(0, 262144).replace(/\r\n?/g, "\n").split("\n");
    this.limit = Math.min(this.lines.length, 1024);
  }

  read() {
    const blocks: ReactNode[] = [];
    while (this.index < this.limit && blocks.length < 512) {
      const block = this.block();
      if (block) blocks.push(block);
    }
    if (this.index < this.lines.length) blocks.push(<p key="truncated" role="status">Document preview truncated at its rendering limit.</p>);
    return { blocks, outline: this.outline };
  }

  private block(): ReactNode {
    const first = { index: this.index, text: this.lines[this.index]! };
    this.index++;
    const line = first.text;
    if (!line.trim()) return null;
    if (FENCE.test(line)) return this.fence(first);
    const heading = HEADING.exec(line);
    if (heading) return this.heading(first, heading);
    if (this.isQuote(line)) return this.quote(first);
    const list = LIST.exec(line);
    if (list) return this.list(first, list);
    return this.paragraph(first);
  }

  private inline(text: string) {
    return renderInline(text, 0, { links: this.context.options.links });
  }

  private fence(first: SourceLine) {
    const code: string[] = [];
    while (this.index < this.limit) {
      const line = this.lines[this.index++]!;
      if (FENCE.test(line)) break;
      code.push(line);
    }
    return <pre key={first.index}><code>{code.join("\n")}</code></pre>;
  }

  private heading(first: SourceLine, match: RegExpExecArray) {
    const level = match[1]!.length, text = match[2]!;
    const Heading = `h${Math.min(6, level + 2)}` as "h3" | "h4" | "h5" | "h6";
    const id = this.headingId({ level, text });
    return <Heading key={first.index} id={id} tabIndex={id ? -1 : undefined}>{this.inline(text)}</Heading>;
  }

  private headingId({ level, text }: HeadingInfo) {
    if (!this.context.idPrefix) return undefined;
    const base = `${this.context.idPrefix}-${slug(text)}`, seen = (this.used.get(base) ?? 0) + 1;
    this.used.set(base, seen);
    const id = seen > 1 ? `${base}-${seen}` : base;
    if (level <= 3 && this.outline.length < 24) this.outline.push({ id, text, level });
    return id;
  }

  private isQuote(line: string) {
    const { options, depth } = this.context;
    return options.quotes && depth < MAX_QUOTE_DEPTH && QUOTE.test(line);
  }

  private quote(first: SourceLine) {
    const quoted = [QUOTE.exec(first.text)![1]!];
    while (this.index < this.limit) {
      const match = QUOTE.exec(this.lines[this.index]!);
      if (!match) break;
      quoted.push(match[1]!);
      this.index++;
    }
    const nested = new BlockReader(quoted.join("\n"), { options: this.context.options, depth: this.context.depth + 1 });
    return <blockquote key={first.index}>{nested.read().blocks}</blockquote>;
  }

  private list(first: SourceLine, match: RegExpExecArray) {
    const ordered = !match[1];
    const items = [match[2]!];
    while (this.index < this.limit) {
      const item = LIST.exec(this.lines[this.index]!);
      if (!item || !item[1] !== ordered) break;
      items.push(item[2]!);
      this.index++;
    }
    const List = ordered ? "ol" : "ul";
    return <List key={first.index}>{items.map((text, index) => <li key={index}>{this.inline(text)}</li>)}</List>;
  }

  private paragraph(first: SourceLine) {
    const lines = [first.text];
    while (this.index < this.limit) {
      const next = this.lines[this.index]!;
      if (!next.trim() || BLOCK_START.test(next)) break;
      if (this.isQuote(next)) break;
      lines.push(next);
      this.index++;
    }
    return <p key={first.index}>{this.inline(lines.join("\n"))}</p>;
  }
}

/** Headings rendered by `<DocumentBody idPrefix>`; ids match the rendered heading ids. */
export function documentOutline(body: string, idPrefix: string) {
  return new BlockReader(body, { idPrefix, options: {}, depth: 0 }).read().outline;
}

/** Bounded document formatting; inline code, strong and emphasis render, while HTML, links and other inline syntax stay literal.
 * With `idPrefix`, headings get stable ids so a section outline can jump to them. `links` and `quotes` opt in to
 * http(s) links (opened in a new tab, without opener or referrer) and block quotes; raw HTML always stays text. */
export function DocumentBody({ body, idPrefix, links = false, quotes = false }: { body: string; idPrefix?: string } & DocumentOptions) {
  const { blocks } = useMemo(() => new BlockReader(body, { idPrefix, options: { links, quotes }, depth: 0 }).read(), [body, idPrefix, links, quotes]);
  return <div className={styles.documentBody} data-document-body>{blocks.length ? blocks : <p>No body recorded.</p>}</div>;
}
