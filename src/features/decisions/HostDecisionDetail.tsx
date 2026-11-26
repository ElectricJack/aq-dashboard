import { useId, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  adaptHostDecisionAnswer, adaptHostDecisionDetail, HOST_DECISIONS_ROOT, HOST_DECISION_NOTE_BYTES,
  hostChoiceLabel, isHostDecisionResponder, type HostChoice, type HostDecision,
} from "../../api/adapters/hostDecisions";
import { ApiError, apiGet, apiSend } from "../../api/client";
import { useGraphDetail } from "../../api/humanGraphReads";
import { queryKey } from "../../api/queryKeys";
import { PANEL_READ, useSession } from "../../app/session";
import { useProjects } from "../../app/useProjects";
import { ActionButton, Panel } from "../../components/layout/Workspace";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import layoutStyles from "./Decisions.module.css";
import contextStyles from "./DecisionContext.module.css";
import { refreshOverview } from "./decisionHooks";
import { HostDecisionEvidence, hostWorkLink } from "./HostDecisionEvidence";
import evidenceStyles from "./HostDecision.module.css";
import styles from "./QuestionDetail.module.css";

const expirationFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function useHostDecision(handle: string) {
  const { queryContext } = useSession();
  return useQuery({
    queryKey: queryKey(queryContext, "host-decision-detail", { handle }),
    meta: PANEL_READ,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptHostDecisionDetail(
      await apiGet(`${HOST_DECISIONS_ROOT}/${handle}`, signal), handle),
  });
}

function verifiedTaskTitle(task: ReturnType<typeof useGraphDetail>, decision: ReturnType<typeof adaptHostDecisionDetail> | undefined) {
  if (task.isError || !task.data) return;
  if (task.data.project.workspace_id === decision?.workspaceId) return task.data.data.title;
}

function useHostTask(decision: ReturnType<typeof adaptHostDecisionDetail> | undefined, project: string | undefined, readable: boolean) {
  const inScope = decision && (!project || decision.projectId === project);
  const graphProject = inScope && readable ? decision.projectId : "";
  const task = useGraphDetail(graphProject, "task", decision?.taskId ?? "");
  const title = verifiedTaskTitle(task, decision);
  return { inScope, graphProject, task, title };
}

function useProjectLabel(id?: string, fallback?: string) {
  const projects = useProjects();
  return projects.data?.view.find(p => p.id === id)?.label ?? fallback ?? id ?? "";
}

export function SelectedHostDecision({ handle, project }: { handle: string; project: string | undefined }) {
  const { bootstrap, queryContext } = useSession();
  const client = useQueryClient();
  const read = useHostDecision(handle);
  const decision = read.isError || !read.isFetchedAfterMount ? undefined : read.data;
  const { inScope, graphProject, task, title } = useHostTask(decision, project, bootstrap.capability("human.graph.read").enabled);
  const projectName = useProjectLabel(decision?.projectId, task.data?.project.name);
  const headingId = useId();

  if (!decision) return <Panel title="Playbook decision"><QueryStatus status={read.isError ? "error" : "pending"}
    error={read.error} subject="item" label="playbook decision" onRetry={() => void read.refetch()} /></Panel>;
  if (!inScope) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this decision.</p></Panel>;

  const refreshInbox = () => {
    void client.invalidateQueries({ queryKey: queryKey(queryContext, "host-decision-inbox", {}).slice(0, 5) });
    void refreshOverview(client, queryContext.principalId);
  };

  return <>
    <section className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.header}>
        <p className={styles.kicker}>Playbook decision</p>
        <h2 id={headingId} className={styles.title}>{title ?? "Decision requested"}</h2>
        <span className={styles.meta}>{projectName} · {decision.namespace}</span>
      </header>
      <h3 className={styles.section}>Question</h3>
      <p className={styles.question}>{decision.question}</p>
      <HostDecisionEvidence decision={decision} graphProject={graphProject} />
      <HostDecisionAnswer decision={decision} onChanged={refreshInbox} />
    </section>
    <HostContext decision={decision} projectName={projectName} title={title} />
  </>;
}

function HostContext({ decision, projectName, title }: { decision: ReturnType<typeof adaptHostDecisionDetail>; projectName: string; title?: string }) {
  const { projectId, taskId, expiresAt } = decision;
  const expiration = new Date(expiresAt);
  return <Panel title="Decision context" className={`${contextStyles.context} ${layoutStyles.context}`}>
    <dl className={contextStyles.facts}>
      <div><dt>Project</dt><dd>{projectName}</dd></div>
      <div><dt>Namespace</dt><dd>{decision.namespace}</dd></div>
      <div><dt>Subject</dt><dd>{taskId ? <Link className={contextStyles.link} to={hostWorkLink(projectId, taskId)}>{title ?? taskId}</Link> : decision.subject.id}</dd></div>
      <div><dt>Subject revision</dt><dd>{decision.subject.revision}</dd></div>
      <div><dt>Expires</dt><dd><time dateTime={expiration.toISOString()}>{expirationFormat.format(expiration)}</time></dd></div>
    </dl>
  </Panel>;
}

