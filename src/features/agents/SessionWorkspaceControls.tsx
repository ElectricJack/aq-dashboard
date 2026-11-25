import { useEffect, useId, useRef, type ReactNode } from "react";
import { Columns2, Maximize2, Monitor, X } from "lucide-react";
import styles from "./Agents.module.css";
import { Icon } from "../../components/icons";
import { ActionButton } from "../../components/layout/Workspace";
import { type ViewChange } from "./useSessionWorkspace";

/** Reference 08: Focus / Split view / Expand on the header row. Phone (reference 11) offers
 * Expand only: no split fits there, so sessions stay one at a time behind the name's ▾. */
export function ViewControl({
  split,
  expanded,
  splitReason,
  onChange,
  expandId,
  phone,
}: {
  split: boolean;
  expanded: boolean;
  splitReason: string | null;
  onChange: ViewChange;
  expandId: string;
  phone: boolean;
}) {
  const reasonId = useId();
  return (
    <div className={styles.viewControl}>
      <div role="group" aria-label="Workspace view" className={styles.viewButtons}>
        {!phone && (
          <>
            <ActionButton aria-pressed={!split} onClick={() => onChange({ layout: "focus" })}>
              <Icon icon={Monitor} size={18} />
              <span className={styles.viewText}>Focus</span>
            </ActionButton>
            <ActionButton
              aria-pressed={split}
              disabled={splitReason !== null}
              aria-describedby={splitReason ? reasonId : undefined}
              onClick={() => onChange({ layout: "split" })}
            >
              <Icon icon={Columns2} size={18} />
              <span className={styles.viewText}>Split view</span>
            </ActionButton>
          </>
        )}
        <ActionButton id={expandId} aria-pressed={expanded} onClick={() => onChange({ expanded: !expanded })}>
          <Icon icon={Maximize2} size={18} />
          <span className={styles.viewText}>
            Expand<span className="visually-hidden"> workspace</span>
          </span>
        </ActionButton>
      </div>
      {!phone && splitReason && (
        <span id={reasonId} className={styles.splitReason}>
          {splitReason}
        </span>
      )}
    </div>
  );
}

/** On-demand drawer: right side over the workspace on desktop, bottom sheet on phone.
 * Modal while open (focus contained, Esc closes); focus returns to the opener. */
export function SessionDrawer({
  id,
  title,
  open,
  wide,
  onClose,
  returnFocus,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  wide?: boolean;
  onClose: () => void;
  returnFocus: React.RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus();
    }
  }, [open, returnFocus]);
  return (
    <dialog
      ref={ref}
      id={id}
      aria-labelledby={headingId}
      className={styles.drawer}
      data-wide={wide || undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {open && (
        <>
          <div className={styles.drawerHeader}>
            <h2 id={headingId}>{title}</h2>
            <ActionButton onClick={onClose}>
              <Icon icon={X} size={18} />
              Close
            </ActionButton>
          </div>
          <div className={styles.drawerBody} tabIndex={0} aria-labelledby={headingId} role="region">
            {children}
          </div>
        </>
      )}
    </dialog>
  );
}
