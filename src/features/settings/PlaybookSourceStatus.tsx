import { Latest } from "./LatestPlaybookRun";
import { useEffect, useId, useRef, useState } from "react";
import { sourceFailure, type ActivePlaybook, type PlaybookCase, type PlaybookChange, type SourceView } from "../../api/playbookSources";
import { ActionButton } from "../../components/layout/Workspace";
import { InternalRun } from "../internal/InternalRun";
import { Timestamp } from "./Timestamp";
import styles from "./PlaybookSourceStatus.module.css";

/** The kind of internal work the authoring service files its runs under. */
export const PLAYBOOK_SOURCE_AFFECTED_KIND = "playbook_source";
/** Above this many cases the table is grouped by result so it stays readable (the server sends at most 40). */
export const GROUP_CASES_ABOVE = 12;
const CHANGES: Record<PlaybookChange, { label: string; detail: string }> = {
  none: { label: "No change", detail: "It is the same as the previous playbook." },
  wording: { label: "Wording only", detail: "Only the wording differs from the previous playbook. It behaves the same." },
  behaviour: { label: "Behaviour changed", detail: "It behaves differently from the previous playbook in some situations." },
  abilities: { label: "Abilities changed", detail: "It needs different abilities than the previous playbook." },
};

export { elapsed, PlaybookQuestion } from "./LatestPlaybookRun";

function Mark({ passed }: { passed: boolean }) {
  return passed ? <span className={styles.passed}><span aria-hidden="true">✓ </span>Passed</span> : <span className={styles.failed}><span aria-hidden="true">✗ </span>Did not pass</span>;
}
function CasesFlat({ cases }: { cases: PlaybookCase[] }) {
  return <table className={styles.table} aria-label="What the playbook does in each situation">
    <thead><tr><th scope="col">Situation</th><th scope="col">Result</th><th scope="col">Check</th></tr></thead>
    <tbody>{cases.map((one, index) => <tr key={index}>
      <td data-label="Situation" className={styles.text}>{one.situation}</td>
      <td data-label="Result" className={styles.text}>{one.result}</td>
      <td data-label="Check"><Mark passed={one.passed} /></td>
    </tr>)}</tbody>
  </table>;
}
function Group({ result, members }: { result: string; members: PlaybookCase[] }) {
  const id = useId();
  return <section className={styles.group} aria-labelledby={id}>
    <h5 id={id} className={styles.text}>{result} <span className={styles.meta}>({members.length} {members.length === 1 ? "situation" : "situations"})</span></h5>
    <ul>{members.map((one, index) => <li key={index}><span className={styles.text}>{one.situation}</span><Mark passed={one.passed} /></li>)}</ul>
  </section>;
}
function groupCases(cases: PlaybookCase[]) {
  const groups = new Map<string, PlaybookCase[]>();
  for (const one of cases) groups.set(one.result, [...(groups.get(one.result) ?? []), one]);
  return groups;
}

/** Many cases: one block per result, so the owner reads each result once with its situations under it. */
function CasesGrouped({ cases }: { cases: PlaybookCase[] }) {
  const groups = groupCases(cases);
  const ordered = [...groups.entries()].sort(([, a], [, b]) => Number(b.some(one => !one.passed)) - Number(a.some(one => !one.passed)));
  return <div className={styles.groups} aria-label="What the playbook does in each situation" role="group">
    {ordered.map(([result, members]) => <Group key={result} result={result} members={members} />)}
  </div>;
}

const when = (ms: number) => <Timestamp iso={new Date(ms).toISOString()} />;

/** Two steps: the button asks, and the owner confirms knowing what comes back and what stops. Keeping the current playbook is the focused default. */
function RollbackConfirm({ active, busy, onConfirm, onCancel }: { active: ActivePlaybook; busy: boolean; onConfirm: () => void; onCancel: () => void }) {
  const id = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => { keep.current?.focus(); }, []);
  return <div className={styles.confirm} role="group" aria-labelledby={id} onKeyDown={event => { if (event.key === "Escape") onCancel(); }}>
    <h5 id={id}>Put the previous playbook back?</h5>
    <p>{active.previous && active.previous.since_ms > 0 ? <>The previous playbook, which took effect {when(active.previous.since_ms)}, becomes the one in effect.</> : "The previous playbook becomes the one in effect."}</p>
    {active.previous?.summary && <p className={styles.text}>{active.previous.summary}</p>}
    <p>The current playbook, in effect since {when(active.since_ms)}, stops. Tasks routed from now on follow the previous playbook.</p>
    <div className={styles.actions}>
      <ActionButton ref={keep} disabled={busy} onClick={onCancel}>Keep the current playbook</ActionButton>
      <ActionButton disabled={busy} onClick={onConfirm}>Roll back</ActionButton>
    </div>
  </div>;
}

