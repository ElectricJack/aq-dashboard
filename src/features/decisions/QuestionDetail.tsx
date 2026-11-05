import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { MessageCircleQuestion, MessageSquare } from "lucide-react";
import { ContractError } from "../../api/adapters/contract";
import { ApiError } from "../../api/client";
import { MAX_ANSWER_BYTES, QUESTIONS_ANSWER, type QuestionSummary } from "../../api/adapters/questions";
import type { CapabilityState } from "../../api/adapters/bootstrap";
import { useGraphDetail } from "../../api/humanGraphReads";
import { useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { Icon } from "../../components/icons";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { formatAge, formatUntil } from "../../components/time/relative";
import { useServerNow } from "../../components/time/useServerNow";
import { actionRequest, type FrozenAction } from "../actions/actionClient";
import { CopyValue, ShortId, shortId } from "./DecisionContext";
import { freezeQuestionAnswer } from "./questionAnswer";
import contextStyles from "./DecisionContext.module.css";
import styles from "./QuestionDetail.module.css";

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
  const { bootstrap } = useSession();
  const projects = useProjects();
  const task = useGraphDetail(bootstrap.capability("human.graph.read").enabled ? q.projectId : "", "task", q.taskId);
  return {
    title: task.data?.data.title,
    project: projects.data?.view.find(p => p.id === q.projectId)?.label ?? task.data?.project.name,
    work: { pathname: `/work/${q.taskId}`, search: new URLSearchParams({ scope: `project:${q.projectId}` }).toString() },
  };
}

function useNow(serverTime: number, updatedAt: number) {
  const receivedAt = useMemo(() => performance.now(), [updatedAt]);
  return useServerNow({ serverTime: new Date(serverTime).toISOString(), receivedAt }, { tickMs: 15_000 });
}

