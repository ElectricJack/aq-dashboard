import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listInternalRuns, readInternalRun, retryInternalRun, type InternalRunData, type InternalRunAttempt, type InternalRunTranscript, type TranscriptItem } from "../../api/internalWork";
import { queryKey } from "../../api/queryKeys";
import { useSession } from "../../app/session";
import { ActionButton } from "../../components/layout/Workspace";
import styles from "./InternalRun.module.css";

/** The purpose of a run by an authoring agent, the only kind that has steps worth reading. */
const AGENT_PURPOSE = "playbook_compilation";
const WAY: Record<string, string> = { api: "API", login: "logged-in harness" };
export function duration(ms: number) { return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`; }
const reasonText = (reason: string | null) => (reason ?? "").replaceAll("_", " ");
function failureText(reason?: string | null, detail?: string) {
  const reasonLabel = reasonText(reason ?? null);
  return detail ? `${reasonLabel} - ${detail}` : reasonLabel;
}

function Attempt({ attempt }: { attempt: InternalRunAttempt }) {
  return <li>{attempt.provider} · {attempt.model} ({WAY[attempt.way]}), {duration(attempt.elapsed_ms)}: {attempt.reason ? failureText(attempt.reason, attempt.detail) : "answered"}</li>;
}

const REDACTION = "[credential redacted]";
const PREVIEW_CHARS = 400;
/** Text only: the server's redaction marker is highlighted, everything else is shown as the characters it is. */
function Plain({ value }: { value: string }) {
  return <>{value.split(REDACTION).map((part, index) => <Fragment key={index}>{index > 0 && <mark className={styles.redacted}>{REDACTION}</mark>}{part}</Fragment>)}</>;
}
function Clippable({ value, clipped }: { value: string; clipped?: boolean }) {
  const [open, setOpen] = useState(false);
  const long = value.length > PREVIEW_CHARS;
  return <>
    <pre className={styles.pre}><Plain value={long && !open ? `${value.slice(0, PREVIEW_CHARS)}…` : value} /></pre>
    {clipped && <span className={styles.meta}>clipped by the server</span>}
    {long && <button type="button" className={styles.more} onClick={() => setOpen(!open)}>{open ? "Show less" : "Show all"}</button>}
  </>;
}
function Step({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case "text": return <li><span className={styles.meta}>Agent said</span><Clippable value={item.text} clipped={item.clipped} /></li>;
    case "error": return <li><span className={styles.failed}>Error: <Plain value={item.text} /></span>{item.clipped && <span className={styles.meta}> clipped by the server</span>}</li>;
    case "tool": return <li><span className={styles.meta}>Tool: <span className={styles.tool}>{item.tool}</span></span><Clippable value={item.input} clipped={item.clipped} /></li>;
    case "result": return <li><span className={item.error ? styles.failed : styles.meta}>{item.error ? "Result (failed)" : "Result"}</span><Clippable value={item.output} clipped={item.clipped} /></li>;
    case "clipped": return <li className={styles.meta}>The server cut this transcript short.</li>;
    default: return <li className={styles.meta}>A step this view does not know how to show.</li>;
  }
}
/** One transcript is "What the agent did"; several are numbered by position ("run 1 of 2"), which does not imply any pairing with the attempts list. */
function Steps({ transcript, position, total }: { transcript: InternalRunTranscript; position: number; total: number }) {
  const which = total > 1 ? `run ${position} of ${total}` : "";
  const label = which ? `Agent steps, ${which}` : "Agent steps";
  return <details>
    <summary>What the agent did{which && ` (${which})`}</summary>
    <ol className={styles.steps} aria-label={label}>
      {transcript.events.map((item, index) => <Step key={index} item={item} />)}
      {transcript.omitted > 0 && <li className={styles.meta}>{transcript.omitted} more steps are not shown.</li>}
    </ol>
  </details>;
}

function showTranscripts(run: InternalRunData | undefined, asked: string | null) {
  if (!run || !["answered", "failed"].includes(run.status)) return false;
  return run.purpose === AGENT_PURPOSE || asked === run.id;
}

function useTranscripts(run?: InternalRunData) {
  const { queryContext } = useSession();
  // The list never carries transcripts; the read of one run does, once the run has ended. It is read only for an agent run, or when the owner opens the run's details, never eagerly for every run.
  const [asked, setAsked] = useState<string | null>(null);
  const id = run?.id ?? "";
  const detail = useQuery({ queryKey: queryKey(queryContext, "internal-run-read", { id }), queryFn: ({ signal }) => readInternalRun(id, signal),
    enabled: showTranscripts(run, asked), retry: false });
  const transcripts = detail.data?.transcripts ?? [];
  return { setAsked, transcripts };
}

function nextPoll(run: InternalRunData | undefined, interval: number) {
  return run && ["queued", "running"].includes(run.status) ? interval : false;
}

function useInternalRun(affectedKind: string, affectedId: string, pollMs: number) {
  const { queryContext } = useSession();
  const client = useQueryClient();
  const params = { affected_kind: affectedKind, affected_id: affectedId, limit: 1 };
  const key = queryKey(queryContext, "internal-run", params);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => listInternalRuns(params, signal), retry: false,
    refetchInterval: current => nextPoll(current.state.data?.runs[0], pollMs) });
  const retry = useMutation({ mutationFn: retryInternalRun, onSuccess: () => client.invalidateQueries({ queryKey: key }) });
  const run = query.data?.runs[0];
  const { setAsked, transcripts } = useTranscripts(run);
  return { query, retry, run, setAsked, transcripts };
}

function RunOutcome({ run }: { run: InternalRunData }) {
  return <>
    {run.status === "answered" && <>
      <p className={styles.meta}>Answered by {run.provider} · {run.model} ({WAY[run.way ?? "api"]}) in {duration(run.elapsed_ms ?? 0)}</p>
      <pre className={styles.pre} aria-label="Answer">{typeof run.answer === "string" ? run.answer : JSON.stringify(run.answer, null, 2)}</pre>
    </>}
    {run.status === "failed" && <p className={styles.failed} role="alert">Failed: {failureText(run.reason, run.detail)}</p>}
    {(run.status === "queued" || run.status === "running") && <p className={styles.meta}>{run.status === "queued" ? "Waiting for a model." : "A model is working on it."}</p>}
  </>;
}

/** The newest internal run for one item: what was asked, who answered, how long it took, the answer or the error, and Retry on a failure. Renders nothing when there is no run. */
export function InternalRun({ affectedKind, affectedId, pollMs = 2000 }: { affectedKind: string; affectedId: string; /** How often to re-read a queued or running run; only tests change it. */ pollMs?: number }) {
  const { query, retry, run, setAsked, transcripts } = useInternalRun(affectedKind, affectedId, pollMs);
  if (query.isError) return <p className={styles.meta} role="status">Internal work could not be loaded.</p>;
  if (!run) return null;
  return <section className={styles.run} aria-label="Internal work">
    <div className={styles.head}>
      <h4>Internal work</h4>
      <span className={styles.meta}>{run.purpose.replaceAll("_", " ")} · {run.status}{run.retry_of ? " · retry" : ""}</span>
    </div>
    <details onToggle={event => { if (event.currentTarget.open) setAsked(run.id); }}>
      <summary>What was asked</summary>
      <pre className={styles.pre}>{run.instructions}</pre>
      <pre className={styles.pre}>{run.input}</pre>
    </details>
    <RunOutcome run={run} />
    {transcripts.map((transcript, index) => <Steps key={transcript.candidate_index} transcript={transcript} position={index + 1} total={transcripts.length} />)}
    {run.attempts.length > 0 && <ul className={styles.attempts} aria-label="Attempts">{run.attempts.map((attempt, index) => <Attempt key={index} attempt={attempt} />)}</ul>}
    {run.status === "failed" && <div className={styles.actions}>
      <ActionButton disabled={retry.isPending} onClick={() => retry.mutate(run.id)}>Retry</ActionButton>
      {retry.isError && <span className={styles.failed} role="alert">The retry could not be started.</span>}
    </div>}
  </section>;
}
