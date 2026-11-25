import { type ReactNode } from "react";
import { ChevronDown, ChevronLeft, X } from "lucide-react";
import { Link } from "react-router";
import { type SessionDetailView } from "../../api/adapters/inspection";
import { QueryStatus } from "../../components/QueryStatus/QueryStatus";
import { RetainedNotice } from "../../components/QueryStatus/RetainedNotice";
import { scopeSearch } from "../../app/scope";
import styles from "./Agents.module.css";
import { Icon } from "../../components/icons";
import { ActionButton } from "../../components/layout/Workspace";
import { MESSAGE_CAPABILITY, messageUnavailable } from "./operations/message";
import { compactSessionLabel } from "./SessionRoster";
import { SessionSwitcher } from "./SessionSwitcher";
import {
  useSessionWorkspace,
  type WorkspaceView,
  type ViewChange,
  type SessionModel,
} from "./useSessionWorkspace";
import { ViewControl } from "./SessionWorkspaceControls";
import { SessionPanels } from "./SessionPanels";
import { SessionPanes } from "./SessionPanes";

export function SessionPage({
  sessionId,
  search,
  view,
  onViewChange,
}: {
  sessionId: string;
  search: string;
  view: WorkspaceView;
  onViewChange: ViewChange;
}) {
  const model = useSessionWorkspace(sessionId, view, onViewChange);
  const { query } = model;
  if (!query.data) {
    return (
      <div className={styles.detail}>
        <Link to={{ pathname: "/agents/history", search }} className={styles.back}>
          All sessions
        </Link>
        <QueryStatus
          status={query.isError ? "error" : "pending"}
          error={query.error}
          label="this session"
          onRetry={() => void query.refetch()}
        />
      </div>
    );
  }
  const { view: s, serverTime } = query.data;
  const workspace = {
    ...model,
    s,
    serverTime,
    search,
    messageBlocked: messageUnavailable(s, model.bootstrap.capability(MESSAGE_CAPABILITY)),
  };
  return <LoadedSession {...workspace} />;
}
export type SessionWorkspace = SessionModel & {
  s: SessionDetailView;
  serverTime: string;
  search: string;
  messageBlocked: string | null;
};
function taskTitle(s: SessionDetailView, taskView: SessionModel["taskView"]) {
  return s.task && taskView.enabled ? (
    <Link
      className={styles.taskLink}
      aria-label={s.task.title}
      to={{
        pathname: `/work/${encodeURIComponent(s.task.id)}`,
        search: scopeSearch({ kind: "project", project_id: s.project.id }),
      }}
    >
      <span className={styles.fullLabel}>{s.task.title}</span>
      <span className={styles.compactLabel}>
        {s.task.title === s.task.id ? `Task ${s.task.id.slice(0, 8)}` : s.task.title}
      </span>
    </Link>
  ) : (
    <span className={styles.taskLink}>{s.task?.title ?? "No task"}</span>
  );
}
function SessionHeader({
  model,
  headingId,
  switcherId,
  switcher,
  taskLink,
}: {
  model: SessionWorkspace;
  headingId: string;
  switcherId: string;
  switcher: ReactNode;
  taskLink: ReactNode;
}) {
  const {
    s,
    search,
    heading,
    switcherToggle,
    switcherOpen,
    setSwitcherChoice,
    phone,
    split,
    expanded,
    splitReason,
    changeView,
    expandId,
    exitId,
  } = model;
  return (
    <div className={styles.focusHeader}>
      <Link to={{ pathname: "/agents/history", search }} className={styles.crumb} aria-label="Back to Agents">
        <ChevronLeft className={styles.backIcon} size={20} aria-hidden="true" />
        Agents
      </Link>
      <span className={styles.crumbSeparator} aria-hidden="true">
        /
      </span>
      <h2 id={headingId} aria-label={s.label} ref={heading} tabIndex={-1} className={styles.title}>
        <span className={styles.fullLabel}>{s.label}</span>
        <span className={styles.compactLabel}>{compactSessionLabel(s)}</span>
      </h2>
      <button
        ref={switcherToggle}
        type="button"
        className={styles.iconControl}
        aria-label="Sessions"
        aria-expanded={switcherOpen}
        aria-controls={switcherId}
        onClick={() => setSwitcherChoice(!switcherOpen)}
      >
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {!phone && taskLink && (
        <>
          <span className={styles.crumbSeparator} aria-hidden="true">
            ·
          </span>
          {taskLink}
        </>
      )}
      <ViewControl
        split={split}
        expanded={expanded}
        splitReason={splitReason}
        onChange={changeView}
        expandId={expandId}
        phone={phone}
      />
      {expanded && (
        <ActionButton
          id={exitId}
          className={styles.exit}
          aria-keyshortcuts="Escape"
          onClick={() => changeView({ expanded: false })}
        >
          <Icon icon={X} size={18} />
          Exit<span className={styles.exitLong}> expanded view</span>
          <kbd className={styles.kbd} aria-hidden="true">
            Esc
          </kbd>
        </ActionButton>
      )}
      {/* Phone: the listbox drops from the header row as an overlay. */}
      {phone && switcher}
    </div>
  );
}
function LoadedSession(model: SessionWorkspace) {
  const {
    s,
    workspace,
    expanded,
    search,
    switcherOpen,
    phone,
    setSwitcherChoice,
    switcherToggle,
    query,
    taskView,
  } = model;
  const headingId = `session-${s.id}-heading`;
  const switcherId = `session-${s.id}-switcher`;
  const taskLink = taskTitle(s, taskView);
  const switcher = (
    <SessionSwitcher
      selected={s}
      search={search}
      id={switcherId}
      hidden={!switcherOpen}
      inline={phone}
      onDismiss={(restoreFocus) => {
        setSwitcherChoice(false);
        if (restoreFocus) switcherToggle.current?.focus();
      }}
    />
  );

  return (
    <section
      ref={workspace}
      className={styles.detail}
      aria-labelledby={headingId}
      data-viewport-fit=""
      data-expanded={expanded || undefined}
    >
      <SessionHeader
        model={model}
        headingId={headingId}
        switcherId={switcherId}
        switcher={switcher}
        taskLink={taskLink}
      />
      <RetainedNotice query={query} />

      {!phone && switcher}
      <SessionPanes model={model} taskLink={taskLink} />
      <SessionPanels {...model} />
    </section>
  );
}
