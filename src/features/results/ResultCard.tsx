import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  CircleAlert,
  CircleCheck,
  Clock,
  FileText,
  Image as ImageGlyph,
  MessageSquare,
  Paperclip,
  Video,
} from "lucide-react";
import { mediaBinding, validateResultPayload, type ResultDetail } from "../../api/adapters/resultsFeedback";
import { useSession } from "../../app/session";
import { scopeSearch, useScope } from "../../app/scope";
import { ActionButton } from "../../components/layout/Workspace";
import { Icon } from "../../components/icons";
import { formatAge } from "../../components/time/relative";
import { ResultMedia } from "./ResultMedia";
import { ResultMediaUpload } from "./ResultMediaUpload";
import { OperationStatus, useResultOperation } from "./useResultOperation";
import { useComments } from "./useResultComments";
import styles from "./Results.module.css";
export function ResultCard({
  detail,
  selected,
  now,
  projectLabel,
  openComments,
}: {
  detail: ResultDetail;
  selected: boolean;
  now: string | null;
  projectLabel: string;
  openComments(): void;
}) {
  const { resultId, revision } = useParams();
  return (
    <article
      className={`${styles.card} ${selected ? styles.selected : ""}`}
      aria-label={`Result ${detail.result.id}`}
    >
      <CardHeader detail={detail} now={now} projectLabel={projectLabel} />
      <p className={styles.attempt}>
        Attempt {detail.revision.attempt_id.slice(-8)} ·{" "}
        <span title={detail.revision.revision}>revision {detail.revision.revision.slice(0, 7)}</span> · Source
        base {detail.revision.source.base.hex.slice(0, 7)}
      </p>
      <CardMedia detail={detail} />
      <ResultContext detail={detail} />
      {resultId && revision && <ResultMediaUpload binding={mediaBinding(detail)} />}
      <CardFooter detail={detail} selected={selected} openComments={openComments} />
    </article>
  );
}
function CardHeader({
  detail,
  now,
  projectLabel,
}: {
  detail: ResultDetail;
  now: string | null;
  projectLabel: string;
}) {
  const { bootstrap } = useSession();
  const date = new Date(detail.revision.submitted_at_ms),
    iso = date.toISOString(),
    absolute = date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const status = resultStatus(detail.assessment);
  const glyph = captureIcon(detail.revision);
  const project = { kind: "project" as const, project_id: detail.result.project_id },
    taskShort = detail.result.task_id.slice(-8);

  return (
    <header className={styles.header}>
      <span className={styles.mediaIcon}>
        <Icon icon={glyph} size={20} />
      </span>
      <div className={styles.heading}>
        <CardSummary detail={detail} />
        <p className={styles.meta}>
          {projectLabel} · Task{" "}
          {bootstrap.capability("tasks.read").enabled ? (
            <Link to={{ pathname: `/work/${detail.result.task_id}`, search: scopeSearch(project) }}>
              {taskShort}
            </Link>
          ) : (
            taskShort
          )}{" "}
          · <span title={detail.result.id}>Result {detail.result.id.slice(-8)}</span> ·{" "}
          <time dateTime={iso} title={absolute}>
            {now ? formatAge(now, iso) : absolute}
          </time>
        </p>
      </div>
      <span className={`${styles.status} ${styles[status.tone]}`} data-result-status="">
        <Icon icon={status.icon} size={16} />
        {status.label}
      </span>
    </header>
  );
}
function captureIcon(revision: ResultDetail["revision"]) {
  const kinds = revision.capture_policy.requirements.map((item) => item.kind);
  if (kinds.some((kind) => /video|clip/i.test(kind))) return Video;
  return kinds.some((kind) => /image|png/i.test(kind)) ? ImageGlyph : FileText;
}