type Answer = { choice: HostChoice; note?: string };
type Submission =
  | { state: "idle" | "pending" }
  | { state: "unknown"; answer: Answer }
  | { state: "recorded"; choice: HostChoice }
  | { state: "refused" | "closed" | "invalid"; message: string };

function answerFailure(error: unknown, answer: Answer): Submission {
  if (!(error instanceof ApiError)) return { state: "unknown", answer };
  const status = error.status;
  if (status === 400) return { state: "invalid", message: error.serverMessage ?? "AQ refused this choice or note." };
  if ([401, 403].includes(status ?? 0)) return { state: "refused", message: "AQ refused this decision answer." };
  if ([404, 409, 410].includes(status ?? 0)) return { state: "closed", message: "This decision is no longer open for answering." };
  return { state: "unknown", answer };
}

function noteError(choice: HostChoice, text: string) {
  if (choice === "rejected" && !text) return "Add a note explaining the requested changes.";
  return new TextEncoder().encode(text).length > HOST_DECISION_NOTE_BYTES ? "The note must be 2048 bytes or fewer." : "";
}

async function recordChoice(decision: HostDecision, answer: Answer) {
  const receipt = await apiSend("POST", `${HOST_DECISIONS_ROOT}/${decision.handle}/answer`, answer);
  return adaptHostDecisionAnswer(receipt, decision);
}

function useHostAnswer(decision: HostDecision, onChanged: () => void) {
  const { reportAccessDenied } = useSession();
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");
  const [submission, setSubmission] = useState<Submission>({ state: "idle" });
  const sending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function send(answer: Answer) {
    if (sending.current) return;
    sending.current = true;
    setSubmission({ state: "pending" });
    try {
      const choice = await recordChoice(decision, answer);
      setSubmission({ state: "recorded", choice });
      onChanged();
    } catch (error) {
      const next = answerFailure(error, answer);
      if (next.state === "refused" && error instanceof ApiError) reportAccessDenied(error);
      setSubmission(next);
      if (next.state === "closed") onChanged();
    } finally {
      sending.current = false;
    }
  }

  function submit(choice: HostChoice) {
    const text = note.trim();
    const problem = noteError(choice, text);
    setValidation(problem);
    if (problem) { field.current?.focus(); return; }
    void send({ choice, ...(text && { note: text }) });
  }

  function changeNote(value: string) {
    setNote(value);
    setValidation("");
    if (submission.state === "invalid") setSubmission({ state: "idle" });
  }
  return { note, validation, submission, send, submit, field, changeNote };
}

function HostDecisionAnswer({ decision, onChanged }: { decision: HostDecision; onChanged(): void }) {
  const { queryContext } = useSession();
  const { note, validation, submission, send, submit, field, changeNote } = useHostAnswer(decision, onChanged);
  const reasonId = useId();
  if (submission.state === "recorded") {
    return <p className={styles.bar} role="status">{submission.choice === "approved" ? "Approval recorded." : "Request for changes recorded."}</p>;
  }
  if (!isHostDecisionResponder(decision, queryContext.principalId)) {
    return <p className={styles.bar} role="status">Only a listed responder can answer this decision.</p>;
  }
  const editable = ["idle", "invalid"].includes(submission.state);
  return <div className={styles.bar}>
    <label className={evidenceStyles.noteLabel}>Decision note
      <textarea ref={field} className={evidenceStyles.note} value={note} disabled={!editable}
        aria-describedby={reasonId} aria-invalid={!!validation} onChange={event => changeNote(event.target.value)} />
    </label>
    <div className={styles.row}>
      <AnswerStatus reasonId={reasonId} validation={validation} submission={submission} />
      <div className={styles.buttons}>
        {submission.state === "unknown" ? <ActionButton onClick={() => void send(submission.answer)}>Retry same answer</ActionButton>
          : decision.choices.map(choice => <ActionButton key={choice}
            className={choice === "approved" ? styles.primary : undefined} disabled={!editable}
            onClick={() => submit(choice)}>{hostChoiceLabel[choice]}</ActionButton>)}
      </div>
    </div>
  </div>;
}

function AnswerStatus({ reasonId, validation, submission }: { reasonId: string; validation: string; submission: Submission }) {
  return <div className={styles.status}>
    <p id={reasonId} className={styles.meta}>A note is required when requesting changes.</p>
    {validation && <p className={styles.reason} role="alert">{validation}</p>}
    {submission.state === "pending" && <p role="status">Recording decision…</p>}
    {submission.state === "unknown" && <p role="alert">AQ did not confirm the answer. Retry to send the same answer and check its outcome.</p>}
    {"message" in submission && <p role="alert">{submission.message}</p>}
  </div>;
}
