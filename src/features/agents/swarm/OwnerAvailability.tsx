import type { OwnerAvailabilityView } from "../../../api/adapters/swarm";
import { useSession } from "../../../app/session";
import { SwarmAction } from "./SwarmAction";
import { freezeAvailability } from "./swarmActions";
import styles from "./Swarm.module.css";

/** The sticky owner availability switch: AQ keeps the subscription available until the owner turns it off. */
export function OwnerAvailability({ a }: { a: OwnerAvailabilityView | null }) {
  const { bootstrap } = useSession();
  const capability = bootstrap.capability("swarm.availability.control");
  if (!capability.enabled) return <p className={styles.actionNote}>{capability.reason}</p>;
  if (!a) return null;
  const on = a.state === "on";
  const shared = { capability: "swarm.availability.control", scope: "availability", changed: "availability changed", freeze: () => freezeAvailability(!on, a) } as const;
  return <>
    {a.note && <p role="note" className={styles.actionNote}>{a.note}</p>}
    <div className={styles.actions}>
      {on
        ? <SwarmAction {...shared} label="Turn off availability"
          intro={<p>AQ stops starting new agents until you turn availability back on. Running agents continue.</p>} confirm="Turn my availability off"
          pendingText="Availability change requested — awaiting confirmation." confirmedText="Availability is off." />
        : <SwarmAction {...shared} label="Keep available"
          intro={<p>AQ keeps your subscription available for new agents until you turn it off.</p>} confirm="Keep my availability on"
          pendingText="Availability change requested — awaiting confirmation." confirmedText="Availability is on." />}
    </div>
  </>;
}