function CardSummary({ detail }: { detail: ResultDetail }) {
  const [expanded, setExpanded] = useState(false),
    summaryId = `result-summary-${detail.result.id}`,
    long = detail.revision.summary.length > 240 || detail.revision.summary.split("\n").length > 3;
  return (
    <>
      <h2 id={summaryId} className={styles.title} data-clamped={(long && !expanded) || undefined}>
        {wrapPaths(detail.revision.summary)}
      </h2>
      {long && (
        <button
          type="button"
          className={styles.summaryToggle}
          aria-expanded={expanded}
          aria-controls={summaryId}
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? "Show less" : "Show full summary"}
        </button>
      )}
    </>
  );
}
function CardMedia({ detail }: { detail: ResultDetail }) {
  const media = useSession().bootstrap.capability("results.media.read");
  const evidence = <CardEvidence detail={detail} />;
  return media.enabled ? (
    <ResultMedia binding={mediaBinding(detail)} evidence={evidence} />
  ) : (
    <div className={styles.mediaRow}>
      <div className={styles.mediaUnavailable}>
        <p>Images unavailable: media not configured</p>
        <p className={styles.meta}>{media.reason ?? ""}</p>
      </div>
      {evidence}
    </div>
  );
}
function CardEvidence({ detail }: { detail: ResultDetail }) {
  const required = detail.revision.capture_policy.requirements.filter((r) => r.required),
    evaluations = detail.assessment.evidence.requirements;
  const needed = required.reduce((sum, r) => sum + r.count, 0),
    attached = required.reduce(
      (sum, r) =>
        sum +
        Math.min(
          r.count,
          evaluations.find((e) => e.requirement_id === r.id && e.policy_revision === r.policy_revision)
            ?.artifact_ids.length ?? 0,
        ),
      0,
    );
  return (
    <p className={styles.evidence}>
      <Icon icon={detail.assessment.evidence.satisfied ? CircleCheck : Paperclip} size={18} />
      <span>
        {needed
          ? `${attached} of ${needed} required captures attached`
          : "No required captures in this revision’s policy"}{" "}
        ·{" "}
        {detail.assessment.evidence.satisfied
          ? "Evidence requirements satisfied"
          : "Evidence requirements incomplete"}
      </span>
    </p>
  );
}

function ResultContext({ detail }: { detail: ResultDetail }) {
  const { bootstrap } = useSession(),
    [scope] = useScope();
  const required = detail.revision.capture_policy.requirements.filter((r) => r.required),
    evaluations = detail.assessment.evidence.requirements;

  return (
    <details className={styles.context}>
      <summary>Result context and evidence</summary>
      <div className={styles.cardFacts}>
        <span>{detail.assessment.artifacts.length} supplemental artifacts</span>
        <span>{detail.revision.artifacts.length} submitted artifacts</span>
        <Link
          to={{
            pathname: `/results/${detail.result.id}/revisions/${detail.revision.revision}`,
            search: scopeSearch(scope),
          }}
        >
          Exact revision
        </Link>
      </div>
      <dl className={styles.facts}>
        <dt>Result</dt>
        <dd>{detail.result.id}</dd>
        <dt>Exact revision</dt>
        <dd>{detail.revision.revision}</dd>
        <dt>Attempt</dt>
        <dd>{detail.revision.attempt_id}</dd>
        <dt>Repository</dt>
        <dd>{detail.revision.source.repository_id}</dd>
        <dt>Source base</dt>
        <dd>{detail.revision.source.base.hex}</dd>
      </dl>
      <p className={styles.meta}>
        Source base declared by the report. Evidence presence and acceptance are separate observations.
      </p>
      {required.map((r) => (
        <p key={r.id} className={styles.meta}>
          {r.scenario} · {r.environment} · {r.viewport.width_css} × {r.viewport.height_css} ·{" "}
          {evaluations.find((e) => e.requirement_id === r.id)?.state ?? "Unknown"}
        </p>
      ))}
      <FollowPreference detail={detail} enabled={bootstrap.capability("results.comment").enabled} />
    </details>
  );
}
function useFollowPreference(detail: ResultDetail) {
  const operation = useResultOperation(detail.result.project_id, "results.comment");
  const [following, setFollowing] = useState(detail.result.directly_following ?? null);
  const [desired, setDesired] = useState(true);
  const [intent, setIntent] = useState<boolean | null>(null);
  const confirmed = operation.status?.disposition === "confirmed";
  useEffect(() => {
    if (confirmed && intent !== null) setFollowing(intent);
  }, [confirmed, intent]);
  async function follow() {
    if (operation.id) {
      if (!confirmed) return;
      operation.reset();
    }
    const next = following === null ? desired : !following;
    setIntent(next);
    const payload = {
      operation_id: crypto.randomUUID(),
      expected_version: detail.result.version,
      following: next,
    };
    validateResultPayload("Follow", payload);
    await operation.submit("PUT", `/api/v1/results/${detail.result.id}/follow`, payload);
  }
  const disabled = operation.busy || (!!operation.id && !confirmed);
  return { operation, following, desired, setDesired, confirmed, disabled, follow };
}