function groupRepeatedResults(cases: PlaybookCase[]) {
  // Grouping by result only helps when it makes the list shorter.
  return cases.length > GROUP_CASES_ABOVE && new Set(cases.map(one => one.result)).size < cases.length;
}

function ActiveCases({ active }: { active: ActivePlaybook }) {
  const passed = active.cases.filter(one => one.passed).length;
  // A failing case comes first: it is what the owner most needs to see.
  const cases = [...active.cases].sort((a, b) => Number(a.passed) - Number(b.passed));
  const grouped = groupRepeatedResults(active.cases);
  return active.cases.length === 0 ? <p className={styles.meta}>No situations were tried on it.</p> : <>
      <p className={styles.meta}>Each situation was tried on this playbook: {passed} of {active.cases.length} passed.</p>
      {grouped ? <CasesGrouped cases={cases} /> : <CasesFlat cases={cases} />}
    </>;
}

function Rollback({ active, onRollback }: { active: ActivePlaybook; onRollback: () => Promise<unknown> }) {
  const [confirming, setConfirming] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rollBack = async () => {
    setRolling(true); setError(null);
    try { await onRollback(); } catch (caught) { setError(sourceFailure(caught, "The previous playbook could not be put back.")); } finally { setRolling(false); setConfirming(false); }
  };
  if (!active.can_rollback) return null;
  return confirming
      ? <RollbackConfirm active={active} busy={rolling} onConfirm={() => void rollBack()} onCancel={() => setConfirming(false)} />
      : <div className={styles.actions}>
        <ActionButton onClick={() => setConfirming(true)}>Roll back to the previous playbook</ActionButton>
        {error && <span className={styles.failed} role="alert">{error}</span>}
      </div>;
}

function Comparison({ active }: { active: ActivePlaybook }) {
  const change = active.comparison ? CHANGES[active.comparison.change] : null;
  return change ? <p className={styles.change}><strong>{change.label}.</strong> {change.detail}</p> : <p className={styles.meta}>There is no earlier playbook to compare it with.</p>;
}

function Active({ active, onRollback }: { active: ActivePlaybook; onRollback: () => Promise<unknown> }) {
  const heading = useId();

  return <section className={styles.active} aria-labelledby={heading}>
    <h4 id={heading}>What the playbook does</h4>
    <p className={styles.meta}>In effect since {when(active.since_ms)}.</p>
    <Comparison active={active} />
    <ActiveCases active={active} />
    <Rollback active={active} onRollback={onRollback} />
  </section>;
}

/** Starts another run from the saved document. The server starts none when nothing changed, and the owner is told so. */
function AuthorAgain({ onAuthorAgain }: { onAuthorAgain: () => Promise<SourceView> }) {
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; failed: boolean } | null>(null);
  const start = async () => {
    setBusy(true); setSaid(null);
    try {
      const view = await onAuthorAgain();
      if (view.latest?.status !== "running") setSaid({ text: "Nothing has changed since this playbook was written, so no new run was started.", failed: false });
    } catch (caught) { setSaid({ text: sourceFailure(caught, "A new run could not be started."), failed: true }); } finally { setBusy(false); }
  };
  return <div className={styles.actions}>
    <ActionButton disabled={busy} onClick={() => void start()}>Author again</ActionButton>
    {said && (said.failed ? <span className={styles.failed} role="alert">{said.text}</span> : <span className={styles.meta} role="status">{said.text}</span>)}
  </div>;
}

/**
 * What an authoring run did to a source's playbook: writing now, a question, what could not be carried out, and
 * what the playbook in effect does (cases, change from the previous one) with a way back to the previous one.
 * Everything shown from a run is untrusted text and is rendered as text only.
 */
export function PlaybookSourceStatus({ source, onRollback, onAuthorAgain, showQuestion = true }: {
  source: SourceView; onRollback: () => Promise<unknown>;
  /** Given, an "Author again" button is offered whenever no run is in progress. */
  onAuthorAgain?: () => Promise<SourceView>;
  /** False when the caller shows the question itself (beside the document editor). */
  showQuestion?: boolean;
}) {
  const { active, latest } = source;
  return <div className={styles.status}>
    {latest ? <Latest latest={latest} hasActive={active !== null} showQuestion={showQuestion} /> : active === null && <p className={styles.meta}>There is no playbook yet. Save the document and an agent will write one from it.</p>}
    {active && <Active active={active} onRollback={onRollback} />}
    {onAuthorAgain && latest?.status !== "running" && <AuthorAgain onAuthorAgain={onAuthorAgain} />}
    {latest && <InternalRun affectedKind={PLAYBOOK_SOURCE_AFFECTED_KIND} affectedId={source.id} />}
  </div>;
}
