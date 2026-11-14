import { useEffect, useId, useState } from "react";
import { ApiError } from "../../api/client";
import type { ActivePlaybook, AuthoringQuestion, LatestRun, PlaybookCase, PlaybookChange, SourceView } from "../../api/playbookSources";
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

/** Whole seconds or minutes and seconds, for how long a run has been going. */
export function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}
function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** The agent's question, with each sentence of the document it is about and its line number. Everything here is the agent's text, shown as text. */
export function PlaybookQuestion({ question }: { question: AuthoringQuestion }) {
  const id = useId();
  return <section className={styles.question} aria-labelledby={id}>
    <h4 id={id}>The playbook needs an answer</h4>
    <p className={styles.text}>{question.question}</p>
    {question.sentences.length > 0 && <>
      <p className={styles.meta}>These sentences in the document are what it is asking about. Change them, then save.</p>
      <ol className={styles.sentences} aria-label="Sentences in question">
        {question.sentences.map((sentence, index) => <li key={index}><span className={styles.line}>Line {sentence.line}</span><span className={styles.text}>{sentence.text}</span></li>)}
      </ol>
    </>}
  </section>;
}

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
/** Many cases: one block per result, so the owner reads each result once with its situations under it. */
function CasesGrouped({ cases }: { cases: PlaybookCase[] }) {
  const groups = new Map<string, PlaybookCase[]>();
  for (const one of cases) groups.set(one.result, [...(groups.get(one.result) ?? []), one]);
  const ordered = [...groups.entries()].sort(([, a], [, b]) => Number(b.some(one => !one.passed)) - Number(a.some(one => !one.passed)));
  return <div className={styles.groups} aria-label="What the playbook does in each situation" role="group">
    {ordered.map(([result, members]) => <Group key={result} result={result} members={members} />)}
  </div>;
}

function Active({ active, onRollback }: { active: ActivePlaybook; onRollback: () => Promise<unknown> }) {
  const [rolling, setRolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passed = active.cases.filter(one => one.passed).length;
  // A failing case comes first: it is what the owner most needs to see.
  const cases = [...active.cases].sort((a, b) => Number(a.passed) - Number(b.passed));
  const change = active.comparison ? CHANGES[active.comparison.change] : null;
  const rollBack = async () => {
    setRolling(true); setError(null);
    try { await onRollback(); } catch (caught) { setError(caught instanceof ApiError && caught.serverMessage ? caught.serverMessage : "The previous playbook could not be put back."); } finally { setRolling(false); }
  };
  return <section className={styles.active} aria-labelledby="playbook-active-heading">
    <h4 id="playbook-active-heading">What the playbook does</h4>
    <p className={styles.meta}>In effect since <Timestamp iso={new Date(active.since_ms).toISOString()} />.</p>
    {change ? <p className={styles.change}><strong>{change.label}.</strong> {change.detail}</p> : <p className={styles.meta}>There is no earlier playbook to compare it with.</p>}
    {active.cases.length === 0 ? <p className={styles.meta}>No situations were tried on it.</p> : <>
      <p className={styles.meta}>Each situation was tried on this playbook: {passed} of {active.cases.length} passed.</p>
      {active.cases.length > GROUP_CASES_ABOVE ? <CasesGrouped cases={cases} /> : <CasesFlat cases={cases} />}
    </>}
    {active.comparison && <div className={styles.actions}>
      <ActionButton disabled={rolling} onClick={() => void rollBack()}>Roll back to the previous playbook</ActionButton>
      {error && <span className={styles.failed} role="alert">{error}</span>}
    </div>}
  </section>;
}

function Latest({ latest, hasActive, showQuestion }: { latest: LatestRun; hasActive: boolean; showQuestion: boolean }) {
  const now = useNow(latest.status === "running");
  const still = hasActive ? "The previous playbook is still in effect." : "No playbook is in effect yet.";
  switch (latest.status) {
    case "running": return <div className={styles.notice} role="status">
      <p><strong>Writing the playbook…</strong> Running for {elapsed(now - latest.created_at_ms)}.</p>
      <p className={styles.meta}>{hasActive ? "The current playbook keeps working meanwhile. " : ""}Saving the document again replaces this run: the newest save wins.</p>
    </div>;
    case "question": return <div className={styles.notice}>
      {!latest.question ? <p><strong>The playbook needs an answer.</strong></p> : showQuestion && <PlaybookQuestion question={latest.question} />}
      <p className={styles.meta}>{still}</p>
    </div>;
    case "unable": return <div className={styles.problem} role="alert">
      <h4>{latest.unable.length > 1 ? "These sentences cannot be carried out" : "This sentence cannot be carried out"}</h4>
      {latest.unable.length === 0 && <p className={styles.meta}>The agent did not say which sentence.</p>}
      <ul className={styles.unable} aria-label="Sentences that cannot be carried out">
        {latest.unable.map((one, index) => <li key={index}>
          <p className={styles.text}>{one.line !== null && <span className={styles.line}>Line {one.line}</span>}{one.sentence}</p>
          <p className={styles.text}>{one.reason}</p>
        </li>)}
      </ul>
      <p className={styles.meta}>{still}</p>
    </div>;
    case "refused": return <div className={styles.problem} role="alert">
      <h4>The playbook was not written</h4>
      {latest.refusal && <p className={styles.text}>{latest.refusal}</p>}
      <p className={styles.meta}>{still}</p>
    </div>;
    case "superseded": return <div className={styles.notice} role="status">
      <p><strong>A newer save replaced this run.</strong> It did not take effect.</p>
      <p className={styles.meta}>{still}</p>
    </div>;
    case "failed": return <div className={styles.problem} role="alert">
      <h4>The run ended without a playbook</h4>
      <p className={styles.meta}>{still}</p>
    </div>;
    case "saved": return null;
    default: return <div className={styles.notice} role="status"><p>The latest run is in a state this page does not recognise.</p><p className={styles.meta}>{still}</p></div>;
  }
}

/**
 * What an authoring run did to a source's playbook: writing now, a question, what could not be carried out, and
 * what the playbook in effect does (cases, change from the previous one) with a way back to the previous one.
 * Everything shown from a run is untrusted text and is rendered as text only.
 */
export function PlaybookSourceStatus({ source, onRollback, showQuestion = true }: {
  source: SourceView; onRollback: () => Promise<unknown>;
  /** False when the caller shows the question itself (beside the document editor). */
  showQuestion?: boolean;
}) {
  const { active, latest } = source;
  return <div className={styles.status}>
    {latest ? <Latest latest={latest} hasActive={active !== null} showQuestion={showQuestion} /> : active === null && <p className={styles.meta}>There is no playbook yet. Save the document and an agent will write one from it.</p>}
    {active && <Active active={active} onRollback={onRollback} />}
    {latest && <InternalRun affectedKind={PLAYBOOK_SOURCE_AFFECTED_KIND} affectedId={source.id} />}
  </div>;
}
