import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { statusLabel, type Receipt, type Run } from "../../api/adapters/playbooks";
import { formatAge } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";
import { Panel, Toolbar, ActionButton } from "../../components/layout/Workspace";
import styles from "./Playbooks.module.css";

/** `request-review` / `operation_accepted` → `Request review` / `Operation accepted`. */
export function humanize(value: string) {
  const words = value.replace(/[-_.]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : value;
}

export type StepState = "completed" | "failed" | "waiting" | "active" | "recorded";
export type TimelineStep = { step: string; label: string; state: StepState; status: string; current: boolean };

const SUCCESS = new Set(["ok", "success", "succeeded", "completed", "complete", "done", "passed", "pass"]);
const FAILURE = new Set(["failed", "failure", "fail", "error", "errored", "rejected", "conflict", "timeout", "timed_out", "cancelled", "canceled", "aborted"]);

function pastStep(step: string, receipts: Receipt[]): TimelineStep {
  const outcome = [...receipts].reverse().find(r => r.outcome !== null)?.outcome?.toLowerCase() ?? null;
  const base = { step, label: humanize(step), current: false };
  if (outcome === null) return { ...base, state: "recorded", status: "Recorded" };
  if (SUCCESS.has(outcome)) return { ...base, state: "completed", status: "Completed" };
  if (FAILURE.has(outcome)) return { ...base, state: "failed", status: "Failed" };
  return { ...base, state: "recorded", status: humanize(outcome) };
}

function currentStep(run: Run): TimelineStep {
  const state: StepState = run.status === "completed" ? "completed"
    : run.status === "failed" || run.status === "cancelled" ? "failed"
    : run.status === "waiting" || run.status === "blocked" ? "waiting" : "active";
  return { step: run.step, label: humanize(run.step), state, status: statusLabel(run.status), current: true };
}

/**
 * One node per distinct step in receipt order, then the run's current step.
 * Only steps evidenced by the loaded receipt page or `current_step` are drawn:
 * this read contract offers no definition step graph, so future steps are not invented.
 */
export function timelineSteps(receipts: Receipt[], run: Run): TimelineStep[] {
  const order: string[] = [], byStep = new Map<string, Receipt[]>();
  for (const r of receipts) {
    if (r.step === run.step) continue;
    if (!byStep.has(r.step)) { byStep.set(r.step, []); order.push(r.step); }
    byStep.get(r.step)!.push(r);
  }
  return [...order.map(step => pastStep(step, byStep.get(step)!)), currentStep(run)];
}

function NodeIcon({ state }: { state: StepState }) {
  return <span className={styles.stepNode} data-state={state} aria-hidden>
    {state === "completed" ? <Check size={22} strokeWidth={3} /> : state === "failed" ? <X size={22} strokeWidth={3} /> : state === "waiting" ? null : <span className={styles.stepCore} />}
  </span>;
}

export function RunTimeline({ receipts, run }: { receipts: Receipt[]; run: Run }) {
  const steps = timelineSteps(receipts, run);
  return <ol className={styles.steps} aria-label="Execution timeline" tabIndex={0}>
    {steps.map((s, i) => <li key={`${s.step}:${s.current}`} className={styles.step} data-state={s.state}
      data-connector={i === 0 ? undefined : s.current ? "dashed" : steps[i - 1]!.state === "completed" && s.state === "completed" ? "done" : "solid"}
      aria-current={s.current ? "step" : undefined}>
      <NodeIcon state={s.state} />
      <div className={styles.stepText}><strong>{s.label}</strong><span className={styles.stepStatus} data-state={s.state}>{s.status}</span></div>
    </li>)}
  </ol>;
}

function clockTime(ms: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
}

export function RecentEvidence({ receipts, next, paged, observedAt, receivedAt, onFirst, onNext }: {
  receipts: Receipt[]; next: string | null; paged: boolean; observedAt: number; receivedAt: number; onFirst: () => void; onNext: (cursor: string) => void;
}) {
  const observedIso = new Date(observedAt).toISOString();
  const now = useServerNow({ serverTime: observedIso, receivedAt });
  return <Panel title="Recent evidence" className={styles.evidence}
    actions={<span className={styles.meta} title={observedIso}>Observed {now ? formatAge(now, observedIso) : "unknown time"}</span>}>
    {receipts.length === 0 ? <p>No transition receipts available in this page.</p> : <div className={styles.evidenceWrap}>
      <table className={styles.evidenceTable} aria-label="Recent evidence">
        <thead><tr><th scope="col">Time</th><th scope="col">Event</th><th scope="col">Evidence</th></tr></thead>
        <tbody>{receipts.map(r => { const iso = new Date(r.at).toISOString(); return <tr key={r.sequence} id={`receipt-${r.sequence}`}>
          <td><time dateTime={iso} title={iso}>{clockTime(r.at)}</time></td>
          <td>{humanize(r.kind)} · {humanize(r.step)}{r.outcome ? <span className={styles.meta}> · {r.outcome}</span> : null}</td>
          <td><a href={`#receipt-${r.sequence}`}>Receipt {r.sequence}</a></td>
        </tr>; })}</tbody>
      </table>
    </div>}
    {(paged || next) && <Toolbar>{paged && <ActionButton onClick={onFirst}>First receipts</ActionButton>}{next && <ActionButton onClick={() => onNext(next)}>Next receipts</ActionButton>}</Toolbar>}
  </Panel>;
}

export type InspectorTab = "execution" | "events" | "inputs" | "definition";
const TABS: { key: InspectorTab; label: string; disabled?: string }[] = [
  { key: "execution", label: "Execution" }, { key: "events", label: "Events" },
  { key: "inputs", label: "Inputs & outputs", disabled: "Not offered by this read contract" }, { key: "definition", label: "Definition" },
];

/** Inspector sections as an ARIA tab set; disabled tabs stay visible with their reason in `title`. */
export function InspectorTabs({ id, tab, setTab, children }: { id: string; tab: InspectorTab; setTab: (t: InspectorTab) => void; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  const enabled = TABS.filter(t => !t.disabled).map(t => t.key);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = enabled.indexOf(tab), last = enabled.length - 1;
    const next = e.key === "ArrowRight" ? enabled[i === last ? 0 : i + 1] : e.key === "ArrowLeft" ? enabled[i === 0 ? last : i - 1] : e.key === "Home" ? enabled[0] : e.key === "End" ? enabled[last] : undefined;
    if (!next) return;
    e.preventDefault(); setTab(next); list.current?.querySelector<HTMLElement>(`#${id}-tab-${next}`)?.focus();
  };
  return <>
    <div ref={list} className={styles.inspectorTabs} role="tablist" aria-label="Run sections" onKeyDown={onKeyDown}>
      {TABS.map(t => <button key={t.key} id={`${id}-tab-${t.key}`} type="button" role="tab" aria-selected={tab === t.key}
        aria-controls={t.disabled ? undefined : `${id}-panel-${t.key}`} aria-disabled={t.disabled ? true : undefined} title={t.disabled}
        tabIndex={tab === t.key ? 0 : -1} onClick={() => { if (!t.disabled) setTab(t.key); }}>{t.label}</button>)}
    </div>
    <div id={`${id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${id}-tab-${tab}`} className={styles.tabPanel}>{children}</div>
  </>;
}
