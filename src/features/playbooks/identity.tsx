import type { ReactNode } from "react";
import { DetailList } from "../../components/layout/Workspace";
import styles from "./Playbooks.module.css";

/** `sha256:a81c9e…` → `a81c9e` (reference 06): a display label only; the full value stays in `title` and under Technical identity. */
export function shortDigest(digest: string) {
  const hex = digest.includes(":") ? digest.slice(digest.indexOf(":") + 1) : digest;
  return hex.slice(0, 6) || digest;
}

/** `run-0000000000000284` → `run-284`. Ids without zero padding are returned unchanged. */
export function shortRunId(id: string) {
  return id.replace(/^(.*-)0+(?=\d)/, "$1");
}

/** A short digest with its full value available on hover; never the only place the full value appears. */
export function Digest({ value }: { value: string }) {
  return <span className={styles.pin} title={value}>{shortDigest(value)}</span>;
}

/** Full digests, pins and exact times disclosed on demand (docs/specs/0002: technical identities grouped under details). */
export function TechnicalIdentity({ children, className }: { children: ReactNode; className?: string }) {
  return <details className={className ? `${styles.technical} ${className}` : styles.technical}>
    <summary>Technical identity</summary>
    <DetailList className={styles.definitionFacts}>{children}</DetailList>
  </details>;
}
