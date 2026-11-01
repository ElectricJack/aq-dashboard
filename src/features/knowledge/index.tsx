import { DestinationPage } from "../../app/DestinationPage";
import { useSession } from "../../app/session";
import { HumanNodeWorkspace } from "./HumanNodeWorkspace";

export function Component() {
  const { bootstrap } = useSession();
  return <DestinationPage id="knowledge">{bootstrap.capability("human.graph.read").enabled ? <HumanNodeWorkspace kind="knowledge" /> : <p>The server does not offer the knowledge read contract supported by this dashboard.</p>}</DestinationPage>;
}
