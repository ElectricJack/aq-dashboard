import type { ReactNode } from "react";
import styles from "./HumanNodeWorkspace.module.css";

/** Bounded document formatting; HTML, links and unsupported inline syntax stay literal. */
export function DocumentBody({ body }: { body: string }) {
  const lines = body.slice(0, 262144).replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
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
      const Heading = `h${Math.min(6, heading[1]!.length + 2)}` as "h3" | "h4" | "h5" | "h6";
      blocks.push(<Heading key={i++}>{heading[2]}</Heading>); continue;
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
  return <div className={styles.documentBody} data-document-body>{blocks.length ? blocks : <p>No body recorded.</p>}</div>;
}
