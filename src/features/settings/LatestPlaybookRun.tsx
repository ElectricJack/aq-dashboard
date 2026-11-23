import { useEffect, useId, useMemo, useState } from "react";
import type { AuthoringQuestion, LatestRun } from "../../api/playbookSources";

import styles from "./PlaybookSourceStatus.module.css";

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

/** Whole seconds or minutes and seconds, for how long a run has been going. */
export function elapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

/** "Line 3", or "Lines 3–4" for a sentence that spans several lines. */
const lines = (line: number, end: number | null) => end !== null && end !== line ? `Lines ${line}–${end}` : `Line ${line}`;

/** The agent's question, with each sentence of the document it is about and its line number. Everything here is the agent's text, shown as text. */
export function PlaybookQuestion({ question }: { question: AuthoringQuestion }) {
  const id = useId();
  return <section className={styles.question} aria-labelledby={id}>
    <h4 id={id}>The playbook needs an answer</h4>
    <p className={styles.text}>{question.question}</p>
    {question.sentences.length > 0 && <>
      <p className={styles.meta}>These sentences in the document are what it is asking about. Change them, then save.</p>
      <ol className={styles.sentences} aria-label="Sentences in question">
        {question.sentences.map((sentence, index) => <li key={index}><span className={styles.line}>{lines(sentence.line, sentence.end_line)}</span><span className={styles.text}>{sentence.text}</span></li>)}
      </ol>
    </>}
  </section>;
}

function UnableRun({ latest, still }: { latest: LatestRun; still: string }) {
  return <div className={styles.problem} role="alert">
      <h4>{latest.unable?.host_fault ? "The playbook could not be written" : "This sentence cannot be carried out"}</h4>
      {latest.unable ? <div className={styles.unable}>
        <p className={styles.text}>{latest.unable.line !== null && <span className={styles.line}>Line {latest.unable.line}</span>}{latest.unable.sentence}</p>
        <p className={styles.text}>{latest.unable.reason}</p>
      </div> : <p className={styles.meta}>The agent did not say which sentence.</p>}
      <p className={styles.meta}>{still}</p>
    </div>;
}

function FailedRun({ latest, still }: { latest: LatestRun; still: string }) {
  return <div className={styles.problem} role="alert">
      <h4>{latest.status === "refused" ? "The playbook was not written" : "The run ended without a playbook"}</h4>
      {latest.refusal && <p className={styles.text}>{latest.refusal}</p>}
      <p className={styles.meta}>{still}</p>
    </div>;
}

function RunQuestion({ latest, still, showQuestion }: { latest: LatestRun; still: string; showQuestion: boolean }) {
  return <div className={styles.notice}>
      {!latest.question ? <p><strong>The playbook needs an answer.</strong></p> : showQuestion && <PlaybookQuestion question={latest.question} />}
      <p className={styles.meta}>{still}</p>
    </div>;
}

function RunningRun({ hasActive, duration }: { hasActive: boolean; duration: number }) {
  return <div className={styles.notice} role="status">
      <p><strong>Writing the playbook…</strong> Running for {elapsed(duration)}.</p>
      <p className={styles.meta}>{hasActive ? "The current playbook keeps working meanwhile. " : ""}Saving the document again replaces this run: the newest save wins.</p>
    </div>;
}

export function Latest({ latest, hasActive, showQuestion }: { latest: LatestRun; hasActive: boolean; showQuestion: boolean }) {
  const now = useNow(latest.status === "running");
  // The server says how long the run has taken by its own clock; this page only adds the time since it read that.
  const read = useMemo(() => Date.now(), [latest.run, latest.elapsed_ms]);
  const still = hasActive ? "The previous playbook is still in effect." : "No playbook is in effect yet.";
  switch (latest.status) {
    case "running": return <RunningRun hasActive={hasActive} duration={latest.elapsed_ms + Math.max(0, now - read)} />;
    case "question": return <RunQuestion latest={latest} showQuestion={showQuestion} still={still} />;
    case "unable": return <UnableRun latest={latest} still={still} />;
    case "refused":
    case "failed": return <FailedRun latest={latest} still={still} />;
    case "superseded": return <div className={styles.notice} role="status">
      <p><strong>A newer save replaced this run.</strong> It did not take effect.</p>
      <p className={styles.meta}>{still}</p>
    </div>;
    case "saved": return null;
    default: return <div className={styles.notice} role="status"><p>The latest run is in a state this page does not recognise.</p><p className={styles.meta}>{still}</p></div>;
  }
}
