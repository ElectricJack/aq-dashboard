import type { MachineView } from "../../../api/adapters/swarm";
import { useSession } from "../../../app/session";
import { ActionButton } from "../../../components/layout/Workspace";
import { SwarmAction } from "./SwarmAction";
import { freezeRevoke, freezeWorkerAction, workerLabels } from "./swarmActions";
import styles from "./Swarm.module.css";

function statusLine(m: MachineView): string {
  const c = m.control;
  if (!c) return "";
  if (c.desired === "running") return "Worker: running";
  if (c.desired === "draining") {
    const n = m.nodes.reduce((sum, node) => sum + node.agents.length, 0);
    return n === 0 ? "Worker: drained" : `Worker: draining (${n} running)`;
  }
  return c.pendingHandoffs > 0 ? `Worker: stopped, handing off ${c.pendingHandoffs}` : "Worker: stopped";
}

export function MachineControls({ m }: { m: MachineView }) {
  const { bootstrap } = useSession();
  const control = bootstrap.capability("swarm.worker.control");
  const running = m.nodes.reduce((sum, n) => sum + n.agents.length, 0);
  const c = m.control;
  const l = m.label;
  const worker = (kind: "worker.start" | "worker.stop" | "worker.drain", blocked: string | undefined, intro: React.ReactNode, confirm: string, pendingText: string, confirmedText: string) =>
    c ? <SwarmAction label={workerLabels[kind]} capability="swarm.worker.control" blocked={blocked} intro={intro} confirm={confirm}
      freeze={() => freezeWorkerAction(kind, m)} pendingText={pendingText} confirmedText={confirmedText} /> : null;
  if (!control.enabled) {
    return <>
      <div className={styles.actions}>{["Start worker", "Stop worker", "Drain"].map(label => <ActionButton key={label} disabled>{label}</ActionButton>)}</div>
      <p className={styles.actionNote}>Worker start, stop and drain are not available on this server yet.</p>
    </>;
  }
  return <>
    {c && <p role="status">{statusLine(m)}</p>}
    <div className={styles.actions}>
      {c ? <>
        {worker("worker.start", c.desired === "running" ? "Already running" : undefined,
          <p>{l} takes new work again. Handoffs already requested continue.</p>, `Start ${l}`, "Start requested — awaiting confirmation.", "Worker start confirmed.")}
        {worker("worker.stop", c.desired === "stopped" ? "Already stopped" : undefined,
          <><p>Each running agent on {l} is stopped, its work is saved as a commit with a handoff note, and a fresh agent continues it from that commit. This machine takes no new work until you start it.</p>
            <p>{running} running agent{running === 1 ? "" : "s"} will be handed off.</p></>,
          `Stop ${l} now`, "Stop requested — awaiting confirmation.", "Worker stop confirmed.")}
        {worker("worker.drain", c.desired !== "running" ? "Only a running worker can drain" : undefined,
          <p>Running agents on {l} finish; no new work starts here.</p>, `Drain ${l}`, "Drain requested — awaiting confirmation.", "Worker drain confirmed.")}
      </> : ["Start worker", "Stop worker", "Drain"].map(label => <ActionButton key={label} disabled>{label}</ActionButton>)}
      {(c || m.id.startsWith("node:")) && <SwarmAction label={workerLabels["worker.revoke"]} capability="swarm.worker.control" freeze={() => freezeRevoke(m)}
        intro={<p>Revoking removes the credentials of every worker node on {l}. Its service stops taking work, and the machine leaves the Swarm page. Stop it first so running agents hand off their work. To use it again, enroll it with a new code.</p>}
        confirm={`Revoke ${l}`} pendingText="Revoke requested — awaiting confirmation." confirmedText="Machine revoked." />}
    </div>
    {!c && <p className={styles.actionNote}>This machine's worker is not installed as a service, so it cannot be started or stopped here.</p>}
  </>;
}
