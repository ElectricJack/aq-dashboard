import { CircleCheck, CircleDashed, CircleDot, CircleHelp, CirclePause, CirclePlay, CircleX, Circle, type LucideIcon } from "lucide-react";
import { TASK_STATUS_LABEL, type TaskStatus } from "./labels";
import styles from "./StatusIcon.module.css";

/** A distinct shape per status (WCAG 1.4.1): colour is never the only difference. */
const SHAPE: Record<TaskStatus, LucideIcon> = {
  draft: CircleDashed, active: Circle, ready: CircleDot, running: CirclePlay, waiting: CirclePause,
  unknown: CircleHelp, completed: CircleCheck, canceled: CircleX,
};

/** The status bullet: its accessible name and tooltip are the status (spec 0004 item 16). */
export function StatusIcon({ status, size = 18, decorative = false }: { status: TaskStatus; size?: number; decorative?: boolean }) {
  const Glyph = SHAPE[status], label = TASK_STATUS_LABEL[status];
  if (decorative) return <Glyph size={size} aria-hidden className={styles.icon} data-status={status} />;
  return <span role="img" aria-label={label} title={label} className={styles.icon} data-status={status}><Glyph size={size} aria-hidden /></span>;
}
