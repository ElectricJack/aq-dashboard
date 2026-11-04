import { useMemo, type ReactNode } from "react";
import styles from "./HumanNodeWorkspace.module.css";

export type DocumentOutlineEntry = { id: string; text: string; level: number };

const slug = (text: string) => text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "section";

/** Bounded parse shared by the rendered body and its section outline. */
function parseDocument(body: string, idPrefix?: string) {
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
      blocks.push(<Heading key={i++} id={id} tabIndex={id ? -1 : undefined}>{text}</Heading>); continue;
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
      blocks.push(<List key={start}>{items.map((text, index) => <li key={index}>{text}</li>)}</List>); continue;
    }
    const start = i, paragraph = [lines[i++]!];
    while (i < maxLines && lines[i]!.trim() && !/^(?:#{1,6}\s|\s*```|\s*[-+*]\s|\s*\d+\.\s)/.test(lines[i]!)) paragraph.push(lines[i++]!);
    blocks.push(<p key={start}>{paragraph.join("\n")}</p>);
  }
  if (i < lines.length) blocks.push(<p key="truncated" role="status">Document preview truncated at its rendering limit.</p>);
  return { blocks, outline };
}

/** Headings rendered by `<DocumentBody idPrefix>`; ids match the rendered heading ids. */
export function documentOutline(body: string, idPrefix: string) {
  return parseDocument(body, idPrefix).outline;
}

/** Bounded document formatting; HTML, links and unsupported inline syntax stay literal.
 * With `idPrefix`, headings get stable ids so a section outline can jump to them. */
export function DocumentBody({ body, idPrefix }: { body: string; idPrefix?: string }) {
  const { blocks } = useMemo(() => parseDocument(body, idPrefix), [body, idPrefix]);
  return <div className={styles.documentBody} data-document-body>{blocks.length ? blocks : <p>No body recorded.</p>}</div>;
}
