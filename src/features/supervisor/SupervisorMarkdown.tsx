import { memo, type ComponentProps } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./SupervisorConversation.module.css";

const external = /^https?:\/\//i;
// Raw HTML is dropped (skipHtml) and react-markdown's default urlTransform strips
// javascript:/data:/vbscript: targets; images are never fetched from message text.
const components: Components = {
  h1: "h3", h2: "h4", h3: "h5", h4: "h6", h5: "h6",
  a: ({ node: _node, href, children, ...rest }: ComponentProps<"a"> & { node?: unknown }) => external.test(href ?? "")
    ? <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
    : <a {...rest} href={href}>{children}</a>,
  // Wide tables scroll inside their own focusable region instead of widening the chat.
  table: ({ node: _node, ...rest }: ComponentProps<"table"> & { node?: unknown }) =>
    <div className={styles.tableScroll} role="region" aria-label="Table" tabIndex={0}><table {...rest} /></div>,
};

/** Safe client-side Markdown for supervisor replies. The stored message text is never altered; partial
 * Markdown (an open fence, half a table) renders as whatever it parses to so far. */
export const SupervisorMarkdown = memo(function SupervisorMarkdown({ source }: { source: string }) {
  return <div className={`${styles.body} ${styles.markdown}`}>
    <Markdown remarkPlugins={[remarkGfm]} skipHtml disallowedElements={["img"]} components={components}>{source}</Markdown>
  </div>;
});
