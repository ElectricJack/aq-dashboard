import { Link } from "react-router";
import {
  ArrowRight, CircleCheck, CircleDashed, CircleDot, CircleHelp, CirclePause, CirclePlay, CircleSlash, CircleX, Clock,
  Cog, GitFork, LoaderCircle, TriangleAlert, UserRound, type LucideIcon,
} from "lucide-react";
import { statusLabel, type Effect, type Page, type Run } from "../../api/adapters/playbooks";
import { Icon } from "../../components/icons";
import { Panel } from "../../components/layout/Workspace";
import { humanize } from "./RunTimeline";
import styles from "./Playbooks.module.css";

/**
 * PB-F (reference 06-playbooks.png, "Waiting on" and "Child workflows").
 * Only facts from the run inspection are shown. The inspection contract supplies
 * no decision target or related-work ids (audit P15), so there is no
 * "Open decision" action and no related-work line until the server adds them.
 */

type WaitKind = { label: string; icon: LucideIcon };
const WAIT_KINDS: Record<string, WaitKind> = {
  decision: { label: "Human decision", icon: UserRound },
  child: { label: "Child workflow", icon: GitFork },
  child_run: { label: "Child workflow", icon: GitFork },
  child_workflow: { label: "Child workflow", icon: GitFork },
  effect: { label: "Operation", icon: Cog },
  operation: { label: "Operation", icon: Cog },
  investigation: { label: "Investigation", icon: TriangleAlert },
  timer: { label: "Timer", icon: Clock },
};
/** Typed label for a run's pending wait kind; unknown kinds keep their own words. */
export function waitKind(kind: string): WaitKind {
  const known = WAIT_KINDS[kind];
  if (known) return known;
  const words = kind.replaceAll("_", " ");
  return { label: words.charAt(0).toUpperCase() + words.slice(1), icon: CircleHelp };
}

const STATUS_ICON: Record<string, LucideIcon> = {
  admitted: CircleDot, running: CirclePlay, waiting: CirclePause, finishing: LoaderCircle, cancelling: CircleSlash,
  blocked: TriangleAlert, completed: CircleCheck, failed: CircleX, cancelled: CircleSlash,
};
function StatusGlyph({ status }: { status: string | null }) {
  const glyph = status ? STATUS_ICON[status] ?? CircleHelp : CircleDashed;
  return <span className={styles.glyph} data-state={status ?? "unknown"}><Icon icon={glyph} size={20} /></span>;
}

/** `run-0000000000000285` → `run-285`; other ids are shown as recorded. */
export function shortRunId(id: string) { return id.replace(/^run-0+(?=\d)/, "run-"); }

function RunLink({ id, search }: { id: string; search: string }) {
  return <Link className={styles.relationLink} title={id} to={{ pathname: `/playbooks/runs/${encodeURIComponent(id)}`, search }}>
    {shortRunId(id)}<Icon icon={ArrowRight} size={16} />
  </Link>;
}

export function WaitingOn({ run, effects }: { run: Run; effects: Page<Effect> }) {
  const kind = run.pendingKind ? waitKind(run.pendingKind) : null;
  return <Panel title="Waiting on" className={styles.relationPanel}>
    {kind
      ? <p className={styles.waitHeading}><span className={styles.waitIcon}><Icon icon={kind.icon} size={20} /></span><strong>{kind.label}</strong><span className={styles.meta} title={run.step}>{humanize(run.step)}</span></p>
      : <p className={styles.meta}>No pending wait recorded</p>}
    {run.reason && <p className={styles.reason}>{run.reason}</p>}
    {effects.items.length > 0 && <ul className={styles.relationRows} aria-label="Pending operations">{effects.items.map(e => <li key={e.id} className={styles.relationRow}>
      <span className={styles.glyph}><Icon icon={Cog} size={18} /></span>
      <div className={styles.relationText}><strong className={styles.command}>{e.command}</strong><span className={styles.meta}>{e.step}{e.cancelRequested ? " · Cancellation requested" : ""}</span></div>
      <span className={styles.relationStatus}>{e.status.replaceAll("_", " ")}</span>
    </li>)}</ul>}
    {effects.next && <p className={styles.meta}>Additional operations are not shown in this bounded view.</p>}
  </Panel>;
}

export function ChildWorkflows({ run, loaded, search }: { run: Run; loaded: readonly Run[]; search: string }) {
  const byId = new Map(loaded.map(r => [r.id, r]));
  return <Panel title={<span className={styles.panelTitle}><Icon icon={GitFork} size={20} />Child workflows</span>} className={styles.relationPanel}>
    {run.children.length > 0 && <ul className={styles.relationRows} aria-label="Child runs">{run.children.map(id => {
      const child = byId.get(id);
      if (!child) return <li key={id} className={styles.relationRow}>
        <StatusGlyph status={null} />
        <div className={styles.relationText}><span><RunLink id={id} search={search} /> <span className={styles.meta}>· status not loaded</span></span></div>
      </li>;
      return <li key={id} className={styles.relationRow}>
        <StatusGlyph status={child.status} />
        <div className={styles.relationText}><strong title={child.entry}>{humanize(child.entry)}</strong><span className={styles.meta}>Owned child{child.outcome ? ` · outcome ${child.outcome}` : ""}</span></div>
        <div className={styles.relationEnd}><span className={styles.relationStatus} data-state={child.status}>{statusLabel(child.status)}</span><RunLink id={id} search={search} /></div>
      </li>;
    })}</ul>}
    {run.children.length === 0 && <p className={styles.meta}>No child workflows recorded.</p>}
    {run.parent && <p className={styles.parent}>Parent workflow <RunLink id={run.parent} search={search} /></p>}
  </Panel>;
}