function followLabel(following: boolean | null) {
  if (following === null) return "Apply follow preference";
  return following ? "Unfollow" : "Follow";
}

function FollowPreference({ detail, enabled }: { detail: ResultDetail; enabled: boolean }) {
  const { operation, following, desired, setDesired, confirmed, disabled, follow } =
    useFollowPreference(detail);
  if (!enabled) return null;
  return (
    <div className={styles.follow}>
      {following === null && (
        <label className={styles.meta}>
          Direct follow state unavailable{" "}
          <select
            aria-label="Set following"
            value={desired ? "yes" : "no"}
            onChange={(e) => setDesired(e.target.value === "yes")}
          >
            <option value="yes">Follow</option>
            <option value="no">Unfollow</option>
          </select>
        </label>
      )}
      <ActionButton disabled={disabled} aria-pressed={following ?? undefined} onClick={() => void follow()}>
        {followLabel(following)}
      </ActionButton>
      {confirmed && <span className={styles.meta}>Preference saved for this operation.</span>}
      <OperationStatus operation={operation} />
    </div>
  );
}
function commentLabel(comments: ReturnType<typeof useComments>) {
  if (comments.isPending) return "Comments…";
  if (comments.isError) return "Comments unavailable";
  const count = comments.data?.pages.flatMap((page) => page.items).length ?? 0;
  const more = comments.data?.pages.at(-1)?.next_cursor;
  return `Comments ${count}${more ? "+" : ""}`;
}
function CardFooter({
  detail,
  selected,
  openComments,
}: {
  detail: ResultDetail;
  selected: boolean;
  openComments(): void;
}) {
  const [scope] = useScope(),
    comments = useComments(detail),
    prior = detail.revision.parent_results[0];
  return (
    <footer className={styles.cardActions}>
      <ActionButton className={styles.comments} aria-pressed={selected} onClick={openComments}>
        <Icon icon={MessageSquare} size={18} />
        {commentLabel(comments)}
      </ActionButton>
      {prior && (
        <Link
          className={styles.secondary}
          to={{
            pathname: `/results/${prior.result_id}/revisions/${prior.revision}`,
            search: scopeSearch(scope),
          }}
        >
          Compare {prior.revision.slice(0, 7)}
        </Link>
      )}
      {/* No review or acceptance flow exists for results yet (RA-04), so no control pretends to open one. */}
      <span
        className={styles.acceptance}
        title="Acceptance is recorded by AQ review. Results can't be reviewed or accepted from the dashboard yet."
      >
        Acceptance: <strong>{humanize(detail.assessment.acceptance)}</strong>
      </span>
    </footer>
  );
}
/** Status comes only from the assessment: no acceptance owner means submitted, never invented approval. */
function resultStatus(a: ResultDetail["assessment"]) {
  if (a.acceptance === "accepted") return { label: "Accepted", tone: "success", icon: CircleCheck } as const;
  if (a.unresolved_review) return { label: "Needs review", tone: "attention", icon: CircleAlert } as const;
  if (a.acceptance === "unreviewed") return { label: "Submitted", tone: "neutral", icon: Clock } as const;
  return { label: humanize(a.acceptance), tone: "neutral", icon: Clock } as const;
}
/** Let file lists wrap after path separators instead of mid-word (RA-12). */
function wrapPaths(text: string) {
  const parts = text.split(/(?<=[/\\])/);
  return parts.length < 2
    ? text
    : parts.flatMap((part, i) => (i < parts.length - 1 ? [part, <wbr key={i} />] : [part]));
}
function humanize(value: string) {
  const text = value.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
