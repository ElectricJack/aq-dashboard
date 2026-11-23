import { levelLabel } from "../../api/roleSettings";
import { formatAge } from "../../components/time/relative";
import {
  AUTHORITY_LABEL,
  controllerText,
  executionAuthorityText,
  observationReasonText,
  profileText,
} from "./labels";
import { ObservationSummary } from "./ObservationState";
import styles from "./Agents.module.css";
import { TerminalTail } from "./TerminalTail";
import { SessionUsage } from "./SessionUsage";
import { SessionEvents } from "./SessionEvents";
import { DetailList } from "../../components/layout/Workspace";
import { OperationsNav, ProfileView } from "./operations/OperationsViews";
import { HealthView } from "./operations/HealthView";
import { WaitsView } from "./operations/WaitsView";
import { NotificationsView } from "./operations/NotificationsView";
import { MessageComposer } from "./operations/MessageComposer";
import { LifecycleHistory } from "./SessionRoster";
import { SessionDrawer } from "./SessionWorkspaceControls";
import { type SessionWorkspace } from "./SessionPage";

function SessionFactsList({ s, serverTime }: Pick<SessionWorkspace, "s" | "serverTime">) {
  return (
    <DetailList>
      <dt>Session ID</dt>
      <dd>{s.id}</dd>
      <dt>Recorded session label</dt>
      <dd>{s.label}</dd>
      <dt>Project</dt>
      <dd>{s.project.label}</dd>
      {s.task && (
        <>
          <dt>Task ID</dt>
          <dd>{s.task.id}</dd>
        </>
      )}
      <dt>Last process observation</dt>
      <dd>
        <ObservationSummary session={s} serverTime={serverTime} />
      </dd>
      {observationReasonText(s.observation) && (
        <>
          <dt>Observation reason</dt>
          <dd>{observationReasonText(s.observation)}</dd>
        </>
      )}
      {s.observation.lastProgressAt && (
        <>
          <dt>Last progress</dt>
          <dd>
            <time dateTime={s.observation.lastProgressAt} title={s.observation.lastProgressAt}>
              {formatAge(serverTime, s.observation.lastProgressAt)}
            </time>
          </dd>
        </>
      )}
      <dt>Authority location</dt>
      <dd>{AUTHORITY_LABEL[s.authority]}</dd>
      <dt>Central execution state</dt>
      <dd>{executionAuthorityText(s.executionAuthority)}</dd>
      <dt>Configured provider</dt>
      <dd>{s.profile.provider ?? "Unknown"}</dd>
      <dt>Configured model and harness</dt>
      <dd>{profileText(s.profile)}</dd>
      {s.ranWith && (
        <>
          <dt>Ran with</dt>
          <dd data-session-ran-with="">
            {s.ranWith.role} · {levelLabel(s.ranWith.level)} · {s.ranWith.model} · {s.ranWith.reasoning}{" "}
            reasoning · {s.ranWith.harness}
          </dd>
        </>
      )}
      <dt>Controller</dt>
      <dd>{controllerText(s.controller)}</dd>
      <dt>Last activity</dt>
      <dd>
        {(s.observation.lastObservationAt ?? s.lastActivityAt)
          ? formatAge(serverTime, (s.observation.lastObservationAt ?? s.lastActivityAt)!)
          : "Unknown"}
      </dd>
      <dt>Attempt</dt>
      <dd>{s.attemptId ?? "None"}</dd>
    </DetailList>
  );
}

function SessionOverview({ s, serverTime, query, bootstrap }: SessionWorkspace) {
  return (
    <>
      {!query.isError && bootstrap.capability("session.usage.read").enabled && s.observationBinding ? (
        <SessionUsage binding={s.observationBinding} />
      ) : (
        <p className={styles.muted}>Session usage unavailable for this session.</p>
      )}
      {!query.isError && bootstrap.capability("session.events.read").enabled && s.observationBinding && (
        <SessionEvents key={s.id} binding={s.observationBinding} />
      )}
      <SessionFactsList s={s} serverTime={serverTime} />

      <h3>Worker lifecycle history</h3>
      <p>
        <LifecycleHistory session={s} serverTime={serverTime} />
      </p>
      <p className={styles.muted}>
        Recorded lifecycle reports are historical evidence. Live process observation remains separate.
      </p>
    </>
  );
}
function OperationsPanel(model: SessionWorkspace) {
  const { s, serverTime, opsView } = model;
  switch (opsView) {
    case "health":
      return <HealthView session={s} serverTime={serverTime} />;
    case "waits":
      return <WaitsView session={s} />;
    case "notifications":
      return <NotificationsView session={s} />;
    case "profile":
      return <ProfileView session={s} />;
    default:
      return <SessionOverview {...model} />;
  }
}
export function SessionPanels(model: SessionWorkspace) {
  const { s, terminal, drawer, closeDrawer, opener, feed, messageBlocked, opsView, setOpsView } = model;
  return (
    <>
      {s.terminal && terminal.enabled && (
        <SessionDrawer
          id={`session-${s.id}-transcript`}
          title="Transcript"
          wide
          open={drawer === "transcript"}
          onClose={closeDrawer}
          returnFocus={opener}
        >
          <TerminalTail terminalId={s.terminal.id} feed={feed} />
        </SessionDrawer>
      )}
      {!messageBlocked && (
        <SessionDrawer
          id={`session-${s.id}-message`}
          title="Message"
          open={drawer === "message"}
          onClose={closeDrawer}
          returnFocus={opener}
        >
          <MessageComposer key={`${s.id}:${s.generation}`} session={s} />
        </SessionDrawer>
      )}
      <SessionDrawer
        id={`session-${s.id}-details`}
        title="Session details"
        open={drawer === "details"}
        onClose={closeDrawer}
        returnFocus={opener}
      >
        <OperationsNav view={opsView} onView={setOpsView} />
        <OperationsPanel {...model} />
      </SessionDrawer>
    </>
  );
}
