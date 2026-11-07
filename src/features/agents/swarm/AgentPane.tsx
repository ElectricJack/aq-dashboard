import { Link, useLocation } from "react-router";
import type { AgentView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { ActionButton, DetailList } from "../../../components/layout/Workspace";
import { useSession } from "../../../app/session";
import { InteractiveTerminal } from "../InteractiveTerminal";
import { useAgentTokens } from "./useAgentTokens";
import styles from "./Swarm.module.css";

export function AgentPane({ agent, serverTime }: { agent: AgentView; serverTime: string }) {
  const { bootstrap } = useSession();
  const { search } = useLocation();
  const tokens = useAgentTokens(agent.sessionId);
  const terminal = bootstrap.capability("terminal.watch");
  const label = `${agent.provider ?? "agent"} · ${agent.intelligenceClass ?? "unclassified"}`;
  return (
    <>
      <DetailList className={styles.facts}>
        <dt>Task</dt><dd>{agent.task ? `${agent.project.label} / ${agent.task.title}` : agent.project.label}</dd>
        <dt>Attempt</dt><dd>{agent.attemptId.slice(0, 8)}{agent.startedAt ? ` · ${formatAge(serverTime, agent.startedAt)}` : ""}</dd>
        <dt>Model</dt><dd>{agent.model ?? "unknown"}</dd>
        <dt>Tokens</dt><dd>{tokens.text}</dd>
      </DetailList>
      <div className={styles.actions}>
        <ActionButton disabled title="Not available on this page yet">Cancel attempt</ActionButton>
        {agent.task && <Link className={styles.linkButton} to={{ pathname: `/work/${agent.task.id}`, search: scopeOnly(search) }}>Open task</Link>}
        <Link className={styles.linkButton} to={{ pathname: `/agents/${encodeURIComponent(agent.sessionId)}`, search: scopeOnly(search) }}>Pop out terminal</Link>
      </div>
      {!agent.terminalId
        ? <p role="note" className={styles.actionNote}>No terminal was recorded for this agent.</p>
        : !terminal.enabled
          ? <p role="note" className={styles.actionNote}>{terminal.reason}</p>
          : <div className={styles.terminal}><InteractiveTerminal key={agent.terminalId} terminalId={agent.terminalId} name={label} autoControl label="Agent terminal" /></div>}
    </>
  );
}

/** Links keep the scope but not the pane selection. */
export function scopeOnly(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("select");
  const text = params.toString();
  return text ? `?${text}` : "";
}
