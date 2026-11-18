import {ManualAgentPane} from "./ManualAgentPane";
import { Link, useLocation } from "react-router";
import { validGraphId } from "../../../api/adapters/humanGraph";
import { agentClassLabel, type AgentView } from "../../../api/adapters/swarm";
import { formatAge } from "../../../components/time/relative";
import { ActionButton, DetailList } from "../../../components/layout/Workspace";
import { scopeSearch } from "../../../app/scope";
import { useSession } from "../../../app/session";
import { InteractiveTerminal } from "../InteractiveTerminal";
import { useAgentTokens } from "./useAgentTokens";
import { levelLabel, taskLabel } from "./slots";
import styles from "./Swarm.module.css";

export function AgentPane({agent,serverTime}:{agent:AgentView;serverTime:string}) {
  return agent.manual?<ManualAgentPane agent={agent}/>:<NativeAgentPane agent={agent} serverTime={serverTime}/>;
}
function NativeAgentPane({agent,serverTime}:{agent:AgentView;serverTime:string}) {
  const { bootstrap } = useSession();
  const { search } = useLocation();
  const tokens = useAgentTokens(agent.sessionId);
  const terminal = bootstrap.capability("terminal.watch");
  const label = `${agent.provider ?? "agent"} · ${agentClassLabel(agent)}`;
  const finishing = agent.phase === "finishing";
  const taskSearch = validGraphId(agent.project.id)
    ? scopeSearch({ kind: "project", project_id: agent.project.id })
    : scopeOnly(search);
  return (
    <>
      <DetailList className={styles.facts}>
        <dt>Task</dt><dd>{agent.task ? `${agent.project.label} / ${taskLabel(agent)}` : agent.project.label}</dd>
        {agent.ranWith && <><dt>Role</dt><dd>{agent.ranWith.role}</dd></>}
        {levelLabel(agent) && <><dt>Level</dt><dd>{levelLabel(agent)}</dd></>}
        <dt>Attempt</dt><dd>{agent.attemptId.slice(0, 8)}{agent.startedAt ? ` · ${formatAge(serverTime, agent.startedAt)}` : ""}</dd>
        <dt>Model</dt><dd>{agent.ranWith?.model ?? agent.model ?? "unknown"}{agent.ranWith ? ` · ${agent.ranWith.reasoning} effort` : ""}</dd>
        <dt>Tokens</dt><dd>{tokens.text}</dd>
      </DetailList>
      {finishing && <p role="status" className={styles.actionNote}>Finishing. AQ is waiting for this attempt to release its worker slot.</p>}
      <div className={styles.actions}>
        {!finishing && <ActionButton disabled title="Not available on this page yet">Cancel attempt</ActionButton>}
        {agent.task && <Link className={styles.linkButton} to={{ pathname: `/work/${encodeURIComponent(agent.task.id)}`, search: taskSearch }}>Open task</Link>}
        {!finishing && <Link className={styles.linkButton} to={{ pathname: `/agents/${encodeURIComponent(agent.sessionId)}`, search: scopeOnly(search) }}>Pop out terminal</Link>}
      </div>
      {!finishing && (!agent.terminalId
        ? <p role="note" className={styles.actionNote}>No terminal was recorded for this agent.</p>
        : !terminal.enabled
          ? <p role="note" className={styles.actionNote}>{terminal.reason}</p>
          : <div className={styles.terminal}><InteractiveTerminal key={agent.terminalId} terminalId={agent.terminalId} name={label} label="Agent terminal" /></div>)}
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
