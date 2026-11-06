import { useMemo, type ReactNode } from "react";
import styles from "./HumanNodeWorkspace.module.css";

export type DocumentOutlineEntry = { id: string; text: string; level: number };

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section";

/** Inline spans: `code`, **strong** / __strong__ and *emphasis* / _emphasis_. Code content stays literal;
 * links, images and HTML are never interpreted. Bounded per block so a pathological line stays cheap. */
const INLINE = /(`+)(?!`)([^`]{0,1000}?[^`])\1(?!`)|\*\*(?=\S)([\s\S]{0,1000}?\S)\*\*|(?<![\p{L}\p{N}_])__(?=\S)([\s\S]{0,1000}?\S)__(?![\p{L}\p{N}_])|\*(?=[^\s*])([^*]{0,1000}?[^\s*])\*|(?<![\p{L}\p{N}_])_(?=[^\s_])([^_]{0,1000}?[^\s_])_(?![\p{L}\p{N}_])/gu;
/**
 * Opt-in links (`links`): `[text](https://…)`, `<https://…>` and bare `http(s)://` URLs. Only http and https
 * targets become links; any other `[text](target)` stays literal. They come first so a URL's own `_` or `*`
 * never reads as emphasis.
 */
const LINKS = String.raw`\[([^\[\]\n]{1,500})\]\((https?:\/\/[^\s()<>]{1,2000})\)|<(https?:\/\/[^\s<>]{1,2000})>|(?<![\p{L}\p{N}_\/.:@+-])(https?:\/\/[^\s<>]{1,2000})`;
// The code span's closing-backtick backreference shifts past the four link groups.
const INLINE_LINKS = new RegExp(`${LINKS}|${INLINE.source.replace("\\1", "\\5")}`, "gu");
/** A bare URL doesn't end in sentence punctuation, or in a closing bracket it didn't open. */
function trimUrl(url: string): string {
  let end = url.length;
  for (;;) {
    const c = url[end - 1];
    if (c && ".,;:!?'\"*_".includes(c)) { end--; continue; }
    if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[", body = url.slice(0, end);
      if (body.split(open).length - 1 < body.split(c).length - 1) { end--; continue; }
    }
    return url.slice(0, end);
  }
}
/** An http(s) URL the browser parses as one, or null. */
function safeHref(url: string): string | null {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}
export type InlineOptions = { links?: boolean };
const MAX_INLINE_SPANS = 256, MAX_INLINE_TEXT = 16384;
export function renderInline(text: string, depth = 0, options: InlineOptions = {}): ReactNode[] {
  if (text.length > MAX_INLINE_TEXT) return [text];
  const out: ReactNode[] = [];
  // With links, the inline groups follow the four link groups.
  const pattern = options.links ? INLINE_LINKS : INLINE, g = options.links ? 4 : 0;
  let last = 0, spans = 0;
  for (const m of text.matchAll(pattern)) {
    if (spans++ >= MAX_INLINE_SPANS) break;
    const at = m.index!;
    if (at < last) continue;
    const key = `${depth}-${at}`;
    if (options.links && (m[1] !== undefined || m[3] !== undefined || m[4] !== undefined)) {
      const target = m[1] !== undefined ? m[2]! : m[3] ?? trimUrl(m[4]!), href = safeHref(target);
      if (!href) continue;
      if (at > last) out.push(text.slice(last, at));
      // Link text is formatted but never linked again (no nested anchors).
      const label = m[1] !== undefined ? (depth < 2 ? renderInline(m[1], depth + 1, { links: false }) : m[1]) : target;
      out.push(<a key={key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>);
      last = at + (m[4] !== undefined ? target.length : m[0].length);
      continue;
    }
    if (at > last) out.push(text.slice(last, at));
    if (m[g + 2] !== undefined) { const code = m[g + 2]!; out.push(<code key={key}>{code.length > 2 && code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code}</code>); }
    else if (m[g + 3] !== undefined || m[g + 4] !== undefined) { const inner = (m[g + 3] ?? m[g + 4])!; out.push(<strong key={key}>{depth < 2 ? renderInline(inner, depth + 1, options) : inner}</strong>); }
    else { const inner = (m[g + 5] ?? m[g + 6])!; out.push(<em key={key}>{depth < 2 ? renderInline(inner, depth + 1, options) : inner}</em>); }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Opt-in syntax beyond the document subset: links (see `LINKS`) and `>` block quotes. */
export type DocumentOptions = { links?: boolean; quotes?: boolean };
const QUOTE = /^\s{0,3}>\s?(.*)$/, MAX_QUOTE_DEPTH = 4;

/** Bounded parse shared by the rendered body and its section outline. */
function parseDocument(body: string, idPrefix?: string, options: DocumentOptions = {}, depth = 0) {
  const inline = (text: string) => renderInline(text, 0, { links: options.links });
  const quoting = options.quotes && depth < MAX_QUOTE_DEPTH;
  const lines = body.slice(0, 262144).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  const outline: DocumentOutlineEntry[] = [];
  const used = new Map<string, number>();
  const maxLines = Math.min(lines.length, 1024);
  let i = 0;
  for (; i < maxLines && blocks.length < 512;) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const start = i++, code: string[] = [];
      while (i < maxLines && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < maxLines) i++;
      blocks.push(<pre key={start}><code>{code.join("\n")}</code></pre>); continue;
    }
    const heading = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/.exec(line);
    if (heading) {
      const level = heading[1]!.length, text = heading[2]!;
      const Heading = `h${Math.min(6, level + 2)}` as "h3" | "h4" | "h5" | "h6";
      let id: string | undefined;
      if (idPrefix) {
        const base = `${idPrefix}-${slug(text)}`, seen = (used.get(base) ?? 0) + 1;
        used.set(base, seen);
        id = seen > 1 ? `${base}-${seen}` : base;
        // Section navigation lists the top three markdown levels only.
        if (level <= 3 && outline.length < 24) outline.push({ id, text, level });
      }
      blocks.push(<Heading key={i++} id={id} tabIndex={id ? -1 : undefined}>{inline(text)}</Heading>); continue;
    }
    if (quoting && QUOTE.test(line)) {
      const start = i, quoted: string[] = [];
      while (i < maxLines && QUOTE.test(lines[i]!)) quoted.push(QUOTE.exec(lines[i++]!)![1]!);
      blocks.push(<blockquote key={start}>{parseDocument(quoted.join("\n"), undefined, options, depth + 1).blocks}</blockquote>); continue;
    }
    const list = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(line);
    if (list) {
      const start = i, ordered = !list[1], items: string[] = [];
      while (i < maxLines) {
        const item = /^\s*(?:([-+*])|\d+\.)\s+(.+)$/.exec(lines[i]!);
        if (!item || !item[1] !== ordered) break;
        items.push(item[2]!); i++;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(<List key={start}>{items.map((text, index) => <li key={index}>{inline(text)}</li>)}</List>); continue;
    }
    const start = i, paragraph = [lines[i++]!];
    while (i < maxLines && lines[i]!.trim() && !/^(?:#{1,6}\s|\s*```|\s*[-+*]\s|\s*\d+\.\s)/.test(lines[i]!) && !(quoting && QUOTE.test(lines[i]!))) paragraph.push(lines[i++]!);
    blocks.push(<p key={start}>{inline(paragraph.join("\n"))}</p>);
  }
  if (i < lines.length) blocks.push(<p key="truncated" role="status">Document preview truncated at its rendering limit.</p>);
  return { blocks, outline };
}

/** Headings rendered by `<DocumentBody idPrefix>`; ids match the rendered heading ids. */
export function documentOutline(body: string, idPrefix: string) {
  return parseDocument(body, idPrefix).outline;
}

/** Bounded document formatting; inline code, strong and emphasis render, while HTML, links and other inline syntax stay literal.
 * With `idPrefix`, headings get stable ids so a section outline can jump to them. `links` and `quotes` opt in to
 * http(s) links (opened in a new tab, without opener or referrer) and block quotes; raw HTML always stays text. */
export function DocumentBody({ body, idPrefix, links = false, quotes = false }: { body: string; idPrefix?: string } & DocumentOptions) {
  const { blocks } = useMemo(() => parseDocument(body, idPrefix, { links, quotes }), [body, idPrefix, links, quotes]);
  return <div className={styles.documentBody} data-document-body>{blocks.length ? blocks : <p>No body recorded.</p>}</div>;
}
