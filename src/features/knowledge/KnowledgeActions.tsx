import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useSession } from "../../app/session";
import { type GraphEnvelope, type GraphNode } from "../../api/adapters/humanGraph";
import { ActionButton } from "../../components/layout/Workspace";
import { RecordActions } from "../actions/RecordActions";
import { actionCapability, actionLabels, knowledgeActionKinds, type ActionKind } from "../actions/actionClient";
import styles from "./HumanNodeWorkspace.module.css";

type Availability = { enabled: true } | { enabled: false; reason: string };
function useActionAvailability() {
  const { bootstrap } = useSession();
  return (kind: ActionKind): Availability => {
    const union = bootstrap.capability("dashboard.actions");
    const cap = union.enabled ? bootstrap.capability(actionCapability(kind)) : union;
    return cap.enabled ? { enabled: true } : { enabled: false, reason: cap.reason ?? "Not available" };
  };
}

/**
 * A disabled action that keeps its reason out of the layout: the reason is the
 * button's accessible description and appears as a tooltip on hover, focus or tap.
 */
export function UnavailableAction({ label, reason, icon }: { label: string; reason: string; icon?: ReactNode }) {
  const [shown, setShown] = useState(false);
  const tip = useId();
  return <span className={styles.tipAnchor} onMouseEnter={() => setShown(true)} onMouseLeave={() => setShown(false)}>
    <ActionButton aria-disabled="true" className={styles.unavailable} title={shown ? undefined : reason} aria-describedby={shown ? tip : undefined}
      onFocus={() => setShown(true)} onBlur={() => setShown(false)} onClick={() => setShown(v => !v)} onKeyDown={e => { if (e.key === "Escape") setShown(false); }}>
      {icon}{label}
    </ActionButton>
    {shown && <span role="tooltip" id={tip} className={styles.tooltip}>{reason}</span>}
  </span>;
}

/** Page-header "Add record": the real action when offered, otherwise one disabled button with its reason. */
export function AddRecordAction({ project, pendingReason }: { project?: GraphEnvelope<unknown>["project"]; pendingReason: string }) {
  const available = useActionAvailability()("knowledge.author");
  if (!available.enabled) return <UnavailableAction label={actionLabels["knowledge.author"]} reason={available.reason} icon={<Plus size={18} aria-hidden />} />;
  if (!project) return <UnavailableAction label={actionLabels["knowledge.author"]} reason={pendingReason} icon={<Plus size={18} aria-hidden />} />;
  return <div className={styles.headerAction}><RecordActions record={{ project }} author /></div>;
}

/**
 * Document header slot: offered actions as buttons; unavailable ones sit in one "Actions" menu whose items carry the reasons.
 * A retired record offers only Restore (ISSUE-004); an active one Correct, Verify and Retire.
 */
export function DocumentActions({ record, pinned }: { record: GraphEnvelope<GraphNode>; pinned?: string }) {
  const availability = useActionAvailability();
  const reasons = knowledgeActionKinds(record.data).map(kind => {
    const available = availability(kind);
    return { kind, reason: pinned ? "Open the current revision to act" : available.enabled ? undefined : available.reason };
  });
  const offered = reasons.filter(r => !r.reason).map(r => r.kind);
  const unavailable = reasons.flatMap(r => r.reason ? [{ label: actionLabels[r.kind], reason: r.reason }] : []);
  return <div className={styles.documentActions}>
    {offered.length > 0 && <div className={styles.headerAction}><RecordActions record={record} pinned={pinned} kinds={offered} /></div>}
    {unavailable.length > 0 && <ActionsMenu items={unavailable} />}
  </div>;
}

function ActionsMenu({ items }: { items: { label: string; reason: string }[] }) {
  const [open, setOpen] = useState(false);
  const menu = useId(), root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  return <div ref={root} className={styles.actionsMenu} onKeyDown={e => { if (e.key === "Escape" && open) { setOpen(false); root.current?.querySelector<HTMLButtonElement>("button")?.focus(); } }}>
    <ActionButton aria-expanded={open} aria-controls={open ? menu : undefined} onClick={() => setOpen(v => !v)}>Actions<ChevronDown size={18} aria-hidden /></ActionButton>
    {open && <ul id={menu} className={styles.actionsList} aria-label="Record actions">
      {items.map(item => <li key={item.label}><span className={styles.actionName}>{item.label}</span><span className={styles.meta}>{item.reason}</span></li>)}
    </ul>}
  </div>;
}
