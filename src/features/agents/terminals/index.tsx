import { Navigate, useLocation } from "react-router";
import { DestinationPage } from "../../../app/DestinationPage";
import { ManualAgentsProvider } from "../swarm/manualAgents";
import { TerminalWorkspace } from "./TerminalWorkspace";

export function Component() {
  const { search } = useLocation();
  if (new URLSearchParams(search).has("select")) return <Navigate to={{ pathname: "/agents/swarm", search }} replace />;
  return <DestinationPage id="agents"><ManualAgentsProvider><TerminalWorkspace /></ManualAgentsProvider></DestinationPage>;
}
