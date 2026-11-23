import type { ReactNode } from "react";
import { Link } from "react-router";
import { ChevronRight, MessageCircleQuestion, TriangleAlert } from "lucide-react";
import type { DecisionSummary } from "../../api/adapters/decisions";
import type { HostDecision } from "../../api/adapters/hostDecisions";
import { isQuestionExpired, type QuestionSummary } from "../../api/adapters/questions";
import { Icon } from "../../components/icons";
import { shortId } from "./DecisionContext";
import { useDecisionTask, expiresLabel } from "./decisionHooks";
import styles from "./DecisionInbox.module.css";

const FINAL_LABEL: Record<string, string> = { answered: "Answered", expired: "Expired", cancelled: "Cancelled" };
function projectLabel(name: string | undefined, id: string) {
  return name ?? `Project ${shortId(id)}`;
}
function RowLink({ id, selected, search, question, children }: { id: string; selected: boolean; search: string; question?: boolean; children: ReactNode }) {
  return <Link className={styles.row} aria-current={selected ? "page" : undefined} to={{ pathname: `/decisions/${id}`, search }} data-question-row={question ? "" : undefined}>
    <span className={styles.body}>{children}</span>
    <Icon icon={ChevronRight} size={18} className={styles.chevron} />
  </Link>;
}

export function HostRow({ row, selected, projectName, search }: { row: HostDecision; selected: boolean; projectName: string | undefined; search: string }) {
  return <RowLink id={row.handle} selected={selected} search={search}>
    <strong className={styles.title}>{row.question}</strong>
    <span className={styles.meta}>{projectLabel(projectName, row.projectId)} · Playbook decision</span>
    <span className={styles.meta}>{row.namespace}</span>
  </RowLink>;
}

export function InboxRow({ row: r, selected, projectName, now, search }: { row: DecisionSummary; selected: boolean; projectName: string | undefined; now: string | null; search: string }) {
  const task = useDecisionTask(r);
  const title = task.data?.data.title ?? `Review task ${r.taskId.slice(0, 8)}`;
  const project = projectLabel(projectName, r.projectId);
  let timing: string | null = FINAL_LABEL[r.state] ?? null;
  if (r.state === "pending" && now) {
    timing = expiresLabel(now, r.expires);
  }
  return <RowLink id={r.decisionId} selected={selected} search={search}>
    <strong className={styles.title}>{title}</strong>
    <span className={styles.meta}>{project} · Review</span>
    {timing && <span className={styles.meta}>{timing}</span>}
    {!r.current && <span className={styles.chip}><Icon icon={TriangleAlert} size={14} />Newer report exists</span>}
  </RowLink>;
}

export function QuestionRow({ row: q, selected, projectName, now, search }: { row: QuestionSummary; selected: boolean; projectName: string | undefined; now: string | null; search: string }) {
  const task = useDecisionTask(q);
  const title = q.taskTitle ?? task.data?.data.title ?? `Question on task ${q.taskId.slice(0, 8)}`;
  const project = projectLabel(projectName, q.projectId);
  let timing: string | null = q.state === "answered" ? "Answered" : null;
  if (q.state === "pending" && now) {
    timing = isQuestionExpired(q, Date.parse(now)) ? "Expired" : expiresLabel(now, q.expires);
  }
  return <RowLink id={q.decisionId} selected={selected} search={search} question>
    <strong className={styles.title}>{title}</strong>
    <span className={styles.meta}><Icon icon={MessageCircleQuestion} size={14} className={styles.kindIcon} />{project} · Question</span>
    <span className={styles.excerpt}>{q.question}</span>
    {timing && <span className={styles.meta}>{timing}</span>}
  </RowLink>;
}
