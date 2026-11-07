import { Link, useLocation } from "react-router";
import { useSession } from "../../../app/session";
import { AgentsTabs } from "../AgentsTabs";

export function SwarmPage() {
  const { bootstrap } = useSession();
  const cap = bootstrap.capability("swarm.read");
  const { search } = useLocation();
  return (
    <>
      <AgentsTabs current="swarm" />
      {!cap.enabled && <p role="note">Swarm is not available on this server. <Link to={{ pathname: "/agents/sessions", search }}>Open Sessions</Link></p>}
    </>
  );
}
