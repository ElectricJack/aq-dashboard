import { useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { MessageCircleQuestion, MessageSquare } from "lucide-react";
import { answerResult, questionFailure, type Outcome } from "./questionAnswerState";
import { ApiError } from "../../api/client";
import { isQuestionExpired, MAX_ANSWER_BYTES, QUESTIONS_ANSWER, type QuestionSummary } from "../../api/adapters/questions";
import type { CapabilityState } from "../../api/adapters/bootstrap";
import { useDecisionClock, useDecisionTask, expiresLabel, useRefusedRefresh } from "./decisionHooks";
import { useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { formatAge, formatUntil } from "../../components/time/relative";
import { actionRequest, type FrozenAction } from "../actions/actionClient";
import { CopyValue, ShortId, shortId } from "./DecisionContext";
import { freezeQuestionAnswer } from "./questionAnswer";
import contextStyles from "./DecisionContext.module.css";
import styles from "./QuestionDetail.module.css";

const EXPIRED_REASON = "This question expired before it was answered, so it can no longer be answered here.";
const DELIVERY: Record<string, string> = {
  wait: "Delivered to the waiting agent.",
  task_mail: "The asking attempt had ended, so the answer was queued as task mail for its continuation.",
};

/** The answering capability: the action boundary first, then the kind's own grant. */
export function useAnswerCapability(): CapabilityState {
  const { bootstrap } = useSession();
  const actions = bootstrap.capability("dashboard.actions");
  return actions.enabled ? bootstrap.capability(QUESTIONS_ANSWER) : actions;
}

function useTask(q: QuestionSummary) {
  const projects = useProjects();
  const task = useDecisionTask(q);
  return {
    title: q.taskTitle ?? task.data?.data.title,
    project: projects.data?.view.find(p => p.id === q.projectId)?.label ?? task.data?.project.name,
    work: { pathname: `/work/${q.taskId}`, search: new URLSearchParams({ scope: `project:${q.projectId}` }).toString() },
  };
}

function questionStatus(q: QuestionSummary, now: string | null) {
  const expired = now !== null && isQuestionExpired(q, Date.parse(now));
  const until = now && q.state === "pending" && !expired ? expiresLabel(now, q.expires) : null;
  const stateLabel = q.state !== "pending" ? "Answered" : expired ? "Expired" : "Awaiting your answer";
  return { expired, until, stateLabel };
}

/** Middle column for an agent question: the exact question, its task and expiry, any recorded answer and (as children) the answer form. */
export function QuestionPanel({ question: q, serverTime, updatedAt, children }: { question: QuestionSummary; serverTime: number; updatedAt: number; children?: ReactNode }) {
  const headingId = useId();
  const task = useTask(q);
  const now = useDecisionClock(serverTime, updatedAt);
  const { expired, until, stateLabel } = questionStatus(q, now);
  return <section className={styles.panel} aria-labelledby={headingId} data-question="">
    <header className={styles.header}>
      <p className={styles.kicker}><Icon icon={MessageCircleQuestion} size={18} />Agent question</p>
      <h2 id={headingId} className={styles.title}>{task.title ?? `Task ${shortId(q.taskId)}`}</h2>
      <p className={styles.meta}>{task.project ?? `Project ${shortId(q.projectId)}`}{until && ` · ${until}`}</p>
      <span className={stateLabel === "Awaiting your answer" ? styles.chipAttention : styles.chipNeutral} data-question-expired={expired || undefined}>{stateLabel}</span>
    </header>
    <h3 className={styles.section}>Question</h3>
    <blockquote className={styles.question} data-question-text="">{q.question}</blockquote>
    {q.answer !== null && <>
      <h3 className={styles.section}>Your answer</h3>
      <blockquote className={styles.answer} data-question-answer="">{q.answer}</blockquote>
      {q.delivery && <p className={styles.meta}>{DELIVERY[q.delivery.kind]}</p>}
    </>}
    <p className={styles.meta}><Link className={contextStyles.link} to={task.work}>Open the task in Work</Link></p>
    {children}
  </section>;
}

const iso = (ms: number) => new Date(ms).toISOString();

function questionTime(now: string | null, q: QuestionSummary) {
  if (!now) return "—";
  if (q.state !== "pending") return formatAge(now, iso(q.answeredAt!));
  return isQuestionExpired(q, Date.parse(now)) ? "Expired" : formatUntil(now, iso(q.expires));
}

/** Right column for an agent question: project, task, timing and the decision it answers. */
export function QuestionContext({ question: q, serverTime, updatedAt, className }: { question: QuestionSummary; serverTime: number; updatedAt: number; className?: string }) {
  const task = useTask(q);
  const now = useDecisionClock(serverTime, updatedAt);

  return <Panel title="Question context" className={[contextStyles.context, className].filter(Boolean).join(" ")} data-question-context="">
    <dl className={contextStyles.facts}>
      <div><dt>Project</dt><dd>{task.project ? <span className={contextStyles.name}>{task.project}</span> : <ShortId id={q.projectId} label="project id" />}</dd></div>
      <div><dt>Task</dt><dd><Link className={contextStyles.link} to={task.work} title={q.taskId}>{task.title ?? <code>{shortId(q.taskId)}</code>}</Link>{!task.title && <CopyValue value={q.taskId} label="task id" />}</dd></div>
      <div><dt>Asked</dt><dd>{now ? formatAge(now, iso(q.askedAt)) : "—"}</dd></div>
      <div><dt>{q.state === "pending" ? "Expires" : "Answered"}</dt><dd>{questionTime(now, q)}</dd></div>
      <div><dt>Decision</dt><dd><ShortId id={q.decisionId} label="decision id" /> · revision {q.revision}</dd></div>
    </dl>
    <h3 className={contextStyles.section}>What happens next</h3>
    <p className={contextStyles.next}>If the agent is still waiting, your answer wakes it once. If its attempt has ended, the answer is queued as task mail for the continuation.</p>
  </Panel>;
}


/**
 * Answer bar for one pending question. The answer binds the shown decision revision; a
 * pending or unknown outcome keeps the exact request for a status check or identical
 * retry, and a refusal keeps the draft until a deliberate refresh releases it.
 */
export function QuestionAnswer({ question: q, serverTime, updatedAt, refreshes, onRefresh, onRecorded }: {
  question: QuestionSummary; serverTime: number; updatedAt: number;
  /** Count of completed deliberate refreshes of this question. */
  refreshes: number; onRefresh(): Promise<unknown>; onRecorded(): void;
}) {
  const { reportAccessDenied, reportIncompatible } = useSession();
  const capability = useAnswerCapability();
  const [text, setText] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const frozen = useRef<FrozenAction | null>(null);
  const fieldId = useId(), metaId = useId();
  const now = useDecisionClock(serverTime, updatedAt);
  const expired = now !== null && isQuestionExpired(q, Date.parse(now));
  const reason = !capability.enabled ? capability.reason : expired ? EXPIRED_REASON : null;

  useRefusedRefresh(refreshes, outcome === "refused", () => {
    frozen.current = null; setOutcome(null); setStatus("Question refreshed. Review it, then answer again. Your answer is preserved.");
  });

  function showResult(result: ReturnType<typeof answerResult>) {
    setOutcome(result.outcome);
    setStatus(result.message);
  }

  function frozenAnswer() {
    if (frozen.current) return frozen.current;
    try { frozen.current = freezeQuestionAnswer(q, text); }
    catch (error) { setStatus(error instanceof Error ? error.message : "Review the answer."); }
    return frozen.current;
  }

  function showFailure(error: unknown, lookup: boolean) {
    const result = questionFailure(error, lookup);
    if (error instanceof ApiError && result.accessDenied) reportAccessDenied(error);
    if (result.incompatible) reportIncompatible(QUESTIONS_ANSWER);
    showResult(result);
  }

  async function send(lookup = false) {
    if (busy || reason) return;
    const intent = frozenAnswer();
    if (!intent) return;
    setBusy(true); setStatus(lookup ? "Checking the answer…" : "Sending answer…");
    try {
      const op = await actionRequest(intent, lookup);
      showResult(answerResult(op.disposition));
      if (op.disposition === "confirmed") onRecorded();
    } catch (error) {
      showFailure(error, lookup);
    } finally { setBusy(false); }
  }

  async function refresh() {
    setBusy(true); setStatus("Refreshing the question…");
    try { await onRefresh(); } finally { setBusy(false); }
  }

  // Once answered the question panel shows the recorded answer; only a fresh outcome remains here.
  if (q.state !== "pending") return status ? <p role="status" className={styles.bar}>{status}</p> : null;
  const locked = busy || frozen.current !== null;
  const tooLong = new TextEncoder().encode(text.trim()).length > MAX_ANSWER_BYTES;
  return <section className={styles.bar} aria-label="Your answer" data-question-answer-bar="">
    {!reason && <div className={styles.field}>
      <Icon icon={MessageSquare} size={20} className={styles.fieldIcon} />
      <textarea id={fieldId} className={styles.input} aria-label="Answer" aria-describedby={metaId} placeholder="Write your answer…" rows={3}
        value={text} disabled={locked} onChange={e => setText(e.target.value)} />
    </div>}
    <div className={styles.row}>
      <div className={styles.status}>
        <p id={metaId} className={styles.meta}>Answer applies only to decision {shortId(q.decisionId)} at revision {q.revision}.</p>
        {reason && <p className={styles.reason}>{reason}</p>}
        {tooLong && <p className={styles.reason}>Shorten the answer to at most {MAX_ANSWER_BYTES.toLocaleString("en-US")} bytes.</p>}
        {status && <p role="status" className={styles.meta}>{status}</p>}
      </div>
      {!reason && <div className={styles.buttons}>
        {!frozen.current ? <ActionButton className={styles.primary} disabled={busy || !text.trim() || tooLong} onClick={() => void send()}>Send answer</ActionButton>
          : outcome === "unknown" ? <>
            <ActionButton disabled={busy} onClick={() => void send(true)}>Check status</ActionButton>
            <ActionButton disabled={busy} onClick={() => void send()}>Retry same answer</ActionButton>
          </> : outcome === "refused" && <ActionButton disabled={busy} onClick={() => void refresh()}>Refresh question</ActionButton>}
      </div>}
    </div>
  </section>;
}
