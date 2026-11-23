import { type ReactNode } from "react";
import { FileText, MessageSquare, PanelRight } from "lucide-react";
import { type SessionView } from "../../api/adapters/inspection";
import { formatAge } from "../../components/time/relative";
import { executionAuthorityText, profileText } from "./labels";
import { ObservationLabel } from "./ObservationState";
import styles from "./Agents.module.css";
import { InteractiveTerminal } from "./InteractiveTerminal";
import { Icon } from "../../components/icons";
import { ActionButton, Toolbar } from "../../components/layout/Workspace";
import { type SessionWorkspace } from "./SessionPage";

function providerText(s: SessionView) {
  return `${s.profile.provider ?? "Provider unknown"} · ${profileText(s.profile)}`;
}

function SessionFacts({ s, serverTime }: Pick<SessionWorkspace, "s" | "serverTime">) {
  const lastActivityAt = s.observation.lastObservationAt ?? s.lastActivityAt;
  return (
    <>
      <span>
        <ObservationLabel session={s} />
      </span>
      <span className={styles.footerCentral}>
        Central state: {executionAuthorityText(s.executionAuthority)}
      </span>
      <span>
        {lastActivityAt ? `Last activity ${formatAge(serverTime, lastActivityAt)}` : "Last activity unknown"}
      </span>
    </>
  );
}
function PrimaryPane({ model, facts }: { model: SessionWorkspace; facts: ReactNode }) {
  const { s, split, live, terminal, feed, drawer, openDrawer, messageBlocked } = model;
  return (
    <div className={styles.paneSlot}>
      {split && (
        <div className={styles.paneCaption}>
          <strong>{s.label}</strong>
          <span>{providerText(s)}</span>
        </div>
      )}
      {live ? (
        <InteractiveTerminal
          key={s.terminal!.id}
          terminalId={s.terminal!.id}
          name={s.label}
          feed={feed}
          facts={facts}
          label={split ? `Interactive agent terminal, ${s.label}` : undefined}
          transcriptOpen={drawer === "transcript"}
          onTranscript={(from) => openDrawer("transcript", from)}
          onDetails={(from) => openDrawer("details", from)}
          messageReason={messageBlocked}
          onMessage={(from) => openDrawer("message", from)}
        />
      ) : (
        <div className={styles.terminal} role="note">
          <strong>Terminal is not available</strong>
          <span>
            {!s.terminal
              ? "No terminal was recorded for this session."
              : !terminal.enabled
                ? terminal.reason
                : null}
          </span>
        </div>
      )}
    </div>
  );
}
function SecondaryPane({ split, second, others, onViewChange }: SessionWorkspace) {
  if (!split || !second?.terminal) return null;
  return (
    <div className={styles.paneSlot}>
      <div className={styles.paneCaption}>
        <label>
          Second pane{" "}
          <select value={second.id} onChange={(e) => onViewChange({ secondId: e.target.value })}>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span>{providerText(second)}</span>
      </div>
      <InteractiveTerminal
        key={second.terminal.id}
        terminalId={second.terminal.id}
        name={second.label}
        label={`Interactive agent terminal, ${second.label}`}
      />
    </div>
  );
}
function SessionActions({ s, drawer, toggle, messageBlocked, messageReason, live }: SessionWorkspace) {
  return (
    <Toolbar className={styles.sessionActions} role="group" aria-label="Session actions">
      <span className={styles.messageSlot}>
        <ActionButton
          disabled={!!messageBlocked}
          aria-describedby={messageBlocked ? messageReason : undefined}
          aria-haspopup="dialog"
          aria-expanded={drawer === "message"}
          aria-controls={`session-${s.id}-message`}
          onClick={toggle("message")}
        >
          <Icon icon={MessageSquare} size={18} />
          Message
        </ActionButton>
        {messageBlocked && (
          <span id={messageReason} className={styles.muted}>
            {messageBlocked}
          </span>
        )}
      </span>
      {live && (
        <ActionButton
          aria-haspopup="dialog"
          aria-expanded={drawer === "transcript"}
          aria-controls={`session-${s.id}-transcript`}
          onClick={toggle("transcript")}
        >
          <Icon icon={FileText} size={18} />
          Transcript
        </ActionButton>
      )}
      <ActionButton
        aria-label="Session details"
        aria-haspopup="dialog"
        aria-expanded={drawer === "details"}
        aria-controls={`session-${s.id}-details`}
        onClick={toggle("details")}
      >
        <Icon icon={PanelRight} size={18} />
        Details
      </ActionButton>
    </Toolbar>
  );
}
export function SessionPanes({ model, taskLink }: { model: SessionWorkspace; taskLink: ReactNode }) {
  const { s, serverTime, panes, split, phone, live } = model;
  const facts = <SessionFacts s={s} serverTime={serverTime} />;
  return (
    <div className={styles.outputWorkspace}>
      {!split && (
        <Toolbar className={styles.outputHeading}>
          <strong title={providerText(s)}>{providerText(s)}</strong>
          {phone && taskLink}
        </Toolbar>
      )}
      {/* Split (spec §6): at most two panes, offered only while each fits 80 columns at the readable font size. */}
      <div ref={panes} className={styles.panes} data-split={split || undefined}>
        <PrimaryPane model={model} facts={facts} />
        <SecondaryPane {...model} />
      </div>

      {/* With a live terminal these facts join its one-row status footer (AG-D); otherwise they stand alone. */}
      {!live && <footer className={styles.outputFooter}>{facts}</footer>}
      {/* Phone: the terminal's pinned action bar (reference 11) carries Transcript, Message and Details instead. */}
      {!(phone && live) && <SessionActions {...model} />}
    </div>
  );
}
