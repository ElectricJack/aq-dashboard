import type { CapabilityState } from "../../api/adapters/bootstrap";
import { Link, useParams, useSearchParams } from "react-router";
import { validGraphId } from "../../api/adapters/humanGraph";
import { HOST_DECISIONS } from "../../api/adapters/hostDecisions";
import { QUESTIONS_READ } from "../../api/adapters/questions";
import { PageHeader } from "../../components/layout/PageHeader";
import { useSession } from "../../app/session";
import { useScope } from "../../app/scope";
import { Panel } from "../../components/layout/Workspace";
import { Icon } from "../../components/icons";
import { ChevronLeft } from "lucide-react";
import { Selected, SelectedQuestion, StatusPanel } from "./SelectedDecision";
import { useDecisionInboxes } from "./useDecisionInboxes";
import { DecisionInbox, type InboxState } from "./DecisionInbox";
import { SelectedHostDecision } from "./HostDecisionDetail";
import { OtherAttention } from "./OtherAttention";
import styles from "./Decisions.module.css";
type DecisionKind = "review" | "playbook" | "question";
type Selection = { decisionId?: string; kind: DecisionKind; project?: string; permission: CapabilityState; hostPermission: CapabilityState };

function selectionKind(value: string | null): DecisionKind {
  return value === "question" || value === "playbook" ? value : "review";
}

function DecisionSelection({ decisionId, kind, project, permission, hostPermission }: Selection) {
  if (!decisionId) return <EmptySelection reviews={permission.enabled} />;
  // A malformed id cannot load; show the neutral not-found state without retry (WD-13).
  if (!validGraphId(decisionId)) return <StatusPanel title={kind === "question" ? "Agent question" : "Decision"}>This item does not exist or is not available to you.</StatusPanel>;
  if (kind === "playbook") return hostPermission.enabled ? <SelectedHostDecision handle={decisionId} project={project} />
    : <StatusPanel title="Playbook decision">{hostPermission.reason}</StatusPanel>;
  if (kind === "question") return <SelectedQuestion id={decisionId} project={project} />;
  return permission.enabled ? <Selected id={decisionId} project={project} /> : <StatusPanel title="Review">{permission.reason}</StatusPanel>;
}

function EmptySelection({ reviews }: { reviews: boolean }) {
  return <>
    <Panel title={reviews ? "Choose a review" : "Choose a decision"} className={styles.placeholder}><p className={styles.muted}>{reviews ? "Select a review to inspect its exact result and evidence." : "Select a playbook decision to inspect its question and evidence."}</p></Panel>
    <Panel title="Decision context" className={`${styles.context} ${styles.placeholder}`}><p className={styles.muted}>Project, task and evidence for the selected {reviews ? "review" : "decision"} appear here.</p></Panel>
  </>;
}

function DecisionHeader({ content, offered }: { content: ReturnType<typeof useDecisionInboxes>["content"]; offered: Parameters<typeof useDecisionInboxes>[2] }) {
  const names = [offered.reviews && "your reviews", offered.questions && "agent questions", offered.host && "playbook decisions"].filter(Boolean).join(" and ");
  return <PageHeader title="Decisions">{(content.hasReviews || content.hostRows) && <p className={styles.subtitle}>{content.shown} shown · {offered.reviews ? "sampled from " : "open "}{names}</p>}</PageHeader>;
}

function useDecisionRoute() {
  const [scope] = useScope();
  const [params, setParams] = useSearchParams();
  const state: InboxState = params.get("state") === "closed" ? "closed" : "open";
  const { decisionId } = useParams();
  const kind = selectionKind(params.get("kind"));
  const project = scope.kind === "project" ? scope.project_id : undefined;
  const setState = (s: InboxState) => setParams(old => { const next = new URLSearchParams(old); next.set("state", s); return next; });
  const back = new URLSearchParams({ ...(project && { scope: `project:${project}` }), state }).toString();
  return { state, decisionId, kind, project, setState, back };
}

export function Component() {
  const { bootstrap, queryContext } = useSession();
  const permission = bootstrap.capability("decisions.read");
  const hostPermission = bootstrap.capability(HOST_DECISIONS);
  const { state, decisionId, kind, project, setState, back } = useDecisionRoute();
  const offered = { reviews: permission.enabled, questions: permission.enabled && bootstrap.capability(QUESTIONS_READ).enabled, host: hostPermission.enabled && state === "open" };
  const { content, inbox } = useDecisionInboxes(state, project, offered);
  const canRead = permission.enabled || hostPermission.enabled;
  const selectionKey = `${queryContext.principalId}:${queryContext.authorizationRevision}:${decisionId}:${project ?? "all"}`;
  return <>
    <DecisionHeader content={content} offered={offered} />
    {state === "open" && <div className={decisionId ? styles.otherSelected : undefined}><OtherAttention covered={offered} /></div>}
    {!canRead ? <p role="status">{permission.reason}</p> : <div className={[styles.layout, decisionId && styles.selected].filter(Boolean).join(" ")}>
      <DecisionInbox {...inbox} className={styles.inboxPane} state={state} onState={setState} selected={decisionId} selectedKind={kind} project={project} />
      {decisionId && <Link className={styles.back} to={{ pathname: "/decisions", search: back }}><Icon icon={ChevronLeft} size={18} />All decisions</Link>}
      <DecisionSelection key={selectionKey} decisionId={decisionId} kind={kind} project={project} permission={permission} hostPermission={hostPermission} />
    </div>}
  </>;
}
