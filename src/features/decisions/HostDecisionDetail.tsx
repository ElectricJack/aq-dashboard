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
import { HostDecisionEvidence, hostWorkLink } from "./HostDecisionEvidence";
import evidenceStyles from "./HostDecision.module.css";
import styles from "./QuestionDetail.module.css";

const expirationFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function SelectedHostDecision({ handle, project }: { handle: string; project: string | undefined }) {
  const { bootstrap, queryContext } = useSession();
  const client = useQueryClient();
  const projects = useProjects();
  const read = useQuery({
    queryKey: queryKey(queryContext, "host-decision-detail", { handle }),
    meta: PANEL_READ,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => adaptHostDecisionDetail(
      await apiGet(`${HOST_DECISIONS_ROOT}/${handle}`, signal), handle),
  });
  const decision = read.isError || !read.isFetchedAfterMount ? undefined : read.data;
  const inScope = decision && (!project || decision.projectId === project);
  const graphProject = inScope && bootstrap.capability("human.graph.read").enabled ? decision.projectId : "";
  const task = useGraphDetail(graphProject, "task", decision?.taskId ?? "");
  const title = !task.isError && task.data?.project.workspace_id === decision?.workspaceId ? task.data?.data.title : undefined;
  const headingId = useId();

  if (!decision) return <Panel title="Playbook decision"><QueryStatus status={read.isError ? "error" : "pending"}
    error={read.error} subject="item" label="playbook decision" onRetry={() => void read.refetch()} /></Panel>;
  if (!inScope) return <Panel title="Decision outside selected scope"><p>Select its project or return to All projects to inspect this decision.</p></Panel>;

  const { projectId, taskId, expiresAt } = decision;
  const expiration = new Date(expiresAt);
  const projectName = projects.data?.view.find(p => p.id === projectId)?.label ?? task.data?.project.name ?? projectId;
  const refreshInbox = () => void client.invalidateQueries({ queryKey: queryKey(queryContext, "host-decision-inbox", {}).slice(0, 5) });

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
    <Panel title="Decision context" className={`${contextStyles.context} ${layoutStyles.context}`}>
      <dl className={contextStyles.facts}>
        <div><dt>Project</dt><dd>{projectName}</dd></div>
        <div><dt>Namespace</dt><dd>{decision.namespace}</dd></div>
        <div><dt>Subject</dt><dd>{taskId ? <Link className={contextStyles.link} to={hostWorkLink(projectId, taskId)}>{title ?? taskId}</Link> : decision.subject.id}</dd></div>
        <div><dt>Subject revision</dt><dd>{decision.subject.revision}</dd></div>
        <div><dt>Expires</dt><dd><time dateTime={expiration.toISOString()}>{expirationFormat.format(expiration)}</time></dd></div>
      </dl>
    </Panel>
  </>;
}

type Answer = { choice: HostChoice; note?: string };
type Submission =
  | { state: "idle" | "pending" }
  | { state: "unknown"; answer: Answer }
  | { state: "recorded"; choice: HostChoice }
  | { state: "refused" | "closed" | "invalid"; message: string };

function HostDecisionAnswer({ decision, onChanged }: { decision: HostDecision; onChanged(): void }) {
  const { queryContext, reportAccessDenied } = useSession();
  const [note, setNote] = useState("");
  const [validation, setValidation] = useState("");
  const [submission, setSubmission] = useState<Submission>({ state: "idle" });
  const sending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const reasonId = useId();

  async function send(answer: Answer) {
    if (sending.current) return;
    sending.current = true;
    setSubmission({ state: "pending" });
    try {
      const choice = adaptHostDecisionAnswer(await apiSend(
        "POST", `${HOST_DECISIONS_ROOT}/${decision.handle}/answer`, answer,
      ), decision);
      setSubmission({ state: "recorded", choice });
      onChanged();
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        reportAccessDenied(error);
        setSubmission({ state: "refused", message: "AQ refused this decision answer." });
      } else if (error instanceof ApiError && [404, 409, 410].includes(error.status ?? 0)) {
        setSubmission({ state: "closed", message: "This decision is no longer open for answering." });
        onChanged();
      } else if (error instanceof ApiError && error.status === 400) {
        setSubmission({ state: "invalid", message: error.serverMessage ?? "AQ refused this choice or note." });
      } else {
        setSubmission({ state: "unknown", answer });
      }
    } finally {
      sending.current = false;
    }
  }

  function submit(choice: HostChoice) {
    const text = note.trim();
    const problem = choice === "rejected" && !text ? "Add a note explaining the requested changes."
      : new TextEncoder().encode(text).length > HOST_DECISION_NOTE_BYTES ? "The note must be 2048 bytes or fewer." : "";
    setValidation(problem);
    if (problem) { field.current?.focus(); return; }
    void send({ choice, ...(text && { note: text }) });
  }

  if (submission.state === "recorded") {
    return <p className={styles.bar} role="status">{submission.choice === "approved" ? "Approval recorded." : "Request for changes recorded."}</p>;
  }
  if (!isHostDecisionResponder(decision, queryContext.principalId)) {
    return <p className={styles.bar} role="status">Only a listed responder can answer this decision.</p>;
  }
  const editable = submission.state === "idle" || submission.state === "invalid";
  return <div className={styles.bar}>
    <label className={evidenceStyles.noteLabel}>Decision note
      <textarea ref={field} className={evidenceStyles.note} value={note} disabled={!editable}
        aria-describedby={reasonId} aria-invalid={!!validation} onChange={event => {
          setNote(event.target.value);
          setValidation("");
          if (submission.state === "invalid") setSubmission({ state: "idle" });
        }} />
    </label>
    <div className={styles.row}>
      <div className={styles.status}>
        <p id={reasonId} className={styles.meta}>A note is required when requesting changes.</p>
        {validation && <p className={styles.reason} role="alert">{validation}</p>}
        {submission.state === "pending" && <p role="status">Recording decision…</p>}
        {submission.state === "unknown" && <p role="alert">AQ did not confirm the answer. Retry to send the same answer and check its outcome.</p>}
        {"message" in submission && <p role="alert">{submission.message}</p>}
      </div>
      <div className={styles.buttons}>
        {submission.state === "unknown" ? <ActionButton onClick={() => void send(submission.answer)}>Retry same answer</ActionButton>
          : decision.choices.map(choice => <ActionButton key={choice}
            className={choice === "approved" ? styles.primary : undefined} disabled={!editable}
            onClick={() => submit(choice)}>{hostChoiceLabel[choice]}</ActionButton>)}
      </div>
    </div>
  </div>;
}
