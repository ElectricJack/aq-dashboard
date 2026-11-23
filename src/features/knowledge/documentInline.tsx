import type { ReactNode } from "react";

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
function trailingUrlPunctuation(url: string) {
  const last = url.at(-1);
  if (!last) return false;
  if (".,;:!?'\"*_".includes(last)) return true;
  if (last !== ")" && last !== "]") return false;
  const open = last === ")" ? "(" : "[";
  return url.split(open).length < url.split(last).length;
}

function trimUrl(url: string) {
  while (trailingUrlPunctuation(url)) url = url.slice(0, -1);
  return url;
}
/** An http(s) URL the browser parses as one, or null. */
function safeHref(url: string): string | null {
  try { const u = new URL(url); return u.protocol === "http:" || u.protocol === "https:" ? u.href : null; } catch { return null; }
}
export type InlineOptions = { links?: boolean };
const MAX_INLINE_SPANS = 256, MAX_INLINE_TEXT = 16384;
type SpanContext = { depth: number; key: string; options: InlineOptions; group: number };

function innerText(text: string, context: SpanContext, options = context.options) {
  return context.depth < 2 ? renderInline(text, context.depth + 1, options) : text;
}

function isLink(match: RegExpMatchArray) {
  return [match[1], match[3], match[4]].some(value => value !== undefined);
}

function linkSpan(match: RegExpMatchArray, context: SpanContext) {
  const target = match[2] ?? match[3] ?? trimUrl(match[4]!);
  const href = safeHref(target);
  if (!href) return null;
  const label = match[1] === undefined ? target : innerText(match[1], context, { links: false });
  const node = <a key={context.key} href={href} target="_blank" rel="noopener noreferrer">{label}</a>;
  return { node, size: match[4] === undefined ? match[0].length : target.length };
}

function codeText(code: string) {
  if (code.length <= 2) return code;
  return code.startsWith(" ") && code.endsWith(" ") ? code.slice(1, -1) : code;
}

function markupSpan(match: RegExpMatchArray, context: SpanContext) {
  const { group, key } = context;
  const code = match[group + 2];
  if (code !== undefined) return <code key={key}>{codeText(code)}</code>;
  const strong = match[group + 3] ?? match[group + 4];
  if (strong !== undefined) return <strong key={key}>{innerText(strong, context)}</strong>;
  return <em key={key}>{innerText((match[group + 5] ?? match[group + 6])!, context)}</em>;
}

function span(match: RegExpMatchArray, context: SpanContext) {
  if (context.options.links && isLink(match)) return linkSpan(match, context);
  return { node: markupSpan(match, context), size: match[0].length };
}

export function renderInline(text: string, depth = 0, options: InlineOptions = {}): ReactNode[] {
  if (text.length > MAX_INLINE_TEXT) return [text];
  const out: ReactNode[] = [];
  const { pattern, group } = options.links ? { pattern: INLINE_LINKS, group: 4 } : { pattern: INLINE, group: 0 };
  let last = 0, spans = 0;
  for (const match of text.matchAll(pattern)) {
    if (spans++ >= MAX_INLINE_SPANS) break;
    const at = match.index!;
    if (at < last) continue;
    const result = span(match, { depth, options, group, key: `${depth}-${at}` });
    if (!result) continue;
    if (at > last) out.push(text.slice(last, at));
    out.push(result.node);
    last = at + result.size;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