/** Middle column for an agent question: the exact question, its task and expiry, any recorded answer and (as children) the answer form. */
export function QuestionPanel({ question: q, serverTime, updatedAt, children }: { question: QuestionSummary; serverTime: number; updatedAt: number; children?: ReactNode }) {
  const headingId = useId();
  const task = useTask(q);
  const now = useNow(serverTime, updatedAt);
  const until = now && q.state === "pending" ? formatUntil(now, new Date(q.expires).toISOString()) : null;
  return <section className={styles.panel} aria-labelledby={headingId} data-question="">
    <header className={styles.header}>
      <p className={styles.kicker}><Icon icon={MessageCircleQuestion} size={18} />Agent question</p>
      <h2 id={headingId} className={styles.title}>{task.title ?? `Task ${shortId(q.taskId)}`}</h2>
      <p className={styles.meta}>{task.project ?? `Project ${shortId(q.projectId)}`}{until && ` · ${until === "due now" ? "Expiry due now" : `Expires ${until}`}`}</p>
      <span className={q.state === "pending" ? styles.chipAttention : styles.chipNeutral}>{q.state === "pending" ? "Awaiting your answer" : "Answered"}</span>
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

/** Right column for an agent question: project, task, timing and the decision it answers. */
export function QuestionContext({ question: q, serverTime, updatedAt, className }: { question: QuestionSummary; serverTime: number; updatedAt: number; className?: string }) {
  const task = useTask(q);
  const now = useNow(serverTime, updatedAt);
  const iso = (ms: number) => new Date(ms).toISOString();
  return <Panel title="Question context" className={[contextStyles.context, className].filter(Boolean).join(" ")} data-question-context="">
    <dl className={contextStyles.facts}>
      <div><dt>Project</dt><dd>{task.project ? <span className={contextStyles.name}>{task.project}</span> : <ShortId id={q.projectId} label="project id" />}</dd></div>
      <div><dt>Task</dt><dd><Link className={contextStyles.link} to={task.work} title={q.taskId}>{task.title ?? <code>{shortId(q.taskId)}</code>}</Link>{!task.title && <CopyValue value={q.taskId} label="task id" />}</dd></div>
      <div><dt>Asked</dt><dd>{now ? formatAge(now, iso(q.askedAt)) : "—"}</dd></div>
      <div><dt>{q.state === "pending" ? "Expires" : "Answered"}</dt><dd>{!now ? "—" : q.state === "pending" ? formatUntil(now, iso(q.expires)) : formatAge(now, iso(q.answeredAt!))}</dd></div>
      <div><dt>Decision</dt><dd><ShortId id={q.decisionId} label="decision id" /> · revision {q.revision}</dd></div>
    </dl>
    <h3 className={contextStyles.section}>What happens next</h3>
    <p className={contextStyles.next}>If the agent is still waiting, your answer wakes it once. If its attempt has ended, the answer is queued as task mail for the continuation.</p>
  </Panel>;
}

type Outcome = "unknown" | "refused" | null;

/**
 * Answer bar for one pending question. The answer binds the shown decision revision; a
 * pending or unknown outcome keeps the exact request for a status check or identical
 * retry, and a refusal keeps the draft until a deliberate refresh releases it.
 */
export function QuestionAnswer({ question: q, refreshes, onRefresh, onRecorded }: {
  question: QuestionSummary;
  /** Count of completed deliberate refreshes of this question. */
  refreshes: number; onRefresh(): Promise<unknown>; onRecorded(): void;
}) {
  const { reportAccessDenied, reportIncompatible } = useSession();
  const capability = useAnswerCapability();
  const [text, setText] = useState(""); const [status, setStatus] = useState(""); const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const frozen = useRef<FrozenAction | null>(null);
  const fieldId = useId(), metaId = useId();
  const reason = !capability.enabled ? capability.reason : null;

  const seen = useRef(refreshes);
  useEffect(() => {
    if (refreshes === seen.current) return;
    seen.current = refreshes;
    if (outcome !== "refused") return;
    frozen.current = null; setOutcome(null); setStatus("Question refreshed. Review it, then answer again. Your answer is preserved.");
  }, [refreshes, outcome]);

  async function send(lookup = false) {
    if (busy || reason) return;
    let intent = frozen.current;
    if (!intent) {
      try { intent = freezeQuestionAnswer(q, text); } catch (error) { setStatus(error instanceof Error ? error.message : "Review the answer."); return; }
      frozen.current = intent;
    }
    setBusy(true); setStatus(lookup ? "Checking the answer…" : "Sending answer…");
    try {
      const op = await actionRequest(intent, lookup);
      if (op.disposition === "confirmed") { setOutcome(null); setStatus("Answer recorded."); onRecorded(); }
      else if (op.disposition === "conflict") { setOutcome("refused"); setStatus("The question changed or was already answered. Your answer is preserved; refresh the question before answering again."); }
      else if (op.disposition === "rejected") { setOutcome("refused"); setStatus("The server refused this answer. Your answer is preserved; refresh the question before answering again."); }
      else { setOutcome("unknown"); setStatus("The answer is not confirmed yet. Check its status or retry the same answer; no second answer is created."); }
    } catch (error) {
      if (error instanceof ApiError && [401, 403].includes(error.status ?? 0)) { reportAccessDenied(error); setOutcome("refused"); setStatus("Access changed. Your answer is preserved."); }
      else if (error instanceof ApiError && error.status === 426) { reportIncompatible(QUESTIONS_ANSWER); setOutcome(null); setStatus("Answering requires a compatible AQ API. Your answer is preserved."); }
      else if (!lookup && error instanceof ApiError && error.status === 409) { setOutcome("refused"); setStatus("The question changed or was already answered. Your answer is preserved; refresh the question before answering again."); }
      else if (!lookup && error instanceof ApiError && !error.effectUnknown && [400, 404, 413, 422].includes(error.status ?? 0)) { setOutcome("refused"); setStatus("The server refused this answer. Your answer is preserved; refresh the question before answering again."); }
      else { setOutcome("unknown"); setStatus(error instanceof ContractError ? "The answer response could not be verified. Check its status before retrying." : "Delivery is unknown. Check its status or retry the same answer; no second answer is created."); }
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
