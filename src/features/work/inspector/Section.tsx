import { useId, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useSectionOpen, type SectionId } from "./sections";
import styles from "./Inspector.module.css";

/**
 * A foldable inspector section (spec 0004 §3): a heading whose button discloses the body. A closed section
 * renders no body, so its reads wait until it is opened. `summary` is a short fact shown beside the heading
 * (for example a count) that stays visible while the section is closed.
 */
export function Section({ id, title, summary, children }: { id: SectionId; title: string; summary?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useSectionOpen(id), body = useId();
  return <section className={styles.section} data-section={id} data-open={open}>
    <div className={styles.sectionHead}>
      <h3><button type="button" aria-expanded={open} aria-controls={open ? body : undefined} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} aria-hidden className={styles.chevron} />{title}
      </button></h3>
      {summary !== undefined && summary !== null && <span className={styles.sectionSummary}>{summary}</span>}
    </div>
    {open && <div id={body} className={styles.sectionBody}>{children}</div>}
  </section>;
}

/** A bounded preview with "Show all" for sections that grow (Comments, Attempts, History). */
export function ShowAll({ shown, total, noun, onShowAll, expanded }: { shown: number; total: number; noun: string; expanded: boolean; onShowAll(on: boolean): void }) {
  if (total <= shown && !expanded) return null;
  return <button type="button" className={styles.linkButton} aria-expanded={expanded} onClick={() => onShowAll(!expanded)}>
    {expanded ? "Show fewer" : `Show all ${total} ${noun}`}
  </button>;
}
